# Phase 2: Auth & Multitenancy - Context

**Gathered:** 2026-04-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement user authentication via better-auth (email/password, OAuth, magic links, password reset) and multitenancy (tenant CRUD, user-tenant membership, RBAC with owner/admin/member roles). This phase builds the first real modules on Phase 1's foundation, replacing the x-tenant-id header placeholder with session-derived tenant context. Auth and tenant modules prove the module registry works with real, non-trivial modules.

</domain>

<decisions>
## Implementation Decisions

### better-auth Integration
- **D-01:** Mount better-auth as an Elysia route group at `/api/auth/*` — use better-auth's handler adapter for Elysia. better-auth owns the auth routes, Elysia owns the transport.
- **D-02:** Database-backed sessions (not JWT) — stored in PostgreSQL via Drizzle adapter. Sessions can be revoked, inspected, and carry tenant context. Per CLAUDE.md: "use database sessions for easy revocation and tenant context."
- **D-03:** Cookie-based sessions for web apps (httpOnly, secure, sameSite). Bearer token support for API consumers and the admin dashboard if needed. Both backed by the same session store.
- **D-04:** OAuth providers: Google and GitHub (per AUTH-02). Use better-auth's built-in OAuth plugin. OAuth callback URLs configured via env vars.
- **D-05:** Magic link authentication via better-auth's email plugin (per AUTH-03). Email delivery through a job queue (placeholder in Phase 2, fully wired in Phase 3 with BullMQ).
- **D-06:** Password reset via email link using better-auth's built-in flow (per AUTH-05). Same email delivery approach as magic links.
- **D-07:** Use better-auth's Drizzle adapter for all auth tables (users, sessions, accounts, verifications). Generate schema with `@better-auth/cli` and place in `packages/db/src/schema/auth.ts`.

### Tenant-User Relationship
- **D-08:** Auto-create a personal tenant on user signup — the user becomes the owner. This ensures TNNT-01 (every user belongs to at least one tenant) is satisfied from moment one.
- **D-09:** A user can belong to multiple tenants via a membership table (tenant_members). One tenant is "active" per session. Tenant switching updates the session's active tenant.
- **D-10:** The membership table stores: userId, tenantId, role (owner/admin/member), joinedAt. This is the source of truth for RBAC.

### RBAC Implementation
- **D-11:** Simple role hierarchy: owner > admin > member (per TNNT-04). No granular permissions in v1 — just role-level checks.
- **D-12:** Role enforcement via Elysia middleware guard — a composable `requireRole('admin')` derive that checks the active user's membership role for the current tenant. Returns 403 on insufficient permissions.
- **D-13:** Owner-only actions: delete tenant, transfer ownership, manage billing. Admin actions: manage members, update tenant settings. Member actions: read/write tenant-scoped data.

### Auth Module Structure
- **D-14:** Auth is a module at `packages/modules/auth/` — loaded by the module registry like any other module. This proves the module system handles a real, complex module.
- **D-15:** Auth module exports: routes (better-auth handler), commands (create-tenant, update-profile, add-member, etc.), queries (get-tenant, list-members, get-profile), events (user.created, tenant.created, member.added).
- **D-16:** The tenant middleware (from Phase 1) is updated to derive tenantId from the authenticated session instead of the x-tenant-id header. Unauthenticated routes (signup, login, OAuth callbacks) are excluded from tenant middleware.

### User Profile
- **D-17:** User profile (TNNT-05) is managed through the auth module — update name, email, avatar URL, and password. Avatar is a URL string (no file upload in Phase 2).

### Claude's Discretion
- better-auth configuration details (exact plugin options, callback URLs)
- Auth schema generation approach (CLI vs manual Drizzle schema)
- Session token format and expiration policy
- Tenant creation flow implementation details (event-driven via user.created or inline)
- Specific error codes for auth failures (401 vs 403 response bodies)
- Whether to split auth and tenant into two modules or keep as one (recommendation: one module since they're tightly coupled)

### Deferred Ideas (OUT OF SCOPE)
- Team invites (v2 — TEAM-01 through TEAM-03)
- Plan gating / feature flags based on subscription (v2 — ADVB-01)
- Two-factor authentication / passkeys
- Social login beyond Google + GitHub

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Configuration
- `CLAUDE.md` — Technology stack, better-auth version/adapter, session strategy, Drizzle adapter
- `.planning/PROJECT.md` — Core value, constraints (better-auth locked, no NextAuth)
- `.planning/REQUIREMENTS.md` — AUTH-01 through AUTH-06, TNNT-01 through TNNT-05

### Phase 1 Foundation
- `.planning/phases/01-foundation-core-infrastructure/01-CONTEXT.md` — Module registry design (D-01 through D-14), CQRS conventions, tenant scoping strategy
- `.planning/phases/01-foundation-core-infrastructure/01-01-SUMMARY.md` — Monorepo structure, shared packages, env config
- `.planning/phases/01-foundation-core-infrastructure/01-02-SUMMARY.md` — Module registry, CQRS bus, event bus, example module pattern
- `.planning/phases/01-foundation-core-infrastructure/01-03-SUMMARY.md` — Tenant middleware, scopedDb, worker entrypoint

### Key Source Files
- `apps/api/src/index.ts` — API entrypoint (where auth routes mount)
- `apps/api/src/core/registry.ts` — Module registry (import map needs auth module)
- `apps/api/src/core/middleware/tenant.ts` — Tenant middleware (needs session-based update)
- `packages/db/src/schema/base.ts` — Schema helpers (tenantIdColumn, timestamps)
- `packages/shared/src/types/module.ts` — ModuleDefinition interface
- `packages/shared/src/types/cqrs.ts` — HandlerContext, Result, defineCommand/defineQuery
- `packages/modules/example/src/index.ts` — Example module (pattern to follow)

### External Documentation
- better-auth docs: https://www.better-auth.com (Drizzle adapter, Elysia integration, OAuth setup, magic links, password reset)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ModuleDefinition` interface — auth module must conform to `{ name, routes, commands, queries, jobs, events }`
- `defineCommand` / `defineQuery` — TypeBox-validated handler factories from `@baseworks/shared`
- `ok()` / `err()` — Result constructors from `@baseworks/shared`
- `scopedDb()` — Tenant-scoped DB wrapper from `@baseworks/db`
- `tenantIdColumn()`, `primaryKeyColumn()`, `timestampColumns()` — Schema helpers
- `TypedEventBus` — In-process event bus for domain events
- `CqrsBus` — Command/query dispatch
- Example module — reference implementation showing the full module pattern

### Established Patterns
- Module = workspace package at `packages/modules/<name>/` with flat index.ts export
- Handlers are plain async functions: `(input, ctx) => Result`
- Validation via TypeBox TypeCompiler in defineCommand/defineQuery
- Static import map in registry.ts — new modules need an entry added
- Elysia plugin composition for routes
- Pino logger for structured logging

### Integration Points
- `apps/api/src/core/registry.ts` moduleImportMap — add `auth: () => import('@baseworks/module-auth')`
- `apps/api/src/index.ts` — better-auth handler mounts here (before tenant middleware for auth routes)
- `apps/api/src/core/middleware/tenant.ts` — replace x-tenant-id extraction with session lookup
- `packages/db/src/schema/index.ts` — barrel export auth tables
- `packages/config/src/env.ts` — add auth-related env vars (GOOGLE_CLIENT_ID, GITHUB_CLIENT_ID, etc.)
- `apps/api/src/index.ts` modules array — add 'auth' to loaded modules

</code_context>

<specifics>
## Specific Ideas

- better-auth is the hard constraint — no NextAuth, no Lucia (deprecated), no Clerk/Auth0 (per CLAUDE.md)
- The auth module is the first "real" module — it validates that the module registry pattern from Phase 1 works for non-trivial use cases
- Tenant context must transition from header-based (Phase 1 placeholder) to session-based (Phase 2 production) — this is the most architecturally significant change
- Email delivery for magic links and password reset will use a placeholder/console logger in Phase 2; Phase 3 wires BullMQ + Resend for actual delivery

</specifics>

<deferred>
## Deferred Ideas

- Team invites (v2 scope — TEAM-01 through TEAM-03)
- Two-factor authentication / passkeys — future enhancement
- Social login beyond Google + GitHub — add providers as needed
- Avatar file upload — Phase 2 stores URL only, file upload is a future feature
- Plan gating / feature flags (v2 — ADVB-01)

</deferred>

---

*Phase: 02-auth-multitenancy*
*Context gathered: 2026-04-06*
