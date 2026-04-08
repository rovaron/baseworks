# Phase 2: Auth & Multitenancy - Research

**Researched:** 2026-04-05
**Domain:** Authentication (better-auth), Multitenancy (organization plugin), RBAC, Elysia integration
**Confidence:** HIGH

## Summary

better-auth v1.5.6 provides a comprehensive authentication framework with built-in Elysia integration, Drizzle adapter, OAuth social providers, magic link plugin, and -- critically -- an **organization plugin** that maps almost exactly to Phase 2's multitenancy requirements. The organization plugin handles org CRUD, member management with owner/admin/member roles, session-based active organization tracking, and invitations. This eliminates the need to hand-build tenant membership tables, role checks, and org switching logic.

The integration pattern uses Elysia's `.mount()` method to attach better-auth's handler, and a `.macro()` with `resolve` to inject user/session into protected routes. The Drizzle adapter connects directly to the existing `createDb()` instance. Schema is generated via `npx auth@latest generate` and then migrated with `drizzle-kit`.

**Primary recommendation:** Use better-auth's organization plugin as the tenant system. Map "organization" to "tenant" in application code. This gives us CRUD, membership, RBAC, active-org-in-session, and schema generation for free. Custom tenant-scoped data access still uses the Phase 1 `scopedDb` wrapper, keyed off `session.activeOrganizationId`.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Mount better-auth as an Elysia route group at `/api/auth/*` -- better-auth handler adapter for Elysia
- **D-02:** Database-backed sessions (not JWT) -- stored in PostgreSQL via Drizzle adapter
- **D-03:** Cookie-based sessions for web apps (httpOnly, secure, sameSite). Bearer token support for API consumers
- **D-04:** OAuth providers: Google and GitHub via better-auth's built-in OAuth
- **D-05:** Magic link authentication via better-auth's email plugin
- **D-06:** Password reset via email link using better-auth's built-in flow
- **D-07:** Use better-auth's Drizzle adapter for all auth tables. Generate schema with `@better-auth/cli`
- **D-08:** Auto-create a personal tenant on user signup -- user becomes owner
- **D-09:** User can belong to multiple tenants via membership table. One tenant is "active" per session
- **D-10:** Membership table stores: userId, tenantId, role (owner/admin/member), joinedAt
- **D-11:** Simple role hierarchy: owner > admin > member. No granular permissions in v1
- **D-12:** Role enforcement via Elysia middleware guard -- composable `requireRole('admin')` derive
- **D-13:** Owner-only: delete tenant, transfer ownership, manage billing. Admin: manage members, update settings. Member: read/write tenant-scoped data
- **D-14:** Auth is a module at `packages/modules/auth/` -- loaded by the module registry
- **D-15:** Auth module exports: routes, commands, queries, events
- **D-16:** Tenant middleware updated to derive tenantId from authenticated session instead of x-tenant-id header
- **D-17:** User profile managed through auth module -- name, email, avatar URL, password

### Claude's Discretion
- better-auth configuration details (exact plugin options, callback URLs)
- Auth schema generation approach (CLI vs manual Drizzle schema)
- Session token format and expiration policy
- Tenant creation flow implementation details (event-driven vs inline)
- Specific error codes for auth failures
- Whether to split auth and tenant into one or two modules

### Deferred Ideas (OUT OF SCOPE)
- Team invites (v2 -- TEAM-01 through TEAM-03)
- Plan gating / feature flags (v2 -- ADVB-01)
- Two-factor authentication / passkeys
- Social login beyond Google + GitHub

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | User can sign up with email and password via better-auth | better-auth `emailAndPassword: { enabled: true }` -- built-in, verified |
| AUTH-02 | User can log in with OAuth providers (Google, GitHub) | better-auth `socialProviders: { google: {...}, github: {...} }` -- built-in, verified |
| AUTH-03 | User can log in via magic link (passwordless email) | better-auth `magicLink` plugin -- sends token via callback, verified |
| AUTH-04 | User session persists securely via database-backed sessions | Drizzle adapter stores sessions in PostgreSQL session table, verified |
| AUTH-05 | User can reset password via email link | `emailAndPassword.sendResetPassword` callback -- built-in flow, verified |
| AUTH-06 | Auth module integrates with Elysia as a better-auth plugin/handler | `.mount()` pattern + `.macro()` for session injection -- verified via official docs |
| TNNT-01 | Every user belongs to at least one tenant | Organization plugin + `databaseHooks.user.create.after` to auto-create personal org |
| TNNT-02 | All data queries filtered by tenant_id via scoped DB wrapper | Phase 1 `scopedDb()` keyed off `session.activeOrganizationId` |
| TNNT-03 | Tenant CRUD operations available | Organization plugin: `create`, `list`, `getFullOrganization`, `update`, `delete` |
| TNNT-04 | Basic RBAC with owner/admin/member roles per tenant | Organization plugin default roles: owner, admin, member -- exact match |
| TNNT-05 | User can update their profile | better-auth user update API + custom profile command |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-auth | 1.5.6 | Authentication framework | Locked constraint. Drizzle adapter, Elysia integration, OAuth, magic links, org plugin. [VERIFIED: npm registry] |
| better-auth/plugins (organization) | 1.5.6 | Multitenancy / org management | Built-in plugin providing org CRUD, membership, RBAC, active org in session. Maps to tenant concept. [VERIFIED: official docs] |
| better-auth/plugins (magicLink) | 1.5.6 | Passwordless email auth | Built-in plugin for magic link authentication. [VERIFIED: official docs] |
| better-auth/adapters/drizzle | 1.5.6 | Database adapter | Connects better-auth to existing Drizzle + PostgreSQL setup. [VERIFIED: official docs] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @better-auth/cli | 1.4.21 | Schema generation | Generates Drizzle schema files for auth + org tables. Run once during setup, then after config changes. [VERIFIED: npm registry] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Organization plugin for tenancy | Custom tenant tables | Org plugin gives CRUD, membership, RBAC, session tracking for free. Custom gives more control but duplicates significant effort. Org plugin is the clear winner. |
| `databaseHooks` for auto-create tenant | Event bus (`user.created`) | Hooks are synchronous within better-auth's transaction. Event bus is fire-and-forget. Hooks are more reliable for "must happen" logic. |

**Installation:**
```bash
cd apps/api && bun add better-auth
```

No separate `@better-auth/cli` install needed for generation -- use `bunx @better-auth/cli generate`.

**Version verification:**
- `better-auth`: 1.5.6 [VERIFIED: npm registry 2026-04-05]
- `@better-auth/cli`: 1.4.21 [VERIFIED: npm registry 2026-04-05]
- `elysia`: 1.4.28 [VERIFIED: npm registry 2026-04-05]
- `drizzle-orm`: 0.45.2 [VERIFIED: npm registry 2026-04-05]

## Architecture Patterns

### Recommended Project Structure
```
packages/modules/auth/
  src/
    index.ts              # ModuleDefinition export
    auth.ts               # betterAuth instance configuration
    routes.ts             # Elysia plugin: mount handler + protected routes
    middleware.ts          # Auth macro + requireRole guard
    commands/
      create-tenant.ts    # Wraps org plugin create (adds personal tenant logic)
      update-profile.ts   # User profile update command
      update-tenant.ts    # Tenant settings update command
      delete-tenant.ts    # Owner-only tenant deletion
    queries/
      get-tenant.ts       # Get tenant details
      list-tenants.ts     # List user's tenants
      list-members.ts     # List tenant members
      get-profile.ts      # Get user profile
    hooks/
      auto-create-tenant.ts  # databaseHooks for personal tenant on signup
packages/db/src/schema/
    auth.ts               # Generated by @better-auth/cli (users, sessions, accounts, verifications)
    organization.ts       # Generated by @better-auth/cli (organization, member, invitation)
```

### Pattern 1: better-auth Elysia Mount
**What:** Mount better-auth handler using Elysia's `.mount()` method, then use `.macro()` for session injection.
**When to use:** For the auth routes plugin that serves as the entry point for all authentication.
**Example:**
```typescript
// Source: https://better-auth.com/docs/integrations/elysia
import { Elysia } from "elysia";
import { auth } from "./auth";

const betterAuthPlugin = new Elysia({ name: "better-auth" })
  .mount("/api/auth", auth.handler)
  .macro({
    auth: {
      async resolve({ status, request: { headers } }) {
        const session = await auth.api.getSession({ headers });
        if (!session) return status(401);
        return {
          user: session.user,
          session: session.session,
        };
      },
    },
  });
```
[VERIFIED: better-auth docs + Elysia docs]

### Pattern 2: better-auth Instance Configuration
**What:** Configure the better-auth instance with Drizzle adapter, OAuth providers, magic link, organization plugin, and email/password.
**When to use:** Central auth configuration file.
**Example:**
```typescript
// Source: https://better-auth.com/docs/installation + plugin docs
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { magicLink } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@baseworks/db";

export const auth = betterAuth({
  basePath: "/api/auth",
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }, request) => {
      // Phase 2: console.log placeholder
      // Phase 3: enqueue BullMQ job
      console.log(`Password reset for ${user.email}: ${url}`);
    },
  },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    },
  },
  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      creatorRole: "owner",
      organizationLimit: 5,
    }),
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        // Phase 2: console.log placeholder
        console.log(`Magic link for ${email}: ${url}`);
      },
    }),
  ],
});
```
[VERIFIED: better-auth official docs, combined from multiple pages]

### Pattern 3: Tenant Middleware (Session-Derived)
**What:** Replace Phase 1's x-tenant-id header extraction with session-based tenant resolution using `session.activeOrganizationId`.
**When to use:** Replaces `apps/api/src/core/middleware/tenant.ts`.
**Example:**
```typescript
// Replaces the Phase 1 placeholder tenant middleware
import { Elysia } from "elysia";
import { auth } from "@baseworks/module-auth";

export const tenantMiddleware = new Elysia({ name: "tenant-context" })
  .derive({ as: "scoped" }, async ({ request }) => {
    const session = await auth.api.getSession({
      headers: request.headers,
    });
    if (!session) {
      throw new Error("Unauthorized");
    }
    const tenantId = session.session.activeOrganizationId;
    if (!tenantId) {
      throw new Error("No active tenant");
    }
    return {
      tenantId,
      userId: session.user.id,
      user: session.user,
      session: session.session,
    };
  });
```
[ASSUMED -- combines better-auth session API with existing tenant middleware pattern]

### Pattern 4: Role Guard Middleware
**What:** Composable Elysia derive that checks the user's role in the active organization.
**When to use:** Protecting admin-only or owner-only routes.
**Example:**
```typescript
// Source: inspired by better-auth org plugin API
import { Elysia } from "elysia";

export function requireRole(...roles: string[]) {
  return new Elysia({ name: `require-role-${roles.join(",")}` })
    .derive({ as: "scoped" }, async (ctx: any) => {
      // Use better-auth's org API to check role
      const memberRole = await auth.api.getActiveMemberRole({
        headers: ctx.request.headers,
      });
      if (!memberRole || !roles.includes(memberRole.role)) {
        throw new Error("Forbidden");
      }
      return { memberRole: memberRole.role };
    });
}
```
[ASSUMED -- API method names from official docs, Elysia pattern from project conventions]

### Pattern 5: Auto-Create Personal Tenant on Signup
**What:** Use better-auth's `databaseHooks` to automatically create a personal organization when a user signs up.
**When to use:** Satisfies TNNT-01 (every user belongs to at least one tenant).
**Example:**
```typescript
// In the betterAuth configuration
databaseHooks: {
  user: {
    create: {
      after: async (user) => {
        // Create personal org and make user the owner
        await auth.api.createOrganization({
          body: {
            name: `${user.name}'s Workspace`,
            slug: generateSlug(user.id),
          },
          headers: new Headers(), // Internal API call
        });
      },
    },
  },
},
```
[ASSUMED -- databaseHooks documented in better-auth but auto-create org is custom logic]

### Anti-Patterns to Avoid
- **Hand-building tenant tables when org plugin exists:** The organization plugin creates organization, member, and invitation tables with proper foreign keys. Do not create separate `tenants` and `tenant_members` tables -- use the plugin's tables.
- **Using JWT sessions:** D-02 locks database sessions. Do not add JWT session strategy.
- **Importing auth instance circularly:** The auth instance should be created in the auth module and exported. The tenant middleware imports it. Do not create the auth instance in the API entrypoint.
- **Awaiting email sends in auth callbacks:** Per better-auth docs, avoid `await` on email sending in `sendResetPassword` and `sendMagicLink` to prevent timing attacks. Use `void` or fire-and-forget.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| User authentication | Custom signup/login/session logic | better-auth emailAndPassword, OAuth, magicLink | Password hashing (scrypt), session management, CSRF protection, token rotation |
| Tenant/org CRUD | Custom tenant tables + handlers | better-auth organization plugin | Org CRUD, member management, role defaults, active org tracking, invitation system |
| RBAC role checks | Custom role middleware from scratch | Organization plugin's built-in roles + `getActiveMemberRole` API | Role hierarchy, permission resolution, consistent with session state |
| Password reset flow | Custom token generation, email sending | better-auth `sendResetPassword` callback | Token expiration, single-use enforcement, timing attack prevention |
| OAuth flow | Manual OAuth state, callback, token exchange | better-auth `socialProviders` | State verification, CSRF, token refresh, account linking |
| Session management | Custom session table, cookie handling | better-auth database sessions | Secure cookies (httpOnly, sameSite, secure), token rotation, expiration |
| Schema generation | Manually writing auth tables | `npx auth@latest generate` | Keeps schema in sync with better-auth internals across version upgrades |

**Key insight:** better-auth + organization plugin covers ~80% of Phase 2's requirements out of the box. The remaining 20% is wiring: connecting to existing module registry, updating tenant middleware, adding env vars, and wrapping org plugin APIs as CQRS commands/queries.

## Common Pitfalls

### Pitfall 1: Mount Path Duplication
**What goes wrong:** Mounting better-auth at `/api/auth` via Elysia `.mount("/api/auth", auth.handler)` while also setting `basePath: "/api/auth"` in better-auth config results in routes at `/api/auth/api/auth/*` (doubled prefix).
**Why it happens:** Both Elysia and better-auth prepend their paths.
**How to avoid:** Set `basePath: "/api/auth"` in better-auth config and mount with `.mount(auth.handler)` (no path prefix in mount), OR set `basePath: "/api"` and mount at `/auth`. Test with `GET /api/auth/ok` to verify.
**Warning signs:** 404 errors on auth routes, or routes appearing at unexpected paths in swagger.
[VERIFIED: Elysia integration docs]

### Pitfall 2: better-auth Returns 200 for Errors with Elysia
**What goes wrong:** better-auth may return HTTP 200 with error body instead of proper 4xx status codes when used with Elysia's `.mount()`.
**Why it happens:** `.mount()` uses a Web Standard Request/Response pattern that may not properly propagate status codes in some versions.
**How to avoid:** Test error cases explicitly (wrong password, expired token, missing session). If this occurs, consider using `toNodeHandler` adapter instead of direct mount. Monitor the GitHub issue for fixes.
**Warning signs:** Client receiving 200 status but error body.
[CITED: https://github.com/better-auth/better-auth/issues/7035]

### Pitfall 3: activeOrganizationId Not Set on Session Creation
**What goes wrong:** After signup, `session.activeOrganizationId` is null until the user explicitly calls `setActive()`. Tenant middleware returns "No active tenant" for newly signed-up users.
**Why it happens:** The organization plugin does not automatically set the active org -- it must be set explicitly.
**How to avoid:** In the auto-create-tenant hook, after creating the personal org, also set it as the active org. Or handle null `activeOrganizationId` in tenant middleware by auto-selecting the user's first org.
**Warning signs:** 401/403 errors immediately after signup despite valid session.
[CITED: https://better-auth.com/docs/plugins/organization]

### Pitfall 4: Drizzle Schema Mismatch After CLI Generation
**What goes wrong:** `npx auth@latest generate` outputs schema that doesn't match existing project conventions (different column naming, missing helpers like `timestampColumns()`).
**Why it happens:** CLI generates standalone schema, not aware of project conventions.
**How to avoid:** Generate schema once, then manually adjust to use project helpers (`primaryKeyColumn()`, `timestampColumns()`). Future updates: re-generate and diff rather than blindly replacing.
**Warning signs:** Migration errors, type mismatches between auth tables and application tables.
[ASSUMED -- based on typical CLI generation behavior]

### Pitfall 5: Elysia Type Inference Breaks with Auth Macro
**What goes wrong:** TypeScript cannot infer `user` and `session` types on route handlers when using the macro pattern.
**Why it happens:** Elysia's type system has known inference limitations across `.use()` boundaries (documented in Phase 1 decisions).
**How to avoid:** Use `(ctx: any)` parameter type in derives where necessary (established Phase 1 pattern). The runtime behavior is correct; only type inference is affected.
**Warning signs:** TypeScript errors on `ctx.user` or `ctx.session` access.
[VERIFIED: Phase 1 summary -- established pattern for Elysia type workarounds]

### Pitfall 6: Organization Plugin Tables Lack tenant_id Column
**What goes wrong:** The organization plugin's own tables (organization, member, invitation) don't have a `tenantId` column because the organization IS the tenant. Developers might try to add `tenantId` to org tables.
**Why it happens:** Conceptual mismatch -- in our model, organization = tenant. The org table doesn't need tenant scoping; it IS the scoping boundary.
**How to avoid:** Understand the mapping: `organization.id` = `tenantId`. The `scopedDb` wrapper is for application data tables (examples, projects, etc.), NOT for auth/org tables. Auth tables are accessed via better-auth APIs, not scopedDb.
**Warning signs:** Trying to add tenantIdColumn() to generated auth schema tables.

## Code Examples

### Complete better-auth Instance
```typescript
// packages/modules/auth/src/auth.ts
// Source: https://better-auth.com/docs/installation + plugin docs (combined)
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { magicLink } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDb } from "@baseworks/db";
import { env } from "@baseworks/config";

const db = createDb(env.DATABASE_URL);

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
      // Phase 2: console log placeholder
      // Phase 3: BullMQ job for actual email delivery
      console.log(`[AUTH] Password reset for ${user.email}: ${url}`);
    },
  },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    },
  },
  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      creatorRole: "owner",
      organizationLimit: 5,
      membershipLimit: 100,
    }),
    magicLink({
      expiresIn: 300, // 5 minutes
      sendMagicLink: async ({ email, url }) => {
        // Phase 2: console log placeholder
        console.log(`[AUTH] Magic link for ${email}: ${url}`);
      },
    }),
  ],
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // Update session every 24 hours
  },
});
```

### Env Vars to Add
```typescript
// packages/config/src/env.ts -- additions
BETTER_AUTH_SECRET: z.string().min(32),
BETTER_AUTH_URL: z.string().url(),
GOOGLE_CLIENT_ID: z.string().optional(),
GOOGLE_CLIENT_SECRET: z.string().optional(),
GITHUB_CLIENT_ID: z.string().optional(),
GITHUB_CLIENT_SECRET: z.string().optional(),
```

### Schema Generation Flow
```bash
# 1. Generate better-auth schema for Drizzle
bunx @better-auth/cli generate --output packages/db/src/schema/auth.ts

# 2. Review and adjust generated schema (add project helpers if desired)

# 3. Generate Drizzle migration
bunx drizzle-kit generate

# 4. Apply migration
bunx drizzle-kit migrate
```

### Module Definition
```typescript
// packages/modules/auth/src/index.ts
import type { ModuleDefinition } from "@baseworks/shared";
import { authRoutes } from "./routes";
import { createTenant } from "./commands/create-tenant";
import { updateProfile } from "./commands/update-profile";
import { updateTenant } from "./commands/update-tenant";
import { deleteTenant } from "./commands/delete-tenant";
import { getTenant } from "./queries/get-tenant";
import { listTenants } from "./queries/list-tenants";
import { listMembers } from "./queries/list-members";
import { getProfile } from "./queries/get-profile";

export default {
  name: "auth",
  routes: authRoutes,
  commands: {
    "auth:create-tenant": createTenant,
    "auth:update-profile": updateProfile,
    "auth:update-tenant": updateTenant,
    "auth:delete-tenant": deleteTenant,
  },
  queries: {
    "auth:get-tenant": getTenant,
    "auth:list-tenants": listTenants,
    "auth:list-members": listMembers,
    "auth:get-profile": getProfile,
  },
  jobs: {},
  events: [
    "user.created",
    "tenant.created",
    "member.added",
    "member.removed",
    "tenant.deleted",
  ],
} satisfies ModuleDefinition;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Lucia auth | better-auth | Early 2025 (Lucia deprecated) | better-auth is the spiritual successor, framework-agnostic |
| Manual org tables | better-auth organization plugin | better-auth v1.1+ (2024) | Plugin handles org CRUD, membership, RBAC, session tracking |
| NextAuth for all apps | better-auth | 2024-2025 | better-auth works across Elysia + Next.js + Vite without framework lock-in |
| Elysia `.all()` for auth | Elysia `.mount()` | Elysia 1.x | `.mount()` is the recommended way to integrate Web Standard handlers |

**Deprecated/outdated:**
- Lucia auth: deprecated early 2025, replaced by better-auth [VERIFIED: CLAUDE.md]
- `@elysiajs/bearer` plugin: unnecessary when using better-auth's cookie-based sessions. Only needed if building custom Bearer token auth [ASSUMED]

## Assumptions Log

> List all claims tagged `[ASSUMED]` in this research. The planner and discuss-phase use this
> section to identify decisions that need user confirmation before execution.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Tenant middleware can call `auth.api.getSession({ headers })` from outside better-auth's mount context | Architecture Pattern 3 | HIGH -- if session API requires being inside mount scope, middleware architecture changes significantly |
| A2 | `databaseHooks.user.create.after` can call `auth.api.createOrganization` to auto-create personal tenant | Architecture Pattern 5 | MEDIUM -- if hooks don't have access to auth API, need alternative approach (post-signup redirect) |
| A3 | `session.activeOrganizationId` is accessible as a direct property on the session object returned by `getSession` | Architecture Pattern 3 | HIGH -- if it requires a separate API call, every request adds latency |
| A4 | `@elysiajs/bearer` is unnecessary with better-auth | State of the Art | LOW -- worst case is an unused dependency |
| A5 | CLI-generated schema may need manual adjustment to match project conventions | Pitfall 4 | LOW -- cosmetic, not functional |
| A6 | `requireRole` can use `auth.api.getActiveMemberRole` in a derive | Architecture Pattern 4 | MEDIUM -- API availability outside client context needs verification |

## Open Questions

1. **Mount path configuration**
   - What we know: better-auth needs a `basePath` and Elysia uses `.mount(path, handler)`. Both prepend paths, causing duplication.
   - What's unclear: Exact combination of `basePath` + `.mount()` path that produces `/api/auth/*` routes without duplication.
   - Recommendation: Test empirically during implementation. Start with `basePath: "/api/auth"` and `.mount(auth.handler)` (no path arg). Verify with `/api/auth/ok` endpoint.

2. **better-auth session API outside mount context**
   - What we know: `auth.api.getSession({ headers })` is documented for use in macros.
   - What's unclear: Whether it works in Elysia derives/middleware that are NOT inside the `.mount()` scope.
   - Recommendation: Test in first task. If it fails, restructure to use the macro pattern exclusively.

3. **Organization plugin + custom session fields**
   - What we know: Org plugin adds `activeOrganizationId` to session table. There are documented issues (#3233, #5909) when combining org plugin with customSession plugin.
   - What's unclear: Whether we can reliably access `activeOrganizationId` from `getSession()` return value.
   - Recommendation: Do NOT use customSession plugin alongside organization plugin. Access org context via `activeOrganizationId` field only.

4. **Auto-create org in databaseHooks transaction scope**
   - What we know: `databaseHooks.user.create.after` fires after user creation.
   - What's unclear: Whether creating an org in this hook is within the same DB transaction, and whether it can call the org plugin's API.
   - Recommendation: If hook approach fails, use a post-signup flow: after `signUp.email` returns, immediately call `organization.create` + `organization.setActive` client-side.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL | Database sessions, auth tables | Via Docker Compose | 16+ | None -- required |
| Redis | Future sessions/cache (not Phase 2) | Via Docker Compose | 7+ | Not needed in Phase 2 |

**Missing dependencies with no fallback:**
- PostgreSQL must be running for auth to work (sessions, users, orgs stored in DB)

**Missing dependencies with fallback:**
- OAuth providers (Google, GitHub) require client IDs from respective developer consoles. Fallback: make env vars optional, auth works without OAuth (email/password + magic link still functional)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | bun test (built-in) |
| Config file | none -- Bun's built-in test runner, no config needed |
| Quick run command | `bun test packages/modules/auth/` |
| Full suite command | `bun test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | Email/password signup | integration | `bun test packages/modules/auth/src/__tests__/signup.test.ts -x` | Wave 0 |
| AUTH-02 | OAuth login (Google, GitHub) | unit (mock) | `bun test packages/modules/auth/src/__tests__/oauth.test.ts -x` | Wave 0 |
| AUTH-03 | Magic link login | integration | `bun test packages/modules/auth/src/__tests__/magic-link.test.ts -x` | Wave 0 |
| AUTH-04 | Session persistence | integration | `bun test packages/modules/auth/src/__tests__/session.test.ts -x` | Wave 0 |
| AUTH-05 | Password reset | integration | `bun test packages/modules/auth/src/__tests__/password-reset.test.ts -x` | Wave 0 |
| AUTH-06 | Elysia integration | integration | `bun test packages/modules/auth/src/__tests__/routes.test.ts -x` | Wave 0 |
| TNNT-01 | User auto-assigned to tenant | integration | `bun test packages/modules/auth/src/__tests__/auto-tenant.test.ts -x` | Wave 0 |
| TNNT-02 | Scoped queries filtered | integration | `bun test apps/api/src/__tests__/tenant-scoping.test.ts -x` | Wave 0 (extend existing) |
| TNNT-03 | Tenant CRUD | integration | `bun test packages/modules/auth/src/__tests__/tenant-crud.test.ts -x` | Wave 0 |
| TNNT-04 | RBAC enforcement | integration | `bun test packages/modules/auth/src/__tests__/rbac.test.ts -x` | Wave 0 |
| TNNT-05 | Profile update | integration | `bun test packages/modules/auth/src/__tests__/profile.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `bun test packages/modules/auth/`
- **Per wave merge:** `bun test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `packages/modules/auth/src/__tests__/signup.test.ts` -- covers AUTH-01
- [ ] `packages/modules/auth/src/__tests__/session.test.ts` -- covers AUTH-04
- [ ] `packages/modules/auth/src/__tests__/tenant-crud.test.ts` -- covers TNNT-03
- [ ] `packages/modules/auth/src/__tests__/rbac.test.ts` -- covers TNNT-04
- [ ] Test helper: create test auth instance with in-memory or test DB

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | better-auth handles password hashing (scrypt), session tokens, OAuth state verification |
| V3 Session Management | yes | Database sessions, httpOnly + secure + sameSite cookies, configurable expiry |
| V4 Access Control | yes | Organization plugin RBAC (owner/admin/member), requireRole middleware |
| V5 Input Validation | yes | TypeBox validation on CQRS commands, better-auth validates auth inputs |
| V6 Cryptography | no | No custom crypto -- better-auth handles all hashing/token generation |

### Known Threat Patterns for better-auth + Elysia

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Session fixation | Spoofing | better-auth regenerates session on login |
| CSRF on auth endpoints | Tampering | sameSite=strict cookies, CSRF tokens in better-auth |
| Timing attacks on email sends | Information Disclosure | `void sendEmail()` -- don't await, don't reveal user existence |
| Cross-tenant data access | Elevation of Privilege | scopedDb auto-filters by tenantId, org plugin isolates membership |
| OAuth state tampering | Tampering | better-auth validates OAuth state parameter |
| Brute force login | Denial of Service | Rate limiting (Phase 5) -- not in Phase 2 scope |

## Sources

### Primary (HIGH confidence)
- [better-auth Elysia integration docs](https://better-auth.com/docs/integrations/elysia) -- mount pattern, macro for session
- [better-auth Drizzle adapter docs](https://better-auth.com/docs/adapters/drizzle) -- adapter config, schema generation
- [better-auth organization plugin docs](https://better-auth.com/docs/plugins/organization) -- full org CRUD, RBAC, active org
- [better-auth magic link plugin docs](https://better-auth.com/docs/plugins/magic-link) -- sendMagicLink callback, config options
- [better-auth email/password docs](https://better-auth.com/docs/authentication/email-password) -- sendResetPassword, password config
- [better-auth OAuth docs](https://better-auth.com/docs/concepts/oauth) -- socialProviders, callback URLs
- [better-auth database docs](https://better-auth.com/docs/concepts/database) -- core tables (user, session, account, verification)
- [better-auth CLI docs](https://better-auth.com/docs/concepts/cli) -- schema generation commands
- [Elysia better-auth integration](https://elysiajs.com/integrations/better-auth) -- mount + macro pattern
- npm registry -- version verification for better-auth (1.5.6), @better-auth/cli (1.4.21), elysia (1.4.28), drizzle-orm (0.45.2)

### Secondary (MEDIUM confidence)
- [GitHub issue #7035](https://github.com/better-auth/better-auth/issues/7035) -- HTTP 200 for errors with Elysia
- [GitHub issue #3233](https://github.com/better-auth/better-auth/issues/3233) -- activeOrganizationId lost with customSession
- Phase 1 summaries (01-01, 01-02, 01-03) -- established patterns, decisions, known limitations

### Tertiary (LOW confidence)
- None -- all claims verified against official docs or flagged as ASSUMED

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries are locked decisions, versions verified via npm
- Architecture: MEDIUM -- mount pattern and org plugin well-documented, but session-outside-mount and auto-create-org-in-hooks are assumed
- Pitfalls: HIGH -- sourced from official docs and GitHub issues

**Research date:** 2026-04-05
**Valid until:** 2026-05-05 (stable -- better-auth and Elysia are mature)
