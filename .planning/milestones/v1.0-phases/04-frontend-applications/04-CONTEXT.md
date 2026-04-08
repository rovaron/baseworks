# Phase 4: Frontend Applications - Context

**Gathered:** 2026-04-06
**Status:** Ready for planning
**Mode:** Auto (Claude picked recommended defaults)

<domain>
## Phase Boundary

Build two frontend applications (Next.js customer app, Vite admin dashboard) and two shared packages (UI component library, Eden Treaty API client). Both apps connect to the existing Elysia backend via type-safe Eden Treaty calls and share authentication through better-auth's client SDK. The shared UI package provides shadcn/ui components with Tailwind 4 styling used by both apps.

</domain>

<decisions>
## Implementation Decisions

### Eden Treaty & API Client Package
- **D-01:** Create `packages/api-client/` as `@baseworks/api-client` — exports a configured Eden Treaty client factory. Both apps import from this package. Single source of truth for API base URL and client configuration.
- **D-02:** Fix Eden Treaty type coverage — refactor `apps/api/src/index.ts` to eliminate `as any` casts that break type inference. Auth routes and billing routes must be properly typed in the `App` export. This is a prerequisite for Phase 4, not optional.
- **D-03:** Add missing billing HTTP routes — billing CQRS commands (checkout, cancel, change-plan, portal, one-time, record-usage) and queries (get-subscription-status, get-billing-history) need Elysia route handlers in the billing module. Without these, the frontend has nothing to call. Added as part of Phase 4 Plan 01.
- **D-04:** The api-client package exports both the Eden Treaty client AND the better-auth client. Single import for all API interactions: `import { api, auth } from "@baseworks/api-client"`.

### Next.js Customer App (apps/web)
- **D-05:** Next.js 15 with App Router exclusively. No `pages/` directory. React 19. Server Components by default, `"use client"` only when needed for interactivity.
- **D-06:** Auth pages: `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/magic-link`. All client components using better-auth client SDK (CUST-01).
- **D-07:** Dashboard layout at `/dashboard` with sidebar navigation. Protected via Next.js middleware checking session cookie (CUST-02). Middleware redirects unauthenticated users to `/login`.
- **D-08:** Billing pages: `/dashboard/billing` — shows subscription status, plan selection, upgrade/downgrade buttons. Uses Eden Treaty to call billing routes. Stripe Customer Portal link via server-generated URL (CUST-03).
- **D-09:** Tenant context: React context provider wrapping the dashboard layout. If user has multiple tenants, show a tenant switcher in the sidebar (CUST-05). Uses better-auth's organization API.
- **D-10:** Next.js middleware for auth: check for `better-auth.session_token` cookie, redirect to `/login` if missing on protected routes. Lightweight check — full session validation happens server-side on API calls.
- **D-11:** Use `@t3-oss/env-nextjs` for frontend env validation: `NEXT_PUBLIC_API_URL` (Elysia server URL), `NEXT_PUBLIC_APP_URL` (self URL for callbacks).

### Vite Admin Dashboard (apps/admin)
- **D-12:** Vite 6 + React 19 SPA. React Router 7 with config-based routing (not file-based — admin routes are well-defined and limited). Package name: `@baseworks/admin`.
- **D-13:** Admin auth: same better-auth instance, same cookie-based sessions. CORS is already configured on Elysia. Admin-only access enforced by checking user role — admin dashboard routes require `owner` or `admin` role on any tenant (or a dedicated `superadmin` flag if needed). Simplest approach: check a specific role or hardcoded admin email list via env var.
- **D-14:** Admin pages: tenant management (list/view/edit/deactivate), user management (list/view/impersonate/ban), billing overview (subscription distribution, revenue), system health (BullMQ queue depth, Redis stats). Each is a route in the SPA (ADMN-01 through ADMN-05).
- **D-15:** Admin data tables use `@tanstack/react-table` for sortable, filterable, paginated tables (ADMN-02, ADMN-03).
- **D-16:** Admin requires additional backend API routes for cross-tenant operations — list all tenants, list all users, impersonate user, toggle user ban, get system health metrics. These are admin-only endpoints protected by role middleware. Added in Phase 4.
- **D-17:** Use `@t3-oss/env-core` + Vite's `import.meta.env` for env validation: `VITE_API_URL`.

### Shared UI Package (packages/ui)
- **D-18:** `packages/ui/` as `@baseworks/ui` — contains shadcn/ui components, Tailwind 4 CSS configuration, and the `cn()` utility. Both apps depend on this package.
- **D-19:** Tailwind 4 CSS-first configuration — no `tailwind.config.js`. CSS file with `@import "tailwindcss"` and design tokens (colors, fonts, spacing) defined as CSS custom properties. Each app imports the shared CSS.
- **D-20:** shadcn/ui initialized in `packages/ui/` — components installed via shadcn CLI into `packages/ui/src/components/`. Apps import components from `@baseworks/ui`.
- **D-21:** Initial component set (bare minimum for Phase 4 pages): Button, Card, Input, Label, Form, Select, Table, Dialog, DropdownMenu, Sidebar, Avatar, Badge, Separator, Skeleton, Tabs, Toast/Sonner. More added as needed.
- **D-22:** Each app has its own Tailwind entry CSS that imports the shared package's base styles. Vite uses `@tailwindcss/vite` plugin; Next.js uses PostCSS integration (Tailwind 4 default for non-Vite).

### Frontend State Management
- **D-23:** `@tanstack/react-query` for all server state (API calls) in both apps. QueryClient provider at app root. No manual fetch/useEffect for data fetching.
- **D-24:** `zustand` only if needed for client-side UI state (sidebar open/closed, theme). Do not use zustand for server data.
- **D-25:** `nuqs` for URL-based state in Next.js customer app (filters, pagination, search params). Not needed for admin SPA.

### Forms & Validation
- **D-26:** `react-hook-form` + `@hookform/resolvers` with Zod schemas for all forms in both apps. Zod schemas can be shared from `@baseworks/shared` if they match API input types.

### Plan Splitting
- **D-27:** Phase 4 splits into 3 plans:
  - **04-01:** Shared foundations — `packages/ui` (shadcn + Tailwind 4), `packages/api-client` (Eden Treaty + better-auth client), fix App type export, add billing HTTP routes, add admin API routes. Everything both apps need.
  - **04-02:** Next.js customer app — scaffolding, auth pages, dashboard layout, billing pages, tenant context/switcher.
  - **04-03:** Vite admin dashboard — scaffolding, admin auth, tenant management, user management, billing overview, system health panel.

### Claude's Discretion
- Exact shadcn component variants and customization
- React Query configuration (stale time, retry policies, devtools)
- Next.js middleware implementation details
- Admin dashboard layout structure (sidebar vs top-nav)
- Error boundary implementation
- Loading state patterns (skeletons vs spinners)
- Toast notification implementation
- Admin impersonation mechanism details
- BullMQ health check API implementation details
- Whether to add Vitest for frontend component tests in this phase or defer

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Configuration
- `CLAUDE.md` — Technology stack (Next.js ^15.0+, Vite ^6.0+, React ^19.0+, React Router ^7.0+, Tailwind ^4.0+, shadcn/ui, @tanstack/react-query ^5.50+, zustand ^5.0+, react-hook-form ^7.53+, @tanstack/react-table ^8.20+, @elysiajs/eden ^1.1+), version matrix, what NOT to use
- `.planning/PROJECT.md` — Core value, constraints (Eden Treaty, Tailwind 4 + shadcn, Bun workspaces)
- `.planning/REQUIREMENTS.md` — CUST-01–05, ADMN-01–05, SHUI-01–02

### Phase 1 Foundation
- `.planning/phases/01-foundation-core-infrastructure/01-CONTEXT.md` — Module registry design, monorepo layout, workspace aliases
- `packages/shared/src/types/module.ts` — ModuleDefinition interface
- `packages/config/src/env.ts` — Environment validation pattern

### Phase 2 Auth
- `.planning/phases/02-auth-multitenancy/02-CONTEXT.md` — Auth integration, session strategy (cookie-based), RBAC (owner/admin/member), tenant-user relationship
- `packages/modules/auth/src/auth.ts` — better-auth server config (basePath, plugins, providers) — needed to configure client SDK
- `packages/modules/auth/src/middleware.ts` — betterAuthPlugin, requireRole patterns
- `apps/api/src/core/middleware/tenant.ts` — Tenant extraction from session

### Phase 3 Billing
- `.planning/phases/03-billing-background-jobs/03-CONTEXT.md` — Billing module structure, Stripe integration decisions
- `packages/modules/billing/src/commands/` — Billing CQRS commands (need HTTP route wrappers)
- `packages/modules/billing/src/queries/` — Subscription status, billing history queries

### Backend Entry Points
- `apps/api/src/index.ts` — `export type App = typeof app` (Eden Treaty anchor, needs `as any` fix)
- `apps/api/package.json` — `"main": "./src/index.ts"` (importable as `@baseworks/api`)

### Root Configuration
- `package.json` — Workspace config: `["packages/*", "packages/modules/*", "apps/*"]` — new packages auto-discovered
- `tsconfig.json` — Includes `apps/*/src/**/*.ts`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `export type App = typeof app` in `apps/api/src/index.ts` — Eden Treaty type anchor (needs cleanup)
- Elysia CORS already configured via `@elysiajs/cors` — admin dashboard cross-origin calls will work
- Elysia Swagger at `/swagger` — API documentation available for reference during frontend development
- better-auth server config with organization plugin, magic link, email/password — client SDK must mirror these plugins
- Module registry pattern — both apps will consume module routes, not the registry directly
- Schema helpers and types in `@baseworks/shared` — some may be reusable for frontend validation
- Pino logger in backend — no frontend logging decisions needed yet

### Established Patterns
- Workspace packages at `packages/<name>/` with `@baseworks/<name>` aliases
- TypeBox for backend validation (not Zod) — but frontend forms will use Zod (per CLAUDE.md: react-hook-form + Zod)
- Result pattern: `{ success: true, data }` / `{ success: false, error }` — frontend must handle both shapes
- Auth routes at `/api/auth/*` via better-auth handler
- Tenant context derived from session — frontend sends cookies, backend resolves tenant

### Integration Points
- `apps/api/src/index.ts` — Fix `as any` casts for full Eden Treaty type inference
- `packages/modules/billing/src/routes.ts` — Add HTTP route handlers for billing commands/queries
- `apps/api/src/core/registry.ts` — May need admin-only route group for cross-tenant operations
- Root `package.json` — Add `dev:web`, `dev:admin`, `build:web`, `build:admin` scripts
- Root `tsconfig.json` — May need to include `.tsx` files for frontend packages

</code_context>

<specifics>
## Specific Ideas

- The `as any` casts in `apps/api/src/index.ts` are the biggest technical risk for Eden Treaty — fixing these is a prerequisite, not a nice-to-have
- Billing module has CQRS commands but zero HTTP routes for them — the frontend literally cannot call checkout/cancel/portal without adding routes first
- Admin dashboard needs cross-tenant API endpoints that don't exist yet (list all tenants, list all users, system health) — these are backend additions driven by frontend needs
- better-auth client SDK must be configured with the exact same plugins as the server (organization, magicLink) or client calls will fail
- Tailwind 4 in a monorepo requires careful CSS import chaining — the shared UI package defines the design system, apps import and extend it
- Next.js 15 + React 19 Server Components can't use better-auth client directly — auth pages must be client components
- The admin dashboard SPA needs a way to determine if the user has admin privileges — simplest is checking role on the active organization via better-auth API

</specifics>

<deferred>
## Deferred Ideas

- Frontend testing (Vitest + Testing Library) — defer to Phase 5 or a separate testing phase
- Storybook for shared UI components — nice-to-have, not in scope
- Dark mode / theme switching — Tailwind 4 supports it natively, but skip for Phase 4
- Real-time updates via WebSockets (e.g., live billing status changes) — out of scope per PROJECT.md
- Advanced admin features: audit log viewer, feature flag management, A/B testing — v2+
- PWA / offline support — not needed for a SaaS starter kit
- E2E testing (Playwright/Cypress) — defer to Phase 5
- SSR optimization and caching strategies — premature for Phase 4

</deferred>

---

*Phase: 04-frontend-applications*
*Context gathered: 2026-04-06*
*Mode: --auto (non-interactive)*
