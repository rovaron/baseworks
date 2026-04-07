# Phase 4: Frontend Applications - Research

**Researched:** 2026-04-06
**Domain:** Frontend applications (Next.js, Vite SPA), shared UI (shadcn/ui + Tailwind 4), API client (Eden Treaty), authentication client (better-auth)
**Confidence:** HIGH

## Summary

Phase 4 builds two frontend applications (Next.js customer app, Vite admin dashboard), a shared UI component library (shadcn/ui + Tailwind 4), and a shared API client package (Eden Treaty + better-auth client). Both apps connect to the existing Elysia backend through type-safe Eden Treaty calls and share authentication through better-auth's client SDK with cookie-based sessions.

The primary technical risks are: (1) fixing the `as any` casts in `apps/api/src/index.ts` that break Eden Treaty type inference, (2) adding missing HTTP route handlers for billing commands/queries and admin operations that currently only exist as CQRS handlers, and (3) correctly configuring Tailwind 4 CSS-first approach across a Bun workspaces monorepo where Next.js uses PostCSS and Vite uses the `@tailwindcss/vite` plugin.

**Primary recommendation:** Start with the shared foundations (packages/ui, packages/api-client, backend route additions) in Plan 01, then build each app independently in Plans 02 and 03. The `as any` fix and missing billing routes are hard prerequisites -- without them, neither frontend can make typed API calls.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Create `packages/api-client/` as `@baseworks/api-client` -- exports a configured Eden Treaty client factory. Both apps import from this package.
- **D-02:** Fix Eden Treaty type coverage -- refactor `apps/api/src/index.ts` to eliminate `as any` casts. Auth and billing routes must be properly typed in the `App` export.
- **D-03:** Add missing billing HTTP routes -- billing CQRS commands and queries need Elysia route handlers.
- **D-04:** api-client package exports both Eden Treaty client AND better-auth client. Single import: `import { api, auth } from "@baseworks/api-client"`.
- **D-05:** Next.js 15 with App Router exclusively. React 19. Server Components by default, `"use client"` only when needed.
- **D-06:** Auth pages: `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/magic-link`. All client components.
- **D-07:** Dashboard layout at `/dashboard` with sidebar navigation. Protected via Next.js middleware.
- **D-08:** Billing pages: `/dashboard/billing` -- subscription status, plan selection, upgrade/downgrade.
- **D-09:** Tenant context: React context provider wrapping dashboard layout. Tenant switcher if multiple tenants.
- **D-10:** Next.js middleware: check for `better-auth.session_token` cookie, redirect to `/login` if missing.
- **D-11:** Use `@t3-oss/env-nextjs` for env validation: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL`.
- **D-12:** Vite 6 + React 19 SPA. React Router 7 with config-based routing. Package: `@baseworks/admin`.
- **D-13:** Admin auth: same better-auth instance, cookie-based. Admin-only via role check.
- **D-14:** Admin pages: tenant management, user management, billing overview, system health.
- **D-15:** Admin data tables: `@tanstack/react-table` for sortable, filterable, paginated tables.
- **D-16:** Admin requires additional backend API routes for cross-tenant operations.
- **D-17:** Use `@t3-oss/env-core` + Vite's `import.meta.env` for env validation.
- **D-18:** `packages/ui/` as `@baseworks/ui` -- shadcn/ui components, Tailwind 4 CSS config, `cn()` utility.
- **D-19:** Tailwind 4 CSS-first config -- no `tailwind.config.js`. CSS custom properties for design tokens.
- **D-20:** shadcn/ui initialized in `packages/ui/` -- components installed via CLI into `packages/ui/src/components/`.
- **D-21:** Initial component set: Button, Card, Input, Label, Form, Select, Table, Dialog, DropdownMenu, Sidebar, Avatar, Badge, Separator, Skeleton, Tabs, Toast/Sonner.
- **D-22:** Each app has its own Tailwind entry CSS importing shared base styles. Vite uses `@tailwindcss/vite`; Next.js uses PostCSS.
- **D-23:** `@tanstack/react-query` for all server state in both apps.
- **D-24:** `zustand` only if needed for client-side UI state.
- **D-25:** `nuqs` for URL-based state in Next.js customer app.
- **D-26:** `react-hook-form` + `@hookform/resolvers` with Zod schemas for all forms.
- **D-27:** Phase 4 splits into 3 plans: 04-01 shared foundations, 04-02 Next.js customer app, 04-03 Vite admin dashboard.

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

### Deferred Ideas (OUT OF SCOPE)
- Frontend testing (Vitest + Testing Library) -- defer to Phase 5
- Storybook for shared UI components
- Dark mode / theme switching
- Real-time updates via WebSockets
- Advanced admin features: audit log viewer, feature flag management, A/B testing
- PWA / offline support
- E2E testing (Playwright/Cypress)
- SSR optimization and caching strategies
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CUST-01 | Next.js app with authentication pages (login, signup, magic link, password reset) | better-auth React client SDK with `createAuthClient`, organization plugin, magic link plugin. All auth pages are client components using `useSession`, `signIn.email()`, `signUp.email()`, `forgetPassword()`, `resetPassword()`. |
| CUST-02 | Dashboard layout with sidebar navigation and protected routes | Next.js middleware checks `better-auth.session_token` cookie. shadcn Sidebar component from shared UI. App Router layout at `/dashboard/layout.tsx`. |
| CUST-03 | Billing pages (plan selection, subscription status, upgrade/downgrade) | Requires new billing HTTP routes (D-03) wrapping existing CQRS commands. Eden Treaty calls to `/api/billing/checkout`, `/api/billing/subscription`, `/api/billing/portal`, etc. |
| CUST-04 | Eden Treaty client wired for type-safe API calls | `@baseworks/api-client` package with `treaty<App>()` factory. Requires fixing `as any` casts in `apps/api/src/index.ts` first (D-02). |
| CUST-05 | Tenant context provider and switcher | better-auth organization plugin client: `useListOrganizations`, `useActiveOrganization`, `organization.setActive()`. React context wrapping dashboard layout. |
| ADMN-01 | Vite + React admin app with auth (admin-only access) | Vite 6 SPA, React Router 7 `createBrowserRouter`. better-auth client with CORS cookie auth. Role check via `organization.getActiveMemberRole()`. |
| ADMN-02 | Tenant management panel (list, view, edit, deactivate tenants) | Requires admin API routes (D-16). `@tanstack/react-table` for data tables. |
| ADMN-03 | User management panel (list users, view details, impersonate, ban/activate) | Requires admin API routes. Impersonation via better-auth's `admin.impersonateUser()` or custom endpoint. |
| ADMN-04 | Billing overview (subscription distribution, revenue, invoices) | Requires admin billing query endpoint aggregating across tenants. |
| ADMN-05 | System health panel (BullMQ queue depth, Redis stats, error rates) | Requires new health API endpoint querying BullMQ queue metrics and Redis info. |
| SHUI-01 | Shared UI package with shadcn/ui components and Tailwind 4 configuration | `packages/ui` with shadcn CLI, Tailwind 4 CSS-first config, `@source` directives for monorepo class scanning. |
| SHUI-02 | Eden Treaty client package shared across customer and admin apps | `packages/api-client` exporting both `treaty` client and `authClient` from single package. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 16.2.2 | Customer-facing SSR app | App Router, Server Components, React 19 support [VERIFIED: npm registry] |
| react | 19.2.4 | UI library | Required by Next.js 16, React Router 7 [VERIFIED: npm registry] |
| react-dom | 19.2.4 | React DOM renderer | Peer dependency [VERIFIED: npm registry] |
| @elysiajs/eden | 1.4.9 | Type-safe API client | Eden Treaty for end-to-end type safety with Elysia [VERIFIED: npm registry] |
| better-auth | 1.6.0 | Auth client SDK | Client SDK mirrors server auth config [VERIFIED: npm registry] |
| vite | 8.0.5 | Admin dashboard build tool | Fastest dev server for SPA [VERIFIED: npm registry] |
| react-router | 7.14.0 | Admin SPA routing | Config-based routing via `createBrowserRouter` [VERIFIED: npm registry] |
| tailwindcss | 4.2.2 | Utility-first CSS | CSS-first config, no JS config needed [VERIFIED: npm registry] |
| @tailwindcss/postcss | 4.2.2 | Tailwind PostCSS plugin | Required for Next.js (non-Vite) integration [VERIFIED: npm registry] |
| @tailwindcss/vite | 4.2.2 | Tailwind Vite plugin | Required for Vite admin dashboard [VERIFIED: npm registry] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @tanstack/react-query | 5.96.2 | Server state management | All API calls in both apps [VERIFIED: npm registry] |
| @tanstack/react-table | 8.21.3 | Headless data tables | Admin dashboard tables [VERIFIED: npm registry] |
| react-hook-form | 7.72.1 | Form management | All forms in both apps [VERIFIED: npm registry] |
| @hookform/resolvers | 5.2.2 | Zod-to-form bridge | Connects Zod schemas to react-hook-form [VERIFIED: npm registry] |
| zod | 4.3.6 | Runtime validation | Frontend form validation (note: backend uses TypeBox) [VERIFIED: npm registry] |
| zustand | 5.0.12 | Client state | UI state (sidebar, theme) -- not for server data [VERIFIED: npm registry] |
| nuqs | 2.8.9 | URL state | Next.js search params management [VERIFIED: npm registry] |
| sonner | 2.0.7 | Toast notifications | Both apps for user feedback [VERIFIED: npm registry] |
| lucide-react | 1.7.0 | Icons | Default shadcn icon library [VERIFIED: npm registry] |
| class-variance-authority | 0.7.1 | Variant styling | shadcn component variants [VERIFIED: npm registry] |
| clsx | 2.1.1 | Class joining | Part of `cn()` utility [VERIFIED: npm registry] |
| tailwind-merge | 3.5.0 | Class merging | Part of `cn()` utility [VERIFIED: npm registry] |
| tailwindcss-animate | 1.0.7 | Animations | Required by shadcn/ui [VERIFIED: npm registry] |
| @t3-oss/env-nextjs | 0.13.11 | Env validation | Next.js env vars [VERIFIED: npm registry] |
| @t3-oss/env-core | 0.13.11 | Env validation | Vite admin env vars [VERIFIED: npm registry] |
| date-fns | 4.1.0 | Date utilities | Formatting dates in UI [VERIFIED: npm registry] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| React Router 7 | TanStack Router | TanStack Router has better type safety but less documentation, smaller community. React Router is the locked decision. |
| sonner | react-hot-toast | sonner is shadcn/ui's default toast library. Better integration. |
| nuqs | manual URLSearchParams | nuqs provides type-safe, hook-based URL state with Next.js App Router integration. |

**Note on Next.js version:** npm registry shows Next.js 16.2.2 as latest. CLAUDE.md specifies `^15.0+`. Next.js 16 is a major version upgrade from 15. The CONTEXT.md decision D-05 says "Next.js 15 with App Router." The planner should use Next.js 15 (latest in the 15.x range) to match the locked decision, unless the user explicitly opts for 16. [VERIFIED: npm registry shows 16.2.2 as latest, but 15.x line likely still available]

**Note on Zod version:** npm registry shows Zod 4.3.6. This is a major version jump from Zod 3.x specified in CLAUDE.md. Zod 4 has breaking API changes. The planner should verify compatibility with `@hookform/resolvers` and `drizzle-zod` before adopting Zod 4. Using Zod 3.x may be safer. [ASSUMED -- needs validation]

**Installation (packages/ui):**
```bash
bun add tailwindcss tailwindcss-animate class-variance-authority clsx tailwind-merge lucide-react sonner
```

**Installation (packages/api-client):**
```bash
bun add @elysiajs/eden better-auth
```

**Installation (apps/web):**
```bash
bun add next@15 react react-dom @tanstack/react-query react-hook-form @hookform/resolvers zod nuqs @t3-oss/env-nextjs date-fns
bun add -d @tailwindcss/postcss postcss @types/react @types/react-dom
```

**Installation (apps/admin):**
```bash
bun add react react-dom react-router @tanstack/react-query @tanstack/react-table react-hook-form @hookform/resolvers zod @t3-oss/env-core date-fns
bun add -d vite @tailwindcss/vite @vitejs/plugin-react @types/react @types/react-dom
```

## Architecture Patterns

### Recommended Project Structure
```
packages/
  ui/                           # @baseworks/ui - shared UI components
    src/
      components/               # shadcn/ui components (Button, Card, etc.)
      hooks/                    # Shared hooks (useMediaQuery, etc.)
      lib/
        utils.ts                # cn() utility
      styles/
        globals.css             # Tailwind 4 base + design tokens
    components.json             # shadcn CLI config
    package.json
  api-client/                   # @baseworks/api-client - shared API client
    src/
      index.ts                  # Exports: api (Eden Treaty), auth (better-auth client)
      treaty.ts                 # Eden Treaty client factory
      auth-client.ts            # better-auth React client with plugins
    package.json

apps/
  web/                          # @baseworks/web - Next.js customer app
    app/
      (auth)/                   # Auth route group (no layout)
        login/page.tsx
        signup/page.tsx
        forgot-password/page.tsx
        reset-password/page.tsx
        magic-link/page.tsx
      (dashboard)/              # Dashboard route group
        layout.tsx              # Sidebar + tenant context provider
        dashboard/
          page.tsx              # Dashboard home
          billing/
            page.tsx            # Billing/subscription management
    components/                 # App-specific components
    lib/                        # App-specific utilities
    middleware.ts               # Auth cookie check
    components.json             # shadcn CLI config (points to packages/ui)
    next.config.ts
    postcss.config.mjs
    package.json

  admin/                        # @baseworks/admin - Vite admin dashboard
    src/
      routes/                   # Route components
        login.tsx
        tenants/
          list.tsx
          detail.tsx
        users/
          list.tsx
          detail.tsx
        billing/
          overview.tsx
        system/
          health.tsx
      components/               # Admin-specific components
      layouts/
        admin-layout.tsx        # Sidebar + nav
      lib/
        router.ts               # createBrowserRouter config
      main.tsx                  # Entry point
      App.tsx                   # Router provider + QueryClient
    components.json             # shadcn CLI config (points to packages/ui)
    index.html
    vite.config.ts
    package.json
```

### Pattern 1: Eden Treaty Client Factory
**What:** Centralized Eden Treaty client creation that both apps import.
**When to use:** Every API call from either frontend.
**Example:**
```typescript
// packages/api-client/src/treaty.ts
// Source: https://elysiajs.com/eden/treaty/overview
import { treaty } from "@elysiajs/eden";
import type { App } from "@baseworks/api"; // Type-only import from backend

export function createApiClient(baseUrl: string) {
  return treaty<App>(baseUrl, {
    fetch: {
      credentials: "include", // Send cookies for better-auth sessions
    },
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;
```

### Pattern 2: better-auth React Client with Plugins
**What:** Client SDK mirroring server auth config with organization and magic link plugins.
**When to use:** All auth operations in both apps.
**Example:**
```typescript
// packages/api-client/src/auth-client.ts
// Source: https://better-auth.com/docs/concepts/client
import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
// magicLink client plugin if available

export function createAuth(baseUrl: string) {
  return createAuthClient({
    baseURL: baseUrl,
    plugins: [
      organizationClient(),
    ],
  });
}
```

### Pattern 3: Next.js Middleware Auth Guard
**What:** Lightweight cookie check in Next.js middleware for protected routes.
**When to use:** Protecting `/dashboard/*` routes.
**Example:**
```typescript
// apps/web/middleware.ts
// Source: https://better-auth.com/docs/integrations/next
import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get("better-auth.session_token");
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
```

### Pattern 4: React Query + Eden Treaty Data Fetching
**What:** Using React Query with Eden Treaty for type-safe cached data fetching.
**When to use:** All data fetching in both apps.
**Example:**
```typescript
// Usage in a component
import { useQuery } from "@tanstack/react-query";
import { api } from "@baseworks/api-client";

function BillingPage() {
  const { data, isPending, error } = useQuery({
    queryKey: ["billing", "subscription"],
    queryFn: async () => {
      const { data, error } = await api.api.billing.subscription.get();
      if (error) throw error;
      return data;
    },
  });
  // ...
}
```

### Pattern 5: Tailwind 4 Monorepo CSS Architecture
**What:** Shared design tokens in UI package, consumed by both apps with different build tools.
**When to use:** All styling across the monorepo.
**Example:**
```css
/* packages/ui/src/styles/globals.css */
@import "tailwindcss";

/* Scan monorepo for class usage */
@source "../../apps/web/**/*.{ts,tsx}";
@source "../../apps/admin/**/*.{ts,tsx}";
@source "../api-client/**/*.{ts,tsx}";

@theme {
  --color-primary: oklch(0.55 0.2 250);
  --color-secondary: oklch(0.65 0.15 300);
  --radius-lg: 0.5rem;
  --radius-md: 0.375rem;
  --radius-sm: 0.25rem;
}
```

### Pattern 6: React Router 7 Config-Based SPA
**What:** Admin dashboard routing with `createBrowserRouter` (data mode).
**When to use:** Admin SPA route definitions.
**Example:**
```typescript
// apps/admin/src/lib/router.ts
// Source: https://reactrouter.com/start/modes
import { createBrowserRouter } from "react-router";

export const router = createBrowserRouter([
  {
    path: "/login",
    lazy: () => import("../routes/login"),
  },
  {
    path: "/",
    lazy: () => import("../layouts/admin-layout"),
    children: [
      { path: "tenants", lazy: () => import("../routes/tenants/list") },
      { path: "tenants/:id", lazy: () => import("../routes/tenants/detail") },
      { path: "users", lazy: () => import("../routes/users/list") },
      { path: "users/:id", lazy: () => import("../routes/users/detail") },
      { path: "billing", lazy: () => import("../routes/billing/overview") },
      { path: "system", lazy: () => import("../routes/system/health") },
    ],
  },
]);
```

### Anti-Patterns to Avoid
- **Separate fetch calls instead of React Query:** Never use raw `fetch` or `useEffect` for data fetching. Always use `@tanstack/react-query` with Eden Treaty.
- **Imperative navigation in middleware:** Do not call `auth.api.getSession()` from middleware -- this makes a network round-trip. Middleware should only check cookie existence (lightweight check). Full validation happens server-side.
- **Server Components using better-auth client:** better-auth's React client uses browser APIs (cookies, state). Auth pages and any component calling `useSession` must be `"use client"`.
- **Mutating Elysia app after type export:** Adding routes to the app object after `export type App = typeof app` will not be reflected in Eden Treaty types. All routes must be registered before the export.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Form state + validation | Custom form hooks | react-hook-form + @hookform/resolvers + Zod | Handles dirty tracking, error states, submission, async validation |
| Data fetching + caching | useEffect + useState | @tanstack/react-query | Handles stale-while-revalidate, cache invalidation, optimistic updates, retries |
| Data tables | Custom table components | @tanstack/react-table | Sorting, filtering, pagination, column visibility, row selection all built-in |
| Toast notifications | Custom notification system | sonner | Accessible, animated, stacking, auto-dismiss, promise-based |
| CSS utility merging | String concatenation | cn() from clsx + tailwind-merge | Resolves Tailwind class conflicts correctly |
| Auth state management | Custom session hook | better-auth's useSession | Auto-refreshes, syncs across tabs, handles expiration |
| URL state sync | Custom URLSearchParams | nuqs | Type-safe, debounced, Next.js App Router integrated |
| API type definitions | Manual TypeScript interfaces | Eden Treaty | Auto-infers from Elysia route definitions, zero codegen |

## Common Pitfalls

### Pitfall 1: Eden Treaty Returns `any` Due to Method Chaining
**What goes wrong:** Eden Treaty infers types from the Elysia app's type chain. If routes are added via `app.use(plugin as any)`, the `as any` cast breaks the type chain and Eden returns `any` for all routes from that plugin. [CITED: https://elysiajs.com/eden/installation]
**Why it happens:** The existing `apps/api/src/index.ts` uses `as any` on line 45 (`app.use(authRoutes as any)`) and line 77 (`registry.attachRoutes(app as any)`). This was a Phase 1/2 expedient.
**How to avoid:** Remove all `as any` casts. Auth routes and module routes must be typed correctly. May require refactoring the registry to return properly typed Elysia instances, or using Elysia's `.group()` and `.use()` with correct generic types. Elysia requires method chaining for type inference to work.
**Warning signs:** IDE shows `any` type on `api.api.billing.*` calls.

### Pitfall 2: Tailwind 4 CSS Not Scanning Monorepo Packages
**What goes wrong:** Tailwind 4 auto-detects content in the current package but does NOT automatically scan `node_modules` or linked workspace packages. Components from `@baseworks/ui` render without styles. [CITED: https://ui.shadcn.com/docs/monorepo]
**Why it happens:** Tailwind 4's automatic content detection respects `.gitignore` and doesn't traverse into `node_modules` (where workspace packages are linked).
**How to avoid:** Add `@source` directives in the shared CSS file pointing to all packages that contain Tailwind classes. Example: `@source "../../packages/ui/src/**/*.{ts,tsx}"` in each app's CSS.
**Warning signs:** Components render but have no styling. Utility classes appear in source but are not in the generated CSS.

### Pitfall 3: better-auth Client Plugins Must Mirror Server Plugins
**What goes wrong:** Calling `authClient.organization.setActive()` throws "method not found" or similar error.
**Why it happens:** The better-auth client must be configured with the same plugins as the server. Server has `organization()` and `magicLink()` plugins -- client needs `organizationClient()` (and magic link client if it exists). [CITED: https://better-auth.com/docs/plugins/organization]
**How to avoid:** Keep a single `createAuth()` factory in `@baseworks/api-client` that configures all client plugins to match the server.
**Warning signs:** TypeScript errors on `authClient.organization.*` methods. Runtime errors about missing methods.

### Pitfall 4: Cookie Not Sent Cross-Origin (Admin Dashboard)
**What goes wrong:** Admin dashboard (Vite SPA on port 5173) makes API calls to Elysia (port 3000), but session cookie is not sent.
**Why it happens:** Cross-origin requests don't include cookies by default. Both the fetch client and the server CORS config must explicitly enable credentials. [CITED: https://dev.to/eslachance/fixing-cors-in-your-spa-dfg]
**How to avoid:** (1) Eden Treaty client must use `credentials: "include"` in fetch config. (2) Elysia CORS must set `credentials: true` and specify explicit `origin` (not `*`). (3) better-auth's `trustedOrigins` must include the admin dashboard URL. In development, Vite proxy can avoid this entirely.
**Warning signs:** 401 errors from API despite successful login. Cookie visible in browser but not in request headers.

### Pitfall 5: Next.js Middleware CVE-2025-29927
**What goes wrong:** Middleware-only auth checks can be bypassed with a crafted `x-middleware-subrequest` header on self-hosted deployments.
**Why it happens:** Critical vulnerability patched in Next.js 14.2.25 and 15.2.3. [CITED: web search results]
**How to avoid:** (1) Always use a patched Next.js version (>= 15.2.3). (2) Defense in depth: never rely solely on middleware for authorization. Server-side session validation via better-auth must happen on every API call (already the case with tenant middleware).
**Warning signs:** N/A -- this is a security vulnerability, not a functional bug.

### Pitfall 6: Next.js 15 vs 16 Breaking Changes
**What goes wrong:** Installing `next@latest` gives Next.js 16.x which may have breaking changes from the 15.x expected by CONTEXT.md decisions.
**Why it happens:** npm `@latest` tag now points to 16.2.2. [VERIFIED: npm registry]
**How to avoid:** Pin to `next@15` explicitly: `bun add next@15`. Check Next.js 16 changelog before upgrading.
**Warning signs:** Unexpected API changes, deprecated middleware patterns.

### Pitfall 7: Zod 3 vs Zod 4 Compatibility
**What goes wrong:** Installing `zod@latest` gives Zod 4.x which has breaking API changes. `@hookform/resolvers` or `drizzle-zod` may not support Zod 4 yet.
**Why it happens:** Zod 4 was a major version bump with API changes. [VERIFIED: npm registry shows 4.3.6]
**How to avoid:** Pin to `zod@3` unless all dependencies confirm Zod 4 support. Check `@hookform/resolvers` and `drizzle-zod` compatibility.
**Warning signs:** TypeScript errors in form resolvers. Runtime errors in Zod schema validation.

## Code Examples

### Eden Treaty Client Package
```typescript
// packages/api-client/src/index.ts
// Source: https://elysiajs.com/eden/treaty/overview + https://better-auth.com/docs/concepts/client
export { createApiClient, type ApiClient } from "./treaty";
export { createAuth } from "./auth-client";

// Convenience: pre-configured instances for common use
// Apps can import these directly or create custom instances
```

### shadcn/ui components.json for Shared Package
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@baseworks/ui/components",
    "utils": "@baseworks/ui/lib/utils",
    "hooks": "@baseworks/ui/hooks",
    "lib": "@baseworks/ui/lib",
    "ui": "@baseworks/ui/components"
  }
}
```

### Next.js PostCSS Config for Tailwind 4
```javascript
// apps/web/postcss.config.mjs
// Source: https://tailwindcss.com/docs/installation/using-postcss
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

### Vite Config for Admin Dashboard
```typescript
// apps/admin/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
```

### React Query Provider Setup
```typescript
// Shared pattern for both apps
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Wrap app root with <QueryClientProvider client={queryClient}>
```

### Admin Billing Route Example (Backend Addition)
```typescript
// Added to billing module routes -- example of HTTP handler wrapping CQRS command
// Pattern from existing codebase: result pattern { success: true, data } / { success: false, error }
app.get("/api/billing/subscription", async (ctx: any) => {
  const result = await getSubscriptionStatus.handler({}, ctx.handlerCtx);
  if (!result.success) {
    return new Response(JSON.stringify(result), { status: 400 });
  }
  return result.data;
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| tailwind.config.js | CSS-first config with `@theme` | Tailwind v4 (Jan 2025) | No JS config file needed. Design tokens in CSS. |
| `@import "tailwindcss/base"` etc. | `@import "tailwindcss"` | Tailwind v4 | Single import replaces three-part import. |
| `pages/` directory | App Router with `app/` | Next.js 13+ | Server Components, nested layouts, streaming. |
| Eden Treaty v1 | Eden Treaty v2 (`treaty()`) | Elysia 1.0+ | New API: `treaty<App>()` instead of `edenTreaty<App>()`. |
| `zodResolver` from `@hookform/resolvers/zod` | Same pattern, check Zod 4 compat | Zod 4 (2025) | May need resolver update for Zod 4 schema format. |
| `createBrowserRouter` from `react-router-dom` | Import from `react-router` directly | React Router 7 | Package renamed, `react-router-dom` merged into `react-router`. |

**Deprecated/outdated:**
- `edenTreaty<App>()` (v1 API): Use `treaty<App>()` from `@elysiajs/eden` instead
- `tailwind.config.js` / `tailwind.config.ts`: Not needed in Tailwind 4 -- use CSS `@theme` directive
- `pages/` directory in Next.js: App Router is the standard. CONTEXT.md explicitly forbids pages dir.
- `react-router-dom` package: Merged into `react-router` in v7
- Next.js `middleware.ts` (deprecated in Next.js 16 in favor of `proxy.ts`): Use `middleware.ts` for Next.js 15 per locked decision

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Zod 4 may not be compatible with `@hookform/resolvers` and `drizzle-zod` | Standard Stack | Forms break at runtime. Mitigation: pin Zod 3. |
| A2 | Next.js 15.x latest is still available via `next@15` | Pitfall 6 | Would need to use 16.x or pin exact version. |
| A3 | better-auth has a magic link client plugin matching the server plugin | Pattern 2 | Magic link auth pages may need direct fetch calls instead. |
| A4 | `@source` directive in Tailwind 4 works with Bun workspace symlinks | Pitfall 2 | May need explicit file paths instead of package aliases. |
| A5 | Vite dev server proxy bypasses CORS cookie issues in development | Pitfall 4 | Would need to configure explicit CORS + credentials in dev. |
| A6 | `react-router` v7 `createBrowserRouter` works without the Vite plugin (non-framework mode) | Pattern 6 | May need `@react-router/dev` Vite plugin for data mode. |

## Open Questions

1. **Elysia `as any` Fix Strategy**
   - What we know: Lines 45 and 77 of `apps/api/src/index.ts` use `as any`, breaking Eden Treaty type chain.
   - What's unclear: Whether the registry pattern can return properly typed Elysia instances, or if routes need to be composed differently (e.g., direct method chaining instead of `registry.attachRoutes`).
   - Recommendation: In Plan 01, attempt to refactor by composing routes via `.use()` chains. If registry typing proves too complex, create a typed route aggregator that preserves the chain.

2. **Admin Cross-Tenant API Design**
   - What we know: Admin needs endpoints like `GET /api/admin/tenants`, `GET /api/admin/users`. These bypass tenant scoping.
   - What's unclear: Whether to create a separate Elysia group with its own middleware (no tenant context, just role check), or extend the existing route structure.
   - Recommendation: Create `/api/admin/*` route group with `requireRole("owner")` middleware. These routes use raw `db` (not `scopedDb`) for cross-tenant queries.

3. **Impersonation Mechanism**
   - What we know: ADMN-03 requires user impersonation.
   - What's unclear: Whether better-auth has a built-in impersonation feature, or if this needs a custom implementation.
   - Recommendation: Check better-auth docs for admin/impersonation plugin. Fallback: create a custom endpoint that creates a temporary session for the target user.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | Runtime, package manager | Yes | 1.3.10 | -- |
| Node.js | Next.js build | Yes | 22.13.1 | -- |
| PostgreSQL | Backend (existing) | Yes (Phase 1) | -- | -- |
| Redis | Backend (existing) | Yes (Phase 3) | -- | -- |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None. All required tooling is available.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Bun test (backend) / Vitest (frontend, deferred) |
| Config file | None for frontend (testing deferred per CONTEXT.md) |
| Quick run command | `bun test` (backend route tests only) |
| Full suite command | `bun test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CUST-01 | Auth pages render and call better-auth SDK | manual-only | N/A (frontend testing deferred) | N/A |
| CUST-02 | Dashboard protected by middleware | manual-only | N/A | N/A |
| CUST-03 | Billing pages call billing API routes | integration (backend routes) | `bun test packages/modules/billing/` | Partial -- webhook tests exist |
| CUST-04 | Eden Treaty type inference works | typecheck | `bun run typecheck` | N/A -- Wave 0 |
| CUST-05 | Tenant switcher changes active org | manual-only | N/A | N/A |
| ADMN-01 | Admin app renders with auth | manual-only | N/A | N/A |
| ADMN-02 | Tenant list/detail pages | manual-only | N/A | N/A |
| ADMN-03 | User management operations | manual-only | N/A | N/A |
| ADMN-04 | Billing overview displays data | manual-only | N/A | N/A |
| ADMN-05 | System health panel shows queue stats | manual-only | N/A | N/A |
| SHUI-01 | Shared UI components render correctly | manual-only | N/A | N/A |
| SHUI-02 | Eden Treaty client package works | typecheck | `bun run typecheck` | N/A -- Wave 0 |

### Sampling Rate
- **Per task commit:** `bun run typecheck` (ensures type safety across monorepo)
- **Per wave merge:** `bun test` (existing backend tests still pass)
- **Phase gate:** TypeScript compiles cleanly + manual smoke test of both apps

### Wave 0 Gaps
- [ ] `tsconfig.json` -- needs `.tsx` in include patterns for frontend packages
- [ ] New billing HTTP route tests in `packages/modules/billing/src/__tests__/`
- [ ] Admin API route tests

*(Frontend component testing explicitly deferred per CONTEXT.md)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | better-auth client SDK -- session cookie, CSRF via SameSite |
| V3 Session Management | Yes | better-auth database sessions, 7-day expiry, 24h refresh |
| V4 Access Control | Yes | Next.js middleware (lightweight) + server-side tenant middleware + requireRole |
| V5 Input Validation | Yes | Zod schemas via react-hook-form on frontend, TypeBox on backend |
| V6 Cryptography | No | No frontend crypto operations |

### Known Threat Patterns for Frontend Apps

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via user input | Tampering | React's built-in JSX escaping. Never use `dangerouslySetInnerHTML`. |
| CSRF on state-changing requests | Spoofing | better-auth session cookies with `SameSite=Lax`. Eden Treaty uses `credentials: "include"`. |
| Auth bypass via middleware-only checks | Elevation of Privilege | Defense in depth: middleware is lightweight cookie check; full session validation on backend. |
| Cookie theft on admin cross-origin | Information Disclosure | `httpOnly`, `secure`, `SameSite` on session cookies. CORS `credentials: true` with explicit origins. |
| Admin impersonation abuse | Elevation of Privilege | Audit log of impersonation events. Time-limited impersonation sessions. Role check before granting impersonation. |

## Sources

### Primary (HIGH confidence)
- [npm registry] - Verified all package versions (2026-04-06)
- [Elysia Eden Treaty docs](https://elysiajs.com/eden/treaty/overview) - Client setup, type inference requirements
- [Elysia Eden installation docs](https://elysiajs.com/eden/installation) - Type inference fixes, method chaining requirement
- [better-auth organization plugin](https://better-auth.com/docs/plugins/organization) - Client SDK setup, available methods, `setActive()`
- [better-auth Next.js integration](https://better-auth.com/docs/integrations/next) - Client creation, middleware pattern
- [shadcn/ui monorepo docs](https://ui.shadcn.com/docs/monorepo) - components.json config, workspace setup, CSS sharing
- [Tailwind CSS PostCSS install](https://tailwindcss.com/docs/installation/using-postcss) - `@tailwindcss/postcss` config for Next.js
- [React Router modes](https://reactrouter.com/start/modes) - SPA/data mode with `createBrowserRouter`

### Secondary (MEDIUM confidence)
- Existing codebase analysis - `apps/api/src/index.ts`, auth module, billing module, middleware patterns
- [Web search: Tailwind 4 monorepo](https://github.com/shadcn-ui/ui/discussions/6486) - `@source` directive for cross-package scanning

### Tertiary (LOW confidence)
- [Web search: CVE-2025-29927](https://www.authgear.com/post/nextjs-middleware-authentication) - Next.js middleware bypass vulnerability
- [Web search: React Router 7 SPA mode](https://blog.logrocket.com/react-router-v7-guide/) - createBrowserRouter without framework plugin

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All versions verified against npm registry. Zod 3 vs 4 flagged.
- Architecture: HIGH - Patterns derived from official docs and existing codebase patterns.
- Pitfalls: HIGH - Key pitfalls (Eden `as any`, Tailwind monorepo, CORS cookies) verified against official sources and codebase inspection.
- Integration points: MEDIUM - Some assumptions about better-auth magic link client plugin and Vite proxy behavior.

**Research date:** 2026-04-06
**Valid until:** 2026-05-06 (30 days -- stable ecosystem)
