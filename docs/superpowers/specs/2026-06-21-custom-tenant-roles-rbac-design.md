# v1.5 — Authorization Overhaul: Tenant Custom Roles + Platform Admin (better-auth)

**Status:** Design (in review)
**Date:** 2026-06-21
**Milestone:** v1.5
**Author:** brainstorming session

---

## 1. Problem & Goal

Baseworks has **two hand-rolled authorization guards**, both coarse:

- `requireRole(...roles)` — gates a route by matching a member's better-auth org role
  against a fixed allow-list (`owner`/`admin`/`member`). No granular capabilities; tenants
  can't define their own roles.
- `requirePlatformAdmin()` — gates operator surfaces on an **`ADMIN_EMAILS` env allow-list**.
  The cross-tenant admin routes (`apps/api/src/routes/admin.ts`) stub user **ban**,
  **impersonate**, and **user-management** as `501 NOT_IMPLEMENTED`.

**Goal:** Replace both with better-auth's first-class, permission-based authorization across
**two planes**, and deliver the full vertical slice (backend + UI) for each:

- **Tenant plane** — per-org RBAC with **tenant-defined custom roles** (org plugin
  `dynamicAccessControl`).
- **Platform plane** — operator RBAC + **user lifecycle** (ban / impersonate / user &
  session management) via the **admin plugin**, replacing the email allow-list and the 501
  stubs.

Both planes are built on the same `createAccessControl` primitive
(`better-auth/plugins/access`), so the model is uniform.

---

## 2. better-auth landscape (v1.5.6, verified against installed dist)

| Plane | Plugin | Role column | Default statements | Custom roles |
|---|---|---|---|---|
| Tenant (per-org) | `organization` | `member.role` | `organization`, `member`, `invitation`, `ac` | **runtime** via `dynamicAccessControl` (`organizationRole` table + CRUD) |
| Platform (global) | `admin` | `user.role` | `user`, `session` | static via `ac`/`roles` (config-time) |
| Foundation | `access` | — | `createAccessControl(statements)` | shared engine |

Supporting (noted, not adopted in v1.5): `custom-session` (embed perms in session to avoid
per-request lookups — perf, deferred), `additional-fields`, `teams` (org sub-grouping).

---

## 3. Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| v1.5 capability | Authorization overhaul (deeper RBAC) |
| Scope | **Full vertical slice, BOTH planes** |
| `requireRole` fate | **Replace entirely** with `requirePermission` |
| Roles UI home | **Both surfaces** — tenant self-service (`apps/web`) + operator view (`apps/admin`) |
| Platform plane | **Adopt the admin plugin** (replace email allow-list + implement 501 stubs) |
| Admin bootstrap | **Seed `user.role` from `ADMIN_EMAILS`** on startup/seed; manage further operators via `setRole` |
| Execution shape | **One milestone, 4 phases:** A-backend → A-UI → B-backend → B-UI (each reviewed/committed) |

---

# PLANE A — Tenant (organization custom roles)

## A1. Permission catalog (statements)

New `packages/modules/auth/src/access-control.ts`, built on the org plugin's
`defaultStatements` (`organization`, `member`, `invitation`, `ac`) plus Baseworks resources:

```
files:    [read, write, delete, admin]
billing:  [read, manage]
```

(Statements extensible by modules later; v1.5 ships auth + files + billing.)

## A2. Built-in roles redefined as permission sets

Via `createAccessControl`, preserving current semantics (behavior-preserving cutover):

- **owner** — all statements.
- **admin** — all except `organization:delete`, `billing:manage`, `ac:delete` *(tunable)*.
- **member** — read-only baseline (`files:read`, `billing:read`).

Passed to the org plugin as `roles: { owner, admin, member }` with the shared `ac`.

## A3. Plugin wiring

`packages/modules/auth/src/auth.ts` organization plugin:

```ts
organization({
  ac,
  roles: { owner, admin, member },
  dynamicAccessControl: { enabled: true, maximumRolesPerOrganization: 50 },
  creatorRole: "owner",            // unchanged
  // existing options unchanged
})
```

Auth client (`packages/api-client/src/auth-client.ts`) mirrors with
`organizationClient({ ac, roles })`. **Constraint:** the `ac`/roles definitions must live in
a module importable by **both** server and browser **without** server-only deps (db, queue).

## A4. Database

Auth tables are **hand-maintained** in `packages/db/src/schema/auth.ts`. Add
`organizationRole` (matches better-auth `organizationRoleSchema`):

| column | type | notes |
|---|---|---|
| `id` | text PK | |
| `organizationId` | text | FK → `organization.id` |
| `role` | text | role name |
| `permission` | **text** | **JSON-serialized** `Record<string, string[]>` — better-auth does `JSON.stringify`/`JSON.parse` (crud-access-control.mjs), so this is a string column, **not** jsonb |
| `createdAt` | timestamp | default now |
| `updatedAt` | timestamp | nullable |

Index `organizationId`; unique `(organizationId, role)`. Generate migration via
`drizzle-kit generate` → `packages/db/migrations`. (`member.role` is already `text`, so
custom role names persist with no change.)

## A5. Guard — `requirePermission(resource, action)` (replaces `requireRole`)

New guard in `middleware.ts`, race-free (read `ctx.tenantId`/`userId` first, fall back to
`getSession`), checks via `auth.api.hasPermission({ headers, body: { permissions: { [resource]: [action] } } })`
(exact body shape confirmed in planning), throws `ForbiddenError` on deny.

**`requireRole` is removed.** Migrate every call site:

- `apps/api/src/index.ts`
- `packages/modules/auth/src/routes.ts`
- `packages/modules/auth/src/commands/cancel-invitation.ts` → `invitation:cancel`
- `packages/modules/auth/src/commands/delete-tenant.ts` → `organization:delete`
- `packages/modules/auth/src/index.ts` (re-export — drop)
- Tests: `apps/api/src/__tests__/admin-auth.test.ts`,
  `apps/api/test/admin-bull-board.test.ts`, `apps/api/test/health-detailed.test.ts`,
  `packages/modules/auth/src/__integration__/tenant-session.test.ts`,
  `packages/modules/auth/src/__tests__/auth-setup.test.ts`

## A6. Role-CRUD API

`dynamicAccessControl` auto-exposes `createOrgRole`/`listOrgRoles`/`getOrgRole`/
`updateOrgRole`/`deleteOrgRole` under `/api/auth/organization/*`, gated by the `ac`
permission (owner/admin only). Consumed via auth-client (not Eden).

## A7. Frontend (both surfaces)

- **Tenant self-service (`apps/web` → `app/(dashboard)/team/settings`):** Roles section —
  list built-in + custom roles; create/edit/delete via a **permission matrix** (resource
  rows × action checkboxes), capped at `maximumRolesPerOrganization`. Extend
  `components/members-list.tsx` role dropdown to assign any role via `updateMemberRole`. A
  `usePermission(resource, action)` hook over client `hasPermission` for conditional UI
  (server is the enforcement boundary). Extend `roles.*` i18n; render custom names literally.
- **Operator view (`apps/admin`):** inspect a tenant's roles within the existing
  cross-tenant admin browser (read-first; mutation scope decided in planning).

---

# PLANE B — Platform (admin plugin)

## B1. Plugin wiring

Add the admin plugin to `auth.ts` (server) and `adminClient()` to the auth client:

```ts
import { admin } from "better-auth/plugins";
// ...
admin({
  adminRoles: ["admin"],                 // data-driven: user.role ∈ adminRoles
  defaultRole: "user",
  impersonationSessionDuration: 60 * 60, // 1h default
  // optional: ac + roles for fine-grained operator permissions (see B4)
})
```

**Bootstrap:** keep `ADMIN_EMAILS` as the *seed* mechanism — on startup/seed (or signup
hook), promote those users to `user.role = "admin"`. Authorization then reads `user.role`
(data-driven, scales beyond env), while `ADMIN_EMAILS` remains the zero-touch way to mint
the first operator. (Alternative: `adminUserIds` — but we have emails, not ids, so seeding
`user.role` is cleaner.)

## B2. Database

Admin plugin schema additions to `packages/db/src/schema/auth.ts` (one migration):

- `user`: `role` (text, null), `banned` (boolean, default false), `banReason` (text, null),
  `banExpires` (timestamp, null)
- `session`: `impersonatedBy` (text, null)

## B3. Replace `requirePlatformAdmin` internals

Keep the `requirePlatformAdmin()` guard name/signature (it has 6 call sites:
`admin.ts`, `bull-board.ts`, `health-detailed.ts`, files admin/health helpers), but change
its check from the email allow-list to **`session.user.role ∈ adminRoles`** (the admin
plane). This is a behavior-preserving swap at the seam — call sites untouched.
**Add the missing tests** (`requirePlatformAdmin` currently has ⚠️ zero coverage).

## B4. Operator endpoints — adopt plugin, retire 501 stubs

The admin plugin exposes (under `/api/auth/admin/*`, consumed via admin-client):
`listUsers`, `createUser`, `setRole`, `setUserPassword`, `banUser`/`unbanUser`,
`impersonateUser`/`stopImpersonating`, `removeUser`, `listUserSessions`,
`revokeUserSession(s)`.

`apps/api/src/routes/admin.ts` is refactored:

- **Delegate to plugin** (remove the bespoke handlers / 501 stubs): `GET /users`,
  `GET /users/:id`, `PATCH /users/:id` (ban/unban), `POST /users/:id/impersonate`.
- **Keep bespoke** (not in admin plugin — Baseworks-specific, still
  `requirePlatformAdmin`-gated): tenant management (`/tenants*`), cross-tenant file browser
  (`/tenants/:id/files*`), billing overview, system health.

Admin plane default statements: `user` [create, list, set-role, ban, impersonate,
impersonate-admins, delete, set-password, get, update], `session` [list, revoke, delete].
Default roles: `admin` (all), `user` (none). v1.5 can ship just these two; a custom operator
`ac`/roles split (e.g. read-only operator) is optional.

## B5. Frontend (`apps/admin`)

Wire the existing admin user-management screens to the real plugin endpoints (ban /
impersonate / list / set-role / revoke sessions) via `adminClient`, replacing the current
501-driven dead UI. Impersonation banner + "stop impersonating" affordance.

---

## 4. Security invariants (must hold + be tested)

**Tenant plane:** per-org isolation (a role in org A never grants in org B); no privilege
escalation (creator can't grant beyond what they hold — verify better-auth enforces, else
add); owner-only `ac:delete` + `organization:delete`; last-owner protection;
`maximumRolesPerOrganization` cap; personal workspaces unaffected.

**Platform plane:** operator actions require `user.role ∈ adminRoles` (an org "owner" is
**never** a platform operator); impersonation is audit-logged (preserve existing T-4-05
logging) and time-boxed; `impersonate-admins` stays disabled by default; banned users are
rejected at session resolution.

## 5. Testing

- Unit: statement/role definitions (both planes); `requirePermission` allow/deny;
  `requirePlatformAdmin` role check.
- Integration (live DB): create custom role → assign → member gains/loses permission;
  cross-tenant denial; owner-only ops; **`requirePlatformAdmin` coverage (gap)**; admin
  endpoints — ban blocks login, impersonate issues scoped session, set-role promotes,
  revoke kills sessions.
- Migration smoke: `organizationRole` table + new `user`/`session` columns present.
- Frontend: roles permission-matrix CRUD; member reassignment; `usePermission` gating;
  admin user-management actions.
- Respect the process-global `mock.module` constraint — live-DB suites stay in
  `__integration__/` with isolated `bun test` invocations.

## 6. Open questions (resolve during planning)

1. ~~Exact `auth.api.hasPermission` body shape~~ — RESOLVED: `{ headers, body: { organizationId,
   permissions: { [resource]: [action] } } }` (`permissions` plural; singular `permission` is
   the deprecated alias). Returns `{ success, error }`.
2. Does better-auth enforce no-escalation + last-owner protection, or do we add it?
3. ~~Drizzle adapter `permission` → `jsonb`~~ — RESOLVED: column is **text** holding a
   `JSON.stringify`'d object (better-auth serializes/parses itself).
4. `apps/admin` roles view: read-only vs full management in v1.5.
5. Final `resource:action` mapping for each migrated route.
6. Admin bootstrap mechanics (DECIDED: seed `user.role` from `ADMIN_EMAILS`) — exact seam
   to perform the promotion (startup hook vs seed script vs signup `after` hook); resolve in
   plan phase B-backend.

## 7. Out of scope (deferred)

- Resource-scoped / per-record permissions.
- `teams` plugin (org sub-grouping).
- `custom-session` perf optimization (embedding perms in session).
- Custom operator role tiers beyond `admin`/`user` (unless trivially added).
