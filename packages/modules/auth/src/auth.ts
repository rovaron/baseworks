import { env } from "@baseworks/config";
import { getDb } from "@baseworks/db";
import { getErrorTracker } from "@baseworks/observability";
import { createQueue, getRedisConnection } from "@baseworks/queue";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin as adminPlugin, magicLink, organization } from "better-auth/plugins";
import { nanoid } from "nanoid";
import { ac, platformAdminRoles, roles } from "./access-control";
import { getLocale } from "./locale-context";

/**
 * Lazy-initialized email queue.
 * Per D-22: Only created if REDIS_URL is available.
 * Falls back to console.log if Redis is not configured (dev/test).
 */
let emailQueue: ReturnType<typeof createQueue> | null = null;
function getEmailQueue(): ReturnType<typeof createQueue> | null {
  if (!emailQueue && env.REDIS_URL) {
    emailQueue = createQueue("notifications-deliver", env.REDIS_URL);
  }
  return emailQueue;
}

const db = getDb(env.DATABASE_URL);

/**
 * Distributed rate-limit storage (security/api-no-rate-limiting).
 *
 * better-auth's built-in limiter defaults to per-process in-memory counters,
 * which do not survive multi-instance deploys. When REDIS_URL is configured we
 * back better-auth's `secondaryStorage` with the shared ioredis connection so
 * auth rate limits (and sessions) are enforced consistently across instances.
 * When REDIS_URL is unset (dev/test) we skip it entirely and fall back to the
 * in-memory default so boot still works without Redis.
 */
// Lazily resolve the ioredis connection on FIRST use, never at module-eval time.
// Opening the socket eagerly here would make every test file that imports the
// auth module spawn a real Redis connection (and emit unhandled 'error' events
// when Redis is absent), destabilizing the shared Bun test process.
let _authRedis: ReturnType<typeof getRedisConnection> | undefined;
function getAuthRedis() {
  if (!_authRedis) _authRedis = getRedisConnection(env.REDIS_URL as string);
  return _authRedis;
}
const secondaryStorage = env.REDIS_URL
  ? {
      get: async (key: string) => await getAuthRedis().get(key),
      set: async (key: string, value: string, ttl?: number) => {
        if (ttl) {
          await getAuthRedis().set(key, value, "EX", ttl);
        } else {
          await getAuthRedis().set(key, value);
        }
      },
      delete: async (key: string) => {
        await getAuthRedis().del(key);
      },
    }
  : undefined;

/**
 * Conditional social providers -- only included if env vars are set.
 * Per D-04: OAuth providers Google and GitHub, optional env vars.
 */
const socialProviders: Record<string, any> = {};

if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  };
}

if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
  socialProviders.github = {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
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
  // Distributed session/rate-limit storage. Only wired when REDIS_URL is set
  // (see `secondaryStorage` above); undefined in dev/test so boot still works.
  ...(secondaryStorage ? { secondaryStorage } : {}),
  /**
   * Rate limiting (security/api-no-rate-limiting, gap-no-rate-limiting).
   *
   * Global default of 100 req / 60s, with tighter custom rules on the
   * brute-force-sensitive auth paths. When a Redis-backed secondaryStorage is
   * configured we use `storage: "secondary-storage"` so limits are shared
   * across instances; otherwise better-auth falls back to its in-memory store.
   *
   * Disabled under NODE_ENV=test: the integration suites legitimately create
   * many users in seconds, which trips the 5-signups/60s rule and leaves later
   * signups without a session (a non-deterministic, storage-dependent failure —
   * it surfaced only on CI's Redis-backed shared counter). Always on in dev/prod.
   */
  rateLimit: {
    enabled: env.NODE_ENV !== "test",
    window: 60,
    max: 100,
    ...(secondaryStorage ? { storage: "secondary-storage" as const } : {}),
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 5 },
      "/forget-password": { window: 300, max: 3 },
      "/magic-link": { window: 300, max: 3 },
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    sendResetPassword: async ({ user, url }) => {
      const queue = getEmailQueue();
      if (queue) {
        await queue.add("password-reset", {
          kind: "transactional-email",
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
      ac,
      roles,
      dynamicAccessControl: {
        enabled: true,
        maximumRolesPerOrganization: 50,
      },
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
            kind: "transactional-email",
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
          console.log(`[AUTH] Team invite for ${data.email} (locale=${locale}): ${inviteLink}`);
        }
      },
    }),
    magicLink({
      expiresIn: 300, // 5 minutes per T-02-04
      sendMagicLink: async ({ email, url }) => {
        const queue = getEmailQueue();
        if (queue) {
          await queue.add("magic-link", {
            kind: "transactional-email",
            to: email,
            template: "magic-link",
            data: { url, email },
          });
        } else {
          console.log(`[AUTH] Magic link for ${email}: ${url}`);
        }
      },
    }),
    adminPlugin({
      adminRoles: [...platformAdminRoles],
      defaultRole: "user",
      impersonationSessionDuration: 60 * 60, // 1h
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
            // Collision-resistant slug: an 8-hex-char id prefix alone is a
            // realistic collision/idempotency hazard on retried signups, so we
            // append a short nanoid suffix to keep personal-org slugs unique.
            await auth.api.createOrganization({
              body: {
                name: `${displayName}'s Workspace`,
                slug: `personal-${user.id.slice(0, 8)}-${nanoid(8)}`,
                userId: user.id,
              },
            });
            console.log(`[AUTH] Auto-created personal tenant for user: ${user.id}`);
          } catch (error) {
            // Surface the failure to the error tracker instead of swallowing it
            // in a log: a swallowed failure here leaves the user with zero
            // organizations and locked out by tenant middleware (no active
            // tenant) with only a server log as evidence.
            getErrorTracker().captureException(error, {
              tags: { area: "auth", hook: "auto-create-tenant" },
              extra: { userId: user.id },
            });
            console.error("[AUTH] Failed to auto-create tenant for user:", user.id, error);
          }
        },
      },
    },
  },
});
