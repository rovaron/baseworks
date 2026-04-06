# Technology Stack

**Project:** Baseworks (SaaS Starter Kit Monorepo)
**Researched:** 2026-04-05
**Overall Confidence:** MEDIUM -- All versions based on training data (cutoff May 2025). Run `bun add <package>@latest` during implementation to get actual current versions. No web/npm verification was possible during this research session.

## IMPORTANT: Version Verification Required

All version numbers below reflect the latest known as of May 2025 training data. Before starting implementation, run:

```bash
bun add elysia@latest better-auth@latest drizzle-orm@latest next@latest bullmq@latest stripe@latest
```

and verify the installed versions match or exceed what is listed here.

---

## Recommended Stack

### Core Runtime

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Bun | ^1.1+ | Runtime, package manager, workspace tool | Native TypeScript, fastest JS runtime, built-in workspace support, test runner. No transpilation step needed. | MEDIUM |
| TypeScript | ^5.5+ | Type system | Strict mode required. Bun runs TS natively. Used across all packages for end-to-end type safety with Eden Treaty. | HIGH |

### Backend Framework

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Elysia | ^1.1+ | HTTP framework | Built for Bun, fastest Bun-native framework. End-to-end type safety with Eden Treaty. Plugin architecture maps well to modular design. Schema validation built-in via TypeBox. | MEDIUM |
| @elysiajs/eden | ^1.1+ | Type-safe API client | Generates fully typed client from Elysia routes. Zero codegen, zero schema definition duplication. This is the primary reason to choose Elysia over Hono. | MEDIUM |
| @elysiajs/swagger | ^1.1+ | API documentation | Auto-generates OpenAPI docs from Elysia type definitions. Free documentation from existing types. | MEDIUM |
| @elysiajs/cors | ^1.1+ | CORS handling | Official CORS plugin. Needed for admin dashboard (Vite SPA) calling the API from a different origin. | MEDIUM |
| @elysiajs/bearer | ^1.1+ | Bearer token extraction | Clean extraction of auth tokens from headers. | LOW |

### Authentication

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| better-auth | ^1.2+ | Authentication | Framework-agnostic auth that works with any backend. Supports email/password, OAuth, magic links, sessions. Has Drizzle adapter. Does NOT lock you into Next.js like NextAuth/Auth.js does. | MEDIUM |
| @better-auth/cli | ^1.2+ | Auth schema generation | Generates Drizzle migration files for auth tables. Keeps auth schema in sync with better-auth internals. | MEDIUM |

**better-auth integration notes:**
- Use the Drizzle adapter (`better-auth/adapters/drizzle`) -- native integration, no ORM mismatch
- Session strategy: use database sessions (not JWT) for easy revocation and tenant context
- Mount better-auth's handler as an Elysia route group at `/api/auth/*`
- better-auth provides both server-side and client-side SDKs -- use the client SDK in both Next.js and admin dashboard

### Database & ORM

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Drizzle ORM | ^0.36+ | ORM / query builder | Type-safe, SQL-like syntax, no code generation step (unlike Prisma). Lightweight, works perfectly with Bun. Relational query API for complex joins. | MEDIUM |
| drizzle-kit | ^0.28+ | Migration tooling | Schema push and migration generation. `drizzle-kit generate` for migrations, `drizzle-kit push` for dev. | MEDIUM |
| drizzle-zod | ^0.7+ | Schema validation | Generates Zod schemas from Drizzle table definitions. Single source of truth for DB schema AND request validation. | MEDIUM |
| postgres (pglite or pg driver) | -- | PostgreSQL driver | Use `postgres` (postgres.js) as the driver -- it is the fastest PostgreSQL driver for Node/Bun and is what Drizzle recommends. Do NOT use `pg` (node-postgres). | MEDIUM |
| PostgreSQL | 16+ | Database | Production-grade RDBMS. Row-level security available if needed for tenant isolation later. JSONB for flexible metadata. | HIGH |

**Drizzle configuration notes:**
- Use `postgres` (postgres.js) driver, NOT `pg` (node-postgres) -- postgres.js is faster and has better Bun compatibility
- Enable `logger: true` in dev for query debugging
- Use `drizzle-kit generate` + `drizzle-kit migrate` for production migrations (not `push`)
- Define all tables with a `tenantId` column using a shared helper

### Queue & Background Jobs

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| BullMQ | ^5.0+ | Job queue | Redis-backed, battle-tested, supports delayed/scheduled/repeating jobs, rate limiting, priorities. The standard for Node.js job queues. | MEDIUM |
| ioredis | ^5.4+ | Redis client | Required by BullMQ. Also useful for caching and rate limiting. | HIGH |
| Redis | 7+ | Queue backend & cache | Required for BullMQ. Also serves as session store, rate limiter, and cache layer. | HIGH |

**BullMQ notes:**
- BullMQ works with Bun as of Bun 1.0+ (uses ioredis under the hood)
- Create named queues per module (e.g., `billing:sync-subscription`, `email:send`)
- Use BullMQ's `Worker` class in a separate entrypoint (`bun run worker`)
- Use BullMQ Board or bull-monitor for admin dashboard job monitoring

### Payments

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| stripe | ^17.0+ | Stripe SDK | Official Node.js SDK. Handles subscriptions, one-time payments, usage-based billing, customer portal, webhook verification. | MEDIUM |

**Stripe integration notes:**
- Use `stripe.webhooks.constructEvent()` for webhook signature verification -- critical for security
- Store Stripe customer ID and subscription ID in your database
- Use Stripe Customer Portal for self-service billing management (reduces code you write)
- Implement idempotency keys for all mutation API calls

### Frontend -- Customer App

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Next.js | ^15.0+ | Customer-facing app | SSR for SEO, App Router for layouts, Server Components for performance, Vercel deployment. | MEDIUM |
| React | ^19.0+ | UI library | Required by Next.js 15. React 19 brings Server Components, Actions, use() hook. | MEDIUM |

**Next.js notes:**
- Use App Router exclusively (no pages/ directory)
- Server Components by default, `"use client"` only when needed
- Use Next.js middleware for auth checks and tenant resolution
- Eden Treaty client should be initialized in a shared provider

### Frontend -- Admin Dashboard

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Vite | ^6.0+ | Build tool / dev server | Fastest dev server, no SSR overhead needed for admin. HMR is near-instant. | MEDIUM |
| React | ^19.0+ | UI library | Same React version as customer app for shared component compatibility. | MEDIUM |
| React Router | ^7.0+ | SPA routing | Standard for Vite + React SPAs. File-based routing available via plugin. | MEDIUM |

### Shared UI

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| shadcn/ui | latest (CLI) | Component library | Not a package -- it is a CLI that copies components into your project. Full control, no version lock-in. Accessible, well-designed defaults. | HIGH |
| Tailwind CSS | ^4.0+ | Styling | Utility-first CSS. v4 uses CSS-first configuration (no tailwind.config.js). Faster, simpler. | MEDIUM |
| @tailwindcss/vite | ^4.0+ | Tailwind Vite plugin | Required for Tailwind 4 in Vite projects. Replaces PostCSS-based setup. | MEDIUM |
| tailwindcss-animate | ^1.0+ | Animations | Required by shadcn/ui for component animations. | HIGH |
| class-variance-authority | ^0.7+ | Variant styling | Used by shadcn for component variants. Already a shadcn dependency. | HIGH |
| clsx + tailwind-merge | ^2.0+ / ^2.0+ | Class merging | `cn()` utility used everywhere in shadcn components. Standard pattern. | HIGH |
| lucide-react | ^0.400+ | Icons | Default icon library for shadcn/ui. Consistent, tree-shakeable. | HIGH |

### Validation & Schemas

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Zod | ^3.23+ | Runtime validation | Used by better-auth, drizzle-zod, and for CQRS command/query validation. Single validation library across the stack. | HIGH |

**Why Zod over TypeBox:**
Elysia uses TypeBox internally, but Zod is the ecosystem standard used by better-auth, drizzle-zod, and shadcn form validation. Use `@elysiajs/zod` plugin (if available) or convert Zod schemas to TypeBox at the Elysia boundary. Alternatively, define Elysia route schemas with TypeBox for maximum performance and use Zod only in CQRS command/query handlers.

**Recommended approach:** Use TypeBox for Elysia route definitions (it is native and faster) and Zod for everything else (CQRS handlers, form validation, drizzle-zod). This avoids fighting the framework.

---

## Supporting Libraries

### State Management & Data Fetching (Frontend)

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| @tanstack/react-query | ^5.50+ | Server state management | ALL API calls from both frontends. Handles caching, refetching, optimistic updates. | HIGH |
| zustand | ^5.0+ | Client state | Minimal client-side state (UI toggles, sidebar state). Do NOT use for server data -- that is React Query's job. | MEDIUM |
| nuqs | ^2.0+ | URL state | Search params management in Next.js. Use for filters, pagination, search. | MEDIUM |

### Forms

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| react-hook-form | ^7.53+ | Form management | All forms in both frontends. Uncontrolled by default (performant). | HIGH |
| @hookform/resolvers | ^3.9+ | Validation bridge | Connects Zod schemas to react-hook-form. | HIGH |

### Tables & Data Display

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| @tanstack/react-table | ^8.20+ | Headless table | Admin dashboard tables (users, tenants, billing). Sorting, filtering, pagination. | HIGH |

### Email

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| @react-email/components | ^0.0.25+ | Email templates | Transactional emails (welcome, password reset, billing). React-based email templates. | MEDIUM |
| resend | ^4.0+ | Email delivery | Sending transactional emails. Best DX, good free tier. Alternative: use nodemailer for self-hosted SMTP. | MEDIUM |

### Logging & Monitoring

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| pino | ^9.0+ | Structured logging | All backend logging. JSON output, fast, low overhead. | HIGH |
| pino-pretty | ^11.0+ | Dev log formatting | Development only. Pretty-prints pino JSON logs. | HIGH |

### Environment & Config

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| @t3-oss/env-nextjs | ^0.11+ | Env validation (Next.js) | Validates environment variables at build time in Next.js app. Zod-based. | MEDIUM |
| @t3-oss/env-core | ^0.11+ | Env validation (backend) | Same validation for the Elysia backend. Single pattern across the monorepo. | MEDIUM |

### Date & Time

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| date-fns | ^4.0+ | Date utilities | Date formatting, relative times. Tree-shakeable (unlike dayjs/moment). | HIGH |

### ID Generation

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| nanoid | ^5.0+ | ID generation | Public-facing IDs (tenant slugs, invite codes). NOT for primary keys -- use PostgreSQL UUIDs via `crypto.randomUUID()` or `gen_random_uuid()`. | HIGH |

---

## Development Tools

| Tool | Version | Purpose | Why | Confidence |
|------|---------|---------|-----|------------|
| Bun | ^1.1+ | Runtime + test runner | `bun test` replaces Vitest/Jest for backend tests. Built-in, fast, zero config. | MEDIUM |
| Vitest | ^2.0+ | Frontend test runner | For React component tests in admin dashboard and shared UI package. Better React Testing Library integration than `bun test`. | MEDIUM |
| @testing-library/react | ^16.0+ | Component testing | Standard for React component tests. Use with Vitest. | HIGH |
| Biome | ^1.9+ | Linter + formatter | Replaces ESLint + Prettier. Single tool, 10-100x faster. Bun-native. | MEDIUM |
| Docker | -- | Container runtime | Backend, workers, admin dashboard, PostgreSQL, Redis. Use multi-stage builds. | HIGH |
| docker-compose | -- | Local dev orchestration | Runs PostgreSQL + Redis for local development. | HIGH |
| @snaplet/seed | -- | Database seeding | Type-safe seed data generation from Drizzle schema. Useful for development and testing. | LOW |
| husky + lint-staged | -- | Git hooks | Pre-commit: Biome check. Pre-push: type check. | HIGH |

**Why Biome over ESLint + Prettier:**
Single binary, dramatically faster, handles both linting and formatting. Bun-native. The ESLint flat config migration is painful and unnecessary when Biome exists.

**Why `bun test` for backend, Vitest for frontend:**
`bun test` is excellent for pure logic (CQRS handlers, services, utilities). Vitest has better integration with jsdom/happy-dom and React Testing Library for component tests.

---

## Monorepo Structure

```
baseworks/
  package.json              # Root: Bun workspaces config
  bunfig.toml               # Bun configuration
  biome.json                # Shared linter/formatter config
  docker-compose.yml        # PostgreSQL + Redis for dev
  packages/
    shared/                 # @baseworks/shared
      src/
        types/              # Shared TypeScript types
        utils/              # Shared utilities (cn, formatDate, etc.)
        validators/         # Shared Zod schemas
    ui/                     # @baseworks/ui
      src/
        components/         # shadcn components (shared between apps)
    db/                     # @baseworks/db
      src/
        schema/             # Drizzle table definitions
        migrations/         # Generated migrations
        drizzle.config.ts
    email/                  # @baseworks/email
      src/
        templates/          # React Email templates
    api-client/             # @baseworks/api-client
      src/
        eden.ts             # Eden Treaty client setup
  apps/
    api/                    # Elysia API server
      src/
        modules/            # Medusa-style modules
          auth/
          billing/
          tenants/
          users/
        core/               # Module registry, CQRS bus, middleware
        entrypoints/
          api.ts            # bun run api
          worker.ts         # bun run worker
    web/                    # Next.js customer app
    admin/                  # Vite + React admin dashboard
```

**Workspace configuration (package.json):**
```json
{
  "workspaces": ["packages/*", "apps/*"]
}
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Runtime | Bun | Node.js | Bun is faster, has native TS, built-in tooling. User preference. |
| Backend | Elysia | Hono | Hono is more portable but lacks Eden Treaty for end-to-end type safety. Eden Treaty is the killer feature. |
| Backend | Elysia | Fastify | Fastify is Node.js-first, no Eden Treaty equivalent, heavier. |
| ORM | Drizzle | Prisma | Prisma has codegen step, heavier runtime, worse Bun compatibility, slower. |
| ORM | Drizzle | Kysely | Kysely is query-builder only, no migration tooling, no schema-to-Zod generation. |
| Auth | better-auth | NextAuth/Auth.js | NextAuth is too coupled to Next.js. Cannot share auth across Elysia + Next.js + admin dashboard cleanly. |
| Auth | better-auth | Lucia | Lucia was deprecated in early 2025. better-auth is its spiritual successor. |
| Auth | better-auth | Clerk/Auth0 | External service, paid, vendor lock-in. better-auth is self-hosted. |
| Queue | BullMQ | Quirrel | Quirrel is lighter but less mature, no dashboard, smaller ecosystem. |
| Queue | BullMQ | Trigger.dev | Cloud-dependent, overkill for background jobs. |
| Styling | Tailwind 4 | CSS Modules | Less utility, slower development, harder to share design tokens. |
| Linter | Biome | ESLint + Prettier | Two tools vs one. Biome is 100x faster. ESLint flat config migration is painful. |
| State | zustand | Redux | Redux is over-engineered for this use case. Zustand is simpler and smaller. |
| State | React Query | SWR | React Query has better mutation handling, devtools, and ecosystem. |
| Router (admin) | React Router | TanStack Router | React Router v7 is stable and well-documented. TanStack Router is newer with fewer resources. |
| Email | Resend | SendGrid | Resend has better DX, simpler API, works with React Email natively. |
| Monorepo | Bun workspaces | Turborepo | Extra dependency, extra config. Bun workspaces handle resolution natively. User preference. |
| Monorepo | Bun workspaces | Nx | Heavy, complex, overkill for <10 packages. |

---

## What NOT to Use

| Technology | Why Not | What to Use Instead |
|------------|---------|---------------------|
| Prisma | Codegen step, heavy client, worse Bun compat, slower queries | Drizzle ORM |
| NextAuth / Auth.js | Coupled to Next.js, cannot share across Elysia backend | better-auth |
| Lucia | Deprecated early 2025 | better-auth |
| tRPC | Requires adapter layer with Elysia, redundant when Eden Treaty exists | Eden Treaty |
| Express | Slow, no type safety, legacy | Elysia |
| Moment.js | Massive bundle, deprecated | date-fns |
| Mongoose | Wrong database (MongoDB) | Drizzle + PostgreSQL |
| Sequelize | Legacy ORM, poor TypeScript support | Drizzle |
| Redux / Redux Toolkit | Over-engineered for this use case | zustand (client) + React Query (server) |
| styled-components / Emotion | Runtime CSS-in-JS is dead. Performance cost, SSR complexity | Tailwind CSS |
| ESLint + Prettier | Two tools, slower, config hell | Biome |
| Jest | Slower, more config. Bun has built-in test runner | `bun test` (backend) / Vitest (frontend) |
| npm / yarn / pnpm | Bun is the chosen runtime; mixing package managers causes issues | Bun |
| pg (node-postgres) | Slower than postgres.js, worse Bun compatibility | postgres (postgres.js) |
| dotenv | Bun loads .env files natively. dotenv is redundant | Bun's built-in .env loading + @t3-oss/env |
| nodemon | Bun has `--watch` built in | `bun --watch` |

---

## Version Compatibility Matrix

**IMPORTANT:** These are best-known-compatible versions as of May 2025 training data. Verify at implementation time.

| Component | Requires | Notes |
|-----------|----------|-------|
| Elysia 1.1+ | Bun 1.0+ | Built exclusively for Bun runtime |
| Eden Treaty | Matches Elysia version | Keep in sync with Elysia version |
| Next.js 15+ | React 19+ | App Router, Server Components |
| Tailwind 4 | Vite plugin or PostCSS | CSS-first config (no tailwind.config.js in v4) |
| shadcn/ui | Tailwind 4 compatible | Recent shadcn CLI versions support Tailwind v4 |
| better-auth | Drizzle adapter available | Check better-auth docs for exact Drizzle adapter version |
| Drizzle ORM | postgres.js driver | `drizzle-orm/postgres-js` adapter |
| BullMQ 5+ | ioredis 5+ | Peer dependency |
| Biome 1.9+ | Any | Standalone binary, no runtime dependency |
| React Query 5+ | React 18+ or 19+ | Works with both React versions |

---

## Installation

```bash
# Initialize monorepo
bun init
# Edit package.json to add "workspaces": ["packages/*", "apps/*"]

# Core backend (apps/api)
bun add elysia @elysiajs/eden @elysiajs/swagger @elysiajs/cors
bun add better-auth
bun add drizzle-orm postgres
bun add bullmq ioredis
bun add stripe
bun add zod pino
bun add -d drizzle-kit @better-auth/cli

# Customer app (apps/web)
bun add next react react-dom
bun add @tanstack/react-query
bun add better-auth  # client SDK
bun add -d typescript @types/react @types/react-dom

# Admin dashboard (apps/admin)
bun add react react-dom react-router
bun add @tanstack/react-query @tanstack/react-table
bun add better-auth  # client SDK
bun add -d vite @vitejs/plugin-react typescript

# Shared UI (packages/ui)
bunx shadcn@latest init
bun add tailwindcss @tailwindcss/vite
bun add class-variance-authority clsx tailwind-merge
bun add lucide-react
bun add tailwindcss-animate

# Shared packages
bun add zod nanoid date-fns  # in packages/shared
bun add drizzle-zod           # in packages/db
bun add @react-email/components resend  # in packages/email

# Supporting (frontend)
bun add react-hook-form @hookform/resolvers
bun add zustand nuqs

# Dev tools (root)
bun add -d @biomejs/biome vitest @testing-library/react
bun add -d @t3-oss/env-core @t3-oss/env-nextjs

# Environment & logging
bun add pino pino-pretty
```

---

## Key Integration Points

### 1. Eden Treaty + Elysia (end-to-end types)
The API server exports its type. The client imports it. No codegen.

```typescript
// apps/api/src/index.ts
const app = new Elysia()
  .use(authModule)
  .use(billingModule)
  .use(tenantModule)
export type App = typeof app

// packages/api-client/src/eden.ts
import { treaty } from '@elysiajs/eden'
import type { App } from '@baseworks/api'  // workspace import
export const api = treaty<App>('http://localhost:3000')
```

### 2. Drizzle + better-auth
better-auth provides a Drizzle adapter. Auth tables are defined alongside your application tables.

### 3. Tailwind 4 in monorepo
Tailwind 4 uses CSS-first config. Each app imports the shared UI package's CSS. Use `@source` directive in CSS to include component paths from workspace packages.

### 4. CQRS with Zod validation
Commands and queries are plain objects validated with Zod schemas. Handlers are registered in the module registry.

```typescript
// Example CQRS command
const CreateTenantCommand = z.object({
  name: z.string().min(1),
  slug: z.string().min(3),
  ownerId: z.string().uuid(),
})
type CreateTenantCommand = z.infer<typeof CreateTenantCommand>
```

---

## Sources

- Training data (May 2025 cutoff) -- all version numbers are from this source
- No live verification was possible (WebSearch, WebFetch, Bash all unavailable during research)
- Elysia documentation: https://elysiajs.com
- better-auth documentation: https://www.better-auth.com
- Drizzle documentation: https://orm.drizzle.team
- BullMQ documentation: https://docs.bullmq.io
- Tailwind CSS v4: https://tailwindcss.com
- shadcn/ui: https://ui.shadcn.com

**Verification action items:**
1. Check Elysia latest version -- may have reached 1.2+ by April 2026
2. Check better-auth latest version -- actively developing, may have breaking changes
3. Check Drizzle ORM latest version -- was at 0.36.x, may have reached 1.0
4. Verify Tailwind 4 + shadcn compatibility -- was in early adoption as of May 2025
5. Verify BullMQ Bun compatibility for latest versions
6. Check if `@elysiajs/zod` plugin exists for native Zod support in Elysia routes
