import { betterAuth } from "better-auth";
import { organization, magicLink } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDb } from "@baseworks/db";
import { env } from "@baseworks/config";
import { createQueue } from "@baseworks/queue";
import type { Queue } from "bullmq";
import { getLocale } from "./locale-context";

/**
 * Lazy-initialized email queue.
 * Per D-22: Only created if REDIS_URL is available.
 * Falls back to console.log if Redis is not configured (dev/test).
 */
let emailQueue: Queue | null = null;
function getEmailQueue(): Queue | null {
  if (!emailQueue && env.REDIS_URL) {
    emailQueue = createQueue("email-send", env.REDIS_URL);
  }
  return emailQueue;
}

const db = createDb(env.DATABASE_URL);

/**
 * Conditional social providers -- only included if env vars are set.
 * Per D-04: OAuth providers Google and GitHub, optional env vars.
 */
const socialProviders: Record<string, any> = {};

if (env.GOOGLE_CLIENT_ID) {
  socialProviders.google = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET!,
  };
}

if (env.GITHUB_CLIENT_ID) {
  socialProviders.github = {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET!,
  };
}

/**
 * better-auth instance configured with:
 * - Email/password authentication (AUTH-01)
 * - OAuth providers: Google, GitHub (AUTH-02, optional)
 * - Magic link authentication (AUTH-03)
 * - Database-backed sessions via Drizzle adapter (AUTH-04, D-02)
 * - Password reset flow (AUTH-05)
 * - Organization plugin for multitenancy (D-09, D-10)
 *
 * IMPORTANT (Pitfall 1): basePath is "/api/auth". In routes.ts,
 * mount with .mount(auth.handler) WITHOUT a path prefix to avoid
 * path doubling (/api/auth/api/auth/*).
 */
export const auth = betterAuth({
  basePath: "/api/auth",
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.WEB_URL, env.ADMIN_URL].filter(Boolean),
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    sendResetPassword: async ({ user, url }) => {
      const queue = getEmailQueue();
      if (queue) {
        await queue.add("password-reset", {
          to: user.email,
          template: "password-reset",
          data: { url, userName: user.name },
        });
      } else {
        console.log(`[AUTH] Password reset for ${user.email}: ${url}`);
      }
    },
  },
  socialProviders,
  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      creatorRole: "owner",
      organizationLimit: 5,
      invitationExpiresIn: 315360000, // ~10 years in seconds, effectively no expiration per D-11
      sendInvitationEmail: async (data) => {
        // Email suppression for shareable link mode:
        // Plan 02 creates link invitations with placeholder email `link-invite-{nanoid}@internal`
        // When we detect the @internal suffix, skip email enqueueing entirely.
        if (data.email.endsWith("@internal")) {
          console.log(`[AUTH] Link-mode invite (no email): ${data.email}`);
          return;
        }

        // Phase 12 D-02/D-03: resolve recipient locale from the inviter's active
        // request locale via AsyncLocalStorage. Falls back to defaultLocale ("en")
        // if called outside a request context.
        const locale = getLocale();

        const queue = getEmailQueue();
        const inviteLink = `${env.WEB_URL}/invite/${data.id}`;
        if (queue) {
          await queue.add("team-invite", {
            to: data.email,
            template: "team-invite",
            data: {
              inviteLink,
              organizationName: data.organization.name,
              inviterName: data.inviter.user.name || data.inviter.user.email,
              role: data.role,
              locale,
            },
          });
        } else {
          console.log(
            `[AUTH] Team invite for ${data.email} (locale=${locale}): ${inviteLink}`,
          );
        }
      },
    }),
    magicLink({
      expiresIn: 300, // 5 minutes per T-02-04
      sendMagicLink: async ({ email, url }) => {
        const queue = getEmailQueue();
        if (queue) {
          await queue.add("magic-link", {
            to: email,
            template: "magic-link",
            data: { url, email },
          });
        } else {
          console.log(`[AUTH] Magic link for ${email}: ${url}`);
        }
      },
    }),
  ],
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // Refresh session every 24 hours
  },
  /**
   * Database hooks for auto-creating a personal tenant on signup.
   * Per D-08: Every user gets a personal organization (tenant) with owner role.
   * Per TNNT-01: Ensures every user belongs to at least one tenant from signup.
   *
   * The hook uses `auth` via closure -- the reference resolves at call time
   * (after betterAuth() returns), so there is no circular dependency.
   *
   * Per Pitfall 3: activeOrganizationId may not be set after org creation.
   * The tenant middleware handles this by auto-selecting the user's first org.
   */
  databaseHooks: {
    user: {
      create: {
        after: async (user: any) => {
          try {
            const displayName = user.name || user.email.split("@")[0];
            await auth.api.createOrganization({
              body: {
                name: `${displayName}'s Workspace`,
                slug: `personal-${user.id.slice(0, 8)}`,
                userId: user.id,
              },
            });
            console.log(`[AUTH] Auto-created personal tenant for user: ${user.id}`);
          } catch (error) {
            console.error("[AUTH] Failed to auto-create tenant for user:", user.id, error);
          }
        },
      },
    },
  },
});
