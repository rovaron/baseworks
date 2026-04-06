import { betterAuth } from "better-auth";
import { organization, magicLink } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDb } from "@baseworks/db";
import { env } from "@baseworks/config";

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
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    sendResetPassword: async ({ user, url }) => {
      // Phase 2: console log placeholder (D-06)
      // Phase 3: BullMQ job for actual email delivery via Resend
      // Per T-02-03: void pattern -- do NOT await, do not reveal user existence via timing
      console.log(`[AUTH] Password reset for ${user.email}: ${url}`);
    },
  },
  socialProviders,
  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      creatorRole: "owner",
      organizationLimit: 5,
    }),
    magicLink({
      expiresIn: 300, // 5 minutes per T-02-04
      sendMagicLink: async ({ email, url }) => {
        // Phase 2: console log placeholder (D-05)
        // Phase 3: BullMQ job for actual email delivery
        console.log(`[AUTH] Magic link for ${email}: ${url}`);
      },
    }),
  ],
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // Refresh session every 24 hours
  },
});
