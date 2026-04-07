---
phase: 04-frontend-applications
reviewed: 2026-04-06T23:45:00Z
depth: standard
files_reviewed: 63
files_reviewed_list:
  - apps/admin/src/App.tsx
  - apps/admin/src/components/data-table.tsx
  - apps/admin/src/layouts/admin-layout.tsx
  - apps/admin/src/layouts/auth-guard.tsx
  - apps/admin/src/lib/api.ts
  - apps/admin/src/lib/env.ts
  - apps/admin/src/lib/providers.tsx
  - apps/admin/src/lib/router.ts
  - apps/admin/src/main.tsx
  - apps/admin/src/routes/billing/overview.tsx
  - apps/admin/src/routes/login.tsx
  - apps/admin/src/routes/system/health.tsx
  - apps/admin/src/routes/tenants/detail.tsx
  - apps/admin/src/routes/tenants/list.tsx
  - apps/admin/src/routes/users/detail.tsx
  - apps/admin/src/routes/users/list.tsx
  - apps/admin/vite.config.ts
  - apps/api/src/core/registry.ts
  - apps/api/src/index.ts
  - apps/api/src/routes/admin.ts
  - apps/web/app/(auth)/forgot-password/page.tsx
  - apps/web/app/(auth)/layout.tsx
  - apps/web/app/(auth)/login/page.tsx
  - apps/web/app/(auth)/magic-link/page.tsx
  - apps/web/app/(auth)/reset-password/page.tsx
  - apps/web/app/(auth)/signup/page.tsx
  - apps/web/app/(dashboard)/dashboard/billing/page.tsx
  - apps/web/app/(dashboard)/dashboard/page.tsx
  - apps/web/app/(dashboard)/layout.tsx
  - apps/web/app/layout.tsx
  - apps/web/components/sidebar-nav.tsx
  - apps/web/components/tenant-provider.tsx
  - apps/web/components/tenant-switcher.tsx
  - apps/web/lib/api.ts
  - apps/web/lib/env.ts
  - apps/web/lib/providers.tsx
  - apps/web/middleware.ts
  - apps/web/next.config.ts
  - packages/api-client/src/auth-client.ts
  - packages/api-client/src/index.ts
  - packages/api-client/src/treaty.ts
  - packages/config/src/env.ts
  - packages/modules/billing/src/routes.ts
  - packages/ui/src/components/avatar.tsx
  - packages/ui/src/components/badge.tsx
  - packages/ui/src/components/button.tsx
  - packages/ui/src/components/card.tsx
  - packages/ui/src/components/dialog.tsx
  - packages/ui/src/components/dropdown-menu.tsx
  - packages/ui/src/components/form.tsx
  - packages/ui/src/components/input.tsx
  - packages/ui/src/components/label.tsx
  - packages/ui/src/components/select.tsx
  - packages/ui/src/components/separator.tsx
  - packages/ui/src/components/sheet.tsx
  - packages/ui/src/components/sidebar.tsx
  - packages/ui/src/components/skeleton.tsx
  - packages/ui/src/components/sonner.tsx
  - packages/ui/src/components/table.tsx
  - packages/ui/src/components/tabs.tsx
  - packages/ui/src/components/tooltip.tsx
  - packages/ui/src/hooks/use-mobile.tsx
  - packages/ui/src/index.ts
  - packages/ui/src/lib/utils.ts
findings:
  critical: 2
  warning: 5
  info: 4
  total: 11
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-04-06T23:45:00Z
**Depth:** standard
**Files Reviewed:** 63
**Status:** issues_found

## Summary

Phase 4 introduces the full frontend application layer: the Next.js customer app (apps/web), the Vite admin dashboard (apps/admin), the shared API client package (packages/api-client), shared UI components (packages/ui), and supporting admin API routes (apps/api/src/routes/admin.ts). The code is well-structured overall with consistent patterns across both frontends. However, there are two critical security issues in the admin API routes (SQL injection via unsanitized LIKE patterns and a client-side-only authorization guard), along with several warnings around missing error handling, incomplete backend implementations, and missing total count for pagination.

## Critical Issues

### CR-01: SQL Injection via Unsanitized LIKE Search Pattern

**File:** `apps/api/src/routes/admin.ts:33-34`
**Issue:** The `search` query parameter is interpolated directly into a SQL LIKE pattern via string concatenation (`%${search}%`). While Drizzle ORM parameterizes the value passed to `like()`, the `%` wildcards are concatenated into the string in application code. An attacker can inject LIKE meta-characters (`%`, `_`) to perform pattern-matching attacks, and depending on the Drizzle/driver version, there is a risk of the concatenated string not being properly escaped. The same pattern appears at lines 126-129 for users. This is a search injection vector at minimum, and could be more severe depending on driver internals.
**Fix:** Sanitize the search input by escaping LIKE meta-characters before concatenation:
```typescript
function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, (c) => '\\' + c);
}

// Usage:
const sanitized = escapeLike(search);
like(organization.name, `%${sanitized}%`)
```

### CR-02: Admin Authorization is Client-Side Only -- Server Returns Data to Any Authenticated User

**File:** `apps/admin/src/layouts/auth-guard.tsx:31-50`
**Issue:** The admin dashboard checks for "owner" role via `auth.organization.list()` on the client side. However, the admin API routes at `apps/api/src/routes/admin.ts:19` use `requireRole("owner")` which validates the role server-side. This is correctly implemented on the backend. However, the admin login page at `apps/admin/src/routes/login.tsx:52-67` performs a redundant client-side check that calls `auth.organization.list()` and signs out non-owners -- but if the `requireRole("owner")` middleware were misconfigured or bypassed, all admin data would be accessible to any authenticated user. The concern is that the client-side guard creates a false sense of security and may lead developers to remove or weaken the server-side check, believing the client handles it. Verify that `requireRole("owner")` is fully functional and covers all admin routes.
**Fix:** Add integration tests that verify non-owner users receive 401/403 from all `/api/admin/*` endpoints. The server-side `requireRole("owner")` is the actual security boundary -- ensure it is covered by tests and not accidentally removable.

## Warnings

### WR-01: Admin Tenant List Missing Total Count for Pagination

**File:** `apps/api/src/routes/admin.ts:40-51`
**Issue:** The `/api/admin/tenants` endpoint returns `{ data: tenants }` without a `total` count. The frontend at `apps/admin/src/routes/tenants/list.tsx:69` reads `(result as any)?.total ?? 0` and uses it to compute `pageCount`. Since the backend never returns `total`, the page count will always be 1 regardless of how many tenants exist, making pagination non-functional.
**Fix:** Add a count query to the endpoint:
```typescript
const [totalResult] = await db.select({ count: count() }).from(organization);
// ... (apply same search filter if search is provided)
return {
  data: tenants.map(...),
  total: totalResult?.count ?? 0,
};
```
The same issue applies to `/api/admin/users` (line 136) -- it also omits `total`.

### WR-02: User Ban/Unban is a No-Op on the Backend

**File:** `apps/api/src/routes/admin.ts:176-202`
**Issue:** The `PATCH /api/admin/users/:id` endpoint accepts `banned` and `banReason` in the body, validates them, but only logs the action. It never persists the ban state -- it returns `{ success: true }` regardless. The frontend (both list and detail views) renders ban status from `user.banned` which will never be set. This creates a confusing UX where the admin thinks they banned a user, but nothing actually happens.
**Fix:** Either extend the user table with a `banned` column and persist the state, or integrate better-auth's admin plugin for ban functionality. At minimum, document this limitation clearly in the API response or return a 501 status to signal it is not yet implemented.

### WR-03: User Impersonation is a No-Op on the Backend

**File:** `apps/api/src/routes/admin.ts:206-239`
**Issue:** The `POST /api/admin/users/:id/impersonate` endpoint logs the impersonation event but does not create an actual impersonation session. It returns `{ success: true }` and the frontend shows a success toast ("Impersonation started. Check the new session."), misleading the admin into thinking impersonation is active.
**Fix:** Either implement session creation via better-auth's admin API, or return a 501 status with a clear message that impersonation is not yet implemented. The frontend should handle 501 gracefully.

### WR-04: System Health Endpoint Creates a New Redis Connection on Every Request

**File:** `apps/api/src/routes/admin.ts:277-289`
**Issue:** The `/api/admin/system/health` endpoint dynamically imports ioredis and creates a new Redis connection (`new IORedis(...)`) on every request. With the frontend polling every 30 seconds (`refetchInterval: 30000` at `apps/admin/src/routes/system/health.tsx:71`), this creates and tears down a Redis connection every 30 seconds, potentially causing connection churn and Redis "too many connections" errors under load.
**Fix:** Reuse a module-level Redis connection or use the existing Redis connection from the application context. If a dedicated health-check connection is desired, cache it at module scope:
```typescript
let healthRedis: any = null;
// ... reuse healthRedis across requests, reconnect only on failure
```

### WR-05: Middleware Session Check Uses Only Cookie Presence, Not Validity

**File:** `apps/web/middleware.ts:4-8`
**Issue:** The Next.js middleware only checks for the existence of the `better-auth.session_token` cookie. It does not validate whether the session is still active (not expired, not revoked). This means a user with an expired or revoked session cookie will pass middleware and see the dashboard layout before client-side auth hooks redirect them. While the actual API calls will fail (since better-auth validates sessions server-side), the user briefly sees authenticated UI.
**Fix:** This is a known limitation of edge middleware (cannot make DB calls). Document it as intentional or consider using better-auth's session verification at the edge if a lightweight token check is available.

## Info

### IN-01: Pervasive Use of `as any` Type Assertions

**File:** Multiple files
**Issue:** Several files use `as any` to work around type inference gaps: `apps/admin/src/routes/billing/overview.tsx:51`, `apps/admin/src/routes/system/health.tsx:106`, `apps/admin/src/routes/tenants/detail.tsx:33-39`, `apps/admin/src/routes/users/detail.tsx:37-43`, `apps/admin/src/routes/tenants/list.tsx:54,68-69`, `apps/admin/src/routes/users/list.tsx:58,87-88`. The admin API route handlers also use `ctx: any` extensively at `apps/api/src/routes/admin.ts`.
**Fix:** Define typed interfaces for API responses and use them in query functions. For the backend, use Elysia's type-safe context derivation instead of `ctx: any`.

### IN-02: Unused `pageSize` Prop in DataTable

**File:** `apps/admin/src/components/data-table.tsx:31`
**Issue:** The `pageSize` prop is defined in the `DataTableProps` interface but is never used within the component. It is also never passed by any caller.
**Fix:** Remove `pageSize` from the interface if it is not needed, or wire it to the table's `pageSize` option if it should be configurable.

### IN-03: Unused `offset` Variable in Billing History Query

**File:** `packages/modules/billing/src/routes.ts:199`
**Issue:** The `offset` variable is parsed from `ctx.query?.offset` but never passed to `getBillingHistory()`. The function only receives `{ limit }`.
**Fix:** Either pass `offset` to `getBillingHistory` or remove the parsing.

### IN-04: Next.js Config Disables TypeScript Build Errors

**File:** `apps/web/next.config.ts:9-11`
**Issue:** `typescript.ignoreBuildErrors` is set to `true` with a comment explaining it is because backend module types are not resolvable from the web app context. While the rationale is documented, this disables all TypeScript error checking during Next.js builds, which could mask real type errors in the web app.
**Fix:** Consider using `paths` aliases or conditional type stubs to make the Eden Treaty type chain resolvable, or restrict the ignore to specific files if Next.js supports that in a future version.

---

_Reviewed: 2026-04-06T23:45:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
