# Phase 22: Admin Ops Tooling - Research

**Researched:** 2026-04-27
**Domain:** Operator UX (bull-board RBAC + admin iframe + health aggregation + worker heartbeat)
**Confidence:** HIGH (stack + APIs verified against npm registry + bull-board/Elysia/Vite docs; existing source patterns audited line-for-line)

## Summary

Phase 22 wires four well-defined pieces on top of an already-stable v1.3 observability foundation: (1) `@bull-board/elysia@7.0.0` mounted behind `requireRole("owner")` at `/admin/bull-board` with read-only mode toggled via `BULL_BOARD_READ_ONLY` env; (2) an admin sidebar entry rendering bull-board as a same-origin iframe via Vite dev-proxy; (3) a `/health/detailed` endpoint backed by a new `HealthAggregator` and `HealthContributor` slot on `ModuleDefinition`; (4) a real Redis worker heartbeat publisher via `setInterval` + `process.unref()` (Bun 1.2.11+) cleared on graceful shutdown.

Every external library and pattern this phase depends on is verified in current production use: `@bull-board/elysia` v7.0.0 (published 2026-04-20, ~one week before this phase) ships an official Bun example with `bun --watch` and `bun build --target bun`; `elysia ^1.1.0` peer dep is already satisfied by the project's `elysia ^1.4.28`; Vite `server.proxy` cookie forwarding is mature and documented; Bun added `process.unref(timer)` in v1.2.11. The single non-obvious gotcha is the **mandatory** `uiBasePath: 'node_modules/@bull-board/ui'` option needed to work around a Bun eval issue (oven-sh/bun#5809) — without it, the build fails.

**Primary recommendation:** Wire each deliverable as a separate Elysia plugin file (`apps/api/src/routes/bull-board.ts`, `apps/api/src/routes/health-detailed.ts`) so requireRole composition stays one-line and unit-testable. Keep the heartbeat publisher and HealthAggregator in `packages/observability` (the only package both api and worker already import) so the type surface stays inside the existing observability port boundary.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Mount path = `/admin/bull-board` (root, NOT under `/api/admin/`). Separate top-level segment outside the `/api/admin/*` prefix used by `apps/api/src/routes/admin.ts`. Both segments protected by `requireRole("owner")` via separate Elysia plugin mounts.

- **D-02:** Read-only mode default ON via `BULL_BOARD_READ_ONLY` env (default `"true"`). Use `@bull-board/api`'s built-in per-queue `readOnlyMode: true` option. `@t3-oss/env-core` schema validates as `z.enum(["true","false"]).default("true")` — typo crashes at boot.

- **D-03:** `requireRole("owner")` covers static assets too. The `@bull-board/elysia` adapter exposes a single Elysia plugin — wrapping the entire mount in `.use(requireRole("owner"))` derives the role check on every request including HTML / CSS / JS / WebSocket-upgrade.

- **D-04:** Admin-origin CSP — set `Content-Security-Policy: frame-ancestors '${ADMIN_URL}'` on the `/admin/bull-board/*` response set. `X-Frame-Options` dropped in favor of CSP `frame-ancestors`. When `ADMIN_URL` is unset, degrades to `frame-ancestors 'none'`.

- **D-05:** Same-origin iframe via reverse-proxy. In dev, Vite dev server proxies `/admin/bull-board/*` to `http://localhost:3000` via `vite.config.ts` server.proxy. In production, an nginx/Caddy/Traefik layer routes `/admin/bull-board/*` to the API service. Result: bull-board appears at `${ADMIN_URL}/admin/bull-board` from the browser's perspective; better-auth session cookie sent automatically.

- **D-06:** Sidebar entry "Job Monitor" with lucide `ListTodo` icon, route path `/jobs`. Thin `<iframe src="/admin/bull-board" title="Job Monitor" className="w-full h-[calc(100vh-3.5rem)] border-0" />` rendered inside `AdminLayout`'s main content slot. i18n key `nav.jobs` added to en + pt-BR.

- **D-07:** Endpoint = `GET /health/detailed`, RBAC = `requireRole("owner")`, response shape is `data` envelope with `{ status, timestamp, uptime, queues, workers, db, recentErrors, modules }`. Existing `/api/admin/system/health` becomes a thin alias / deprecated stub redirecting to `/health/detailed`. Phase 22 ships both routes; remove old route in v1.4 cleanup.

- **D-08:** Endpoint location: top-level on the API root, NOT mounted via the `module-auth` admin routes plugin. New file `apps/api/src/routes/health-detailed.ts` exposes its own Elysia plugin at the API root (next to `/health` Docker probe).

- **D-09:** Default queue depth thresholds: `warn=100`, `critical=1000`. Hardcoded in the aggregator, not env-tunable in v1.3. Matches existing `apps/admin/src/routes/system/health.tsx:32-35` `getQueueStatus` thresholds.

- **D-10:** Extend `ModuleDefinition` with optional `health?: HealthContributor` slot. Mirrors how `commands` / `queries` / `jobs` are declared today. Worst-of-N rollup: any `unhealthy` → overall `unhealthy`; any `degraded` → overall `degraded`; otherwise `healthy`.

- **D-11:** Aggregator runs contributors in parallel via `Promise.allSettled` with per-contributor timeout (default 2000ms via `Promise.race`). Total budget for `/health/detailed` ≤ 3 seconds. Cache last successful aggregation for 5 seconds (in-memory) to debounce admin UI's `refetchInterval: 30000`.

- **D-12:** Heartbeat key shape `worker:heartbeat:{instanceId}` (Redis SET with EX TTL). `instanceId` = `process.env.INSTANCE_ID` → `process.env.HOSTNAME` → `os.hostname()`. Value JSON: `{ instanceId, queues, lastHeartbeat, version? }`. TTL = `2 × WORKER_HEARTBEAT_INTERVAL_MS`. Reading uses `SCAN 0 MATCH worker:heartbeat:*` not `KEYS`.

- **D-13:** Heartbeat interval default 15 seconds, env-tunable via `WORKER_HEARTBEAT_INTERVAL_MS` (z.coerce.number with min 1000, max 300000, default 15000). Derived thresholds (D-07 worker.status): `healthy` if `age < 2 × interval` (≤30s), `stale` if `age < 5 × interval` (≤75s), `dead` if older or missing. Ratio hardcoded.

- **D-14:** Worker publishes via `setInterval` started after `registry.loadAll()` and before workers attach. Wraps in try/catch (Redis hiccup logs warn, does not crash). Cleared on graceful shutdown via existing `shutdown()` handler (apps/api/src/worker.ts:154). Single timer per worker process, regardless of how many BullMQ Workers it owns.

- **D-15:** In-memory ringbuffer fed by `RingBufferingErrorTracker` decorator wrapping `getErrorTracker()`. Capacity 50, deduped by `error.message + first stack frame`. NOT a Sentry API query. Memory bound: 50 × ~600 bytes = 30 KB/process. Cleared on process restart.

- **D-16:** Per-module status defaults to `loaded ? "healthy" : "unhealthy"` when a module declares no `HealthContributor`. v1.3 ships only auth, billing, example modules — none ships a `HealthContributor` in this phase (intentional minimal-footprint cut).

### Claude's Discretion

- Exact icon for "Job Monitor" sidebar entry — `ListTodo` recommended from lucide; substitute if visual reviewer disagrees.
- Iframe loading skeleton / error state UI in `/jobs` route — reuse patterns from `apps/admin/src/routes/system/health.tsx` (Skeleton + Card + retry button).
- Exact CSP headers beyond `frame-ancestors` — let executor add reasonable defaults (no inline scripts in bull-board's own page).
- Whether `/health/detailed` includes a `version` field — recommended yes (read from `package.json`).
- Whether to emit a span around each contributor's `check()` — recommended yes (uses Phase 17/19 wrappers).

### Deferred Ideas (OUT OF SCOPE)

- Per-queue threshold overrides (deferred to v1.4)
- Native bull-board UI inside Vite SPA (explicitly Out of Scope per PROJECT.md)
- Sentry-sourced recent errors (defer until ringbuffer proves insufficient)
- Tenant-scoped admin views of jobs/queues (bull-board is process-global)
- Cross-replica error-aggregation across multiple API processes (requires Redis pub/sub)
- `HealthContributor` for auth/billing/example modules (slot ships, modules don't populate)
- `/metrics` Prometheus scrape endpoint (deferred per REQUIREMENTS.md MET-future-01)
- Runbook entries for "bull-board inaccessible" alert (Phase 23 territory)
- Module-version reporting in `/health/detailed`
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OPS-01 | Operator sees `@bull-board/elysia` mounted at `/admin/bull-board` behind `requireRole("owner")`, with read-only mode enabled by default via feature-flag env and admin-origin CSP | Standard Stack §`@bull-board/elysia` + Pattern 1 §bull-board mount + Pattern 4 §CSP frame-ancestors |
| OPS-02 | Admin user sees a bull-board entry in the Vite admin dashboard sidebar, rendered as a same-origin iframe sharing the better-auth session cookie | Standard Stack §Vite proxy + Pattern 2 §Same-origin reverse proxy + Pattern 6 §Iframe in admin layout |
| OPS-03 | Admin user sees a `/health/detailed` endpoint + admin dashboard page showing queue depth, worker heartbeat, DB lag, recent errors, and per-module status | Pattern 3 §HealthAggregator + Pattern 5 §DB lag probe + Pattern 7 §Recent-errors ringbuffer |
| OPS-04 | Module author can register a `HealthContributor` at module registration time; central aggregator rolls up all contributions into overall status surfaced by OPS-03 | Pattern 3 §HealthAggregator + Architecture §Module registry extension |
| EXT-02 | Operator sees workers publishing heartbeat keys to Redis on a configurable interval, so OPS-03's worker heartbeat status reflects real state, not a mock | Pattern 8 §Worker heartbeat publisher (setInterval + Redis SET EX + graceful shutdown) |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| bull-board UI assets (HTML/CSS/JS) | API (Elysia) | — | bull-board ships an Elysia adapter that owns the sub-tree; static assets must travel through `requireRole("owner")` so they cannot be retrieved unauthenticated. Mounting on the SPA tier would lose RBAC. |
| bull-board RBAC enforcement | API (Elysia) | — | Auth happens server-side; better-auth session cookie is read by `requireRole` derive. Browser/SPA cannot enforce RBAC — only display. |
| `/health/detailed` aggregation | API (Elysia) | Worker heartbeat (Redis writer) | Operator-scope query; raw `db` (not scopedDb) per Phase 20.1 D-07. Worker's only role is heartbeat publishing — API reads the keys. |
| Worker heartbeat publishing | Worker (BullMQ runtime) | — | Heartbeat is the worker's self-report; only the worker process knows when it's alive. Bridge via Redis (existing infra, no new dep). |
| Iframe wrapper + sidebar UX | Admin (Vite SPA) | — | Pure presentation; React Router 7 outlet renders an `<iframe>` element. Layout/navigation belongs in the SPA, not the API. |
| Same-origin proxy `/admin/bull-board/*` | Frontend Server (Vite dev / nginx prod) | API | Browser-level requirement: cookie SameSite/Origin must match. Vite/nginx forwards; API serves. |
| Recent-errors ringbuffer | Process-local (API process) | — | In-memory by design (D-15). Any cross-replica aggregation is deferred. |
| Module health contributors | API/Worker (registry consumers) | — | `loadAll()` collects `def.health` at registration; lives in registry layer same as `def.commands` / `def.queries`. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@bull-board/api` | `7.0.0` | Headless bull-board core (queue adapters, REST API) | Official bull-board package; no alternative for BullMQ queue inspection UI. Published 2026-04-20. [VERIFIED: npm view @bull-board/api] |
| `@bull-board/elysia` | `7.0.0` | Elysia server adapter for bull-board | Ships an official `examples/with-elysia` using `bun --watch` + `bun build --target bun`. Peer dep `elysia ^1.1.0` (project ships ^1.4.28). Published 2026-04-20. [VERIFIED: npm view @bull-board/elysia] [CITED: github.com/felixmosh/bull-board/tree/master/examples/with-elysia] |
| `@bull-board/ui` | `7.0.0` | Bundled UI assets (CSS/JS/HTML) | Auto-installed as transitive dep of `@bull-board/elysia`. Required at runtime (the `uiBasePath` option points at `node_modules/@bull-board/ui` to bypass Bun eval issue oven-sh/bun#5809). [VERIFIED: npm view @bull-board/elysia dependencies] |
| `bullmq` | `^5.0.0` (existing) | Queue/Worker primitives | Already a project dep; bull-board's `BullMQAdapter` wraps existing `Queue` instances. [VERIFIED: packages/queue/package.json] |
| `ioredis` | `^5.4.0` (existing) | Redis client for heartbeat publisher | Already used via `getRedisConnection()` in `packages/queue/src/connection.ts`. Heartbeat publisher reuses this — NOT a new connection pool. [VERIFIED: source] |
| `elysia` | `^1.4.28` (existing) | HTTP framework | Already at version that satisfies `@bull-board/elysia` peer. [VERIFIED: apps/api/package.json] |
| `drizzle-orm` | `^0.45.0` (existing) | DB lag probe via `db.execute(sql\`SELECT 1\`)` | Already used; Phase 22 reuses the existing `db` instance for the lag probe. [VERIFIED: apps/api/package.json + apps/api/src/index.ts:106] |
| `@t3-oss/env-core` | `^0.13.11` (existing) | Schema validation for new env vars | Crash-hard pattern matches Phase 17 D-09. [VERIFIED: packages/config/src/env.ts] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@tanstack/react-query` | `^5.100.5` (existing) | Polling `/health/detailed` from admin UI | Same `useQuery + refetchInterval: 30000` pattern as `apps/admin/src/routes/system/health.tsx`. [VERIFIED: npm view @tanstack/react-query] |
| `lucide-react` | `^1.11.0` (existing — confirm exact version in apps/admin) | `ListTodo` icon for sidebar | Already imported throughout admin layout. [VERIFIED: apps/admin/src/layouts/admin-layout.tsx:31] |
| `pino` | `^10.0.0` (existing) | Heartbeat publisher logs Redis hiccups | Existing logger via `apps/api/src/lib/logger.ts`. [VERIFIED: apps/api/package.json] |
| `@opentelemetry/api` | `^1.9.1` (existing) | Optional spans around contributor `check()` calls | Available but optional per Claude's Discretion. [VERIFIED: existing] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@bull-board/elysia` | `@bull-board/express` behind a Bun shim | Mounting Express inside Elysia adds a runtime adapter layer and double-handler chain; `@bull-board/elysia` is the native fit. Express adapter would also lose `requireRole` derive integration. **Use Elysia adapter.** |
| `@bull-board/elysia` | `@bull-board/bun` | The `@bull-board/bun` adapter exists but targets raw `Bun.serve` without an Elysia plugin surface. We need the plugin shape so `.use(requireRole("owner")).use(serverAdapter.registerPlugin())` composes. **Use Elysia adapter.** |
| Same-origin iframe | Token-passing iframe with `credentials: include` | Token-passing requires the SPA to fetch a session token, embed it in iframe URL or post-message it post-load — extra surface, extra token-rotation, extra bug class. Same-origin proxy needs zero such handling. **Use same-origin proxy.** |
| `setInterval` heartbeat | BullMQ scheduler / repeating job | Repeating jobs run inside a Worker — circular dependency: a sick Worker won't publish a "sick" heartbeat. `setInterval` runs in the worker's own event loop and naturally stops when the process dies. **Use `setInterval`.** |
| Sentry API for recent errors | Process-local ringbuffer | Sentry API requires a project read token, token rotation, network egress on every admin page load, and breaks when `ERROR_TRACKER=noop`. **Use ringbuffer (D-15).** |
| `Promise.all` for contributors | `Promise.allSettled` | `Promise.all` rejects on first failure → one slow contributor sinks the whole endpoint. `allSettled` lets us record per-contributor failures and still return the rest. **Use `allSettled` (D-11).** |
| `KEYS worker:heartbeat:*` | `SCAN 0 MATCH worker:heartbeat:*` | `KEYS` is O(n) and blocks Redis under load. `SCAN` is incremental and production-safe. **Use SCAN (D-12).** |

**Installation:**
```bash
# In apps/api (or workspace root if hoisted)
bun add @bull-board/api @bull-board/elysia
# Heartbeat publisher and HealthAggregator live in @baseworks/observability — no new deps there.
# Frontend uses existing @tanstack/react-query and lucide-react.
```

**Version verification (2026-04-27):**
- `@bull-board/api@7.0.0` — published 2026-04-20 (~1 week old) [VERIFIED: npm view]
- `@bull-board/elysia@7.0.0` — published 2026-04-20 [VERIFIED: npm view]
- `elysia@1.4.28` — current [VERIFIED: npm view]
- `drizzle-orm@0.45.2` — current; project on ^0.45.0 (compatible) [VERIFIED: npm view]
- `postgres.js@3.4.9` — current postgres.js driver [VERIFIED: npm view]
- `bullmq@5.76.2` — current; project on ^5.0.0 (compatible) [VERIFIED: npm view]
- `ioredis@5.10.1` — current [VERIFIED: npm view]

**Bun runtime requirement:** Heartbeat publisher uses `process.unref(timer)` which landed in Bun 1.2.11 [CITED: bun.com/blog/bun-v1.2.11]. Project `CLAUDE.md` lists `Bun ^1.1+` — verify deployment Bun is ≥1.2.11 OR fall back to a plain interval reference (the timer will block process exit slightly until cleared in `shutdown()`). Recommendation: document the 1.2.11 requirement in `.env.example` / installation docs.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ Browser (operator with role="owner")                                │
│                                                                     │
│  ┌─────────────────────────────────────────┐                        │
│  │ Admin SPA (Vite)                        │                        │
│  │  ┌───────────────────┐                  │                        │
│  │  │ Sidebar            │                  │                        │
│  │  │ - Tenants          │                  │                        │
│  │  │ - Users            │                  │                        │
│  │  │ - Billing          │                  │                        │
│  │  │ - System (/health/detailed UI) ◀──┐  │                        │
│  │  │ - Job Monitor (/jobs)─────────┐   │  │                        │
│  │  └───────────────────────────────┼───┼──┘                        │
│  │                                  │   │                            │
│  │  ┌───────────────────────────────▼┐  │                            │
│  │  │ /jobs route                    │  │                            │
│  │  │  <iframe src="/admin/bull-board"/>┐│                           │
│  │  └────────────────────────────────┘ ││                            │
│  └──────────────────────────────────┘  ││                            │
└─────────────────────────────────────────┼┼────────────────────────────┘
              │                           ││ same origin
              │ session cookie            ││
              ▼                           ▼▼
┌─────────────────────────────────────────────────────────────────────┐
│ Vite dev / nginx prod (reverse proxy on ${ADMIN_URL})               │
│                                                                     │
│  /api/*                  → http://localhost:3000/api/*              │
│  /admin/bull-board/*     → http://localhost:3000/admin/bull-board/* │
│  /health/detailed (admin)→ http://localhost:3000/health/detailed    │
└─────────────────────────────────────────────────────────────────────┘
              │                           │
              ▼                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ apps/api (Elysia + Bun)                                             │
│                                                                     │
│  GET /health (unauth, Docker probe) ─── existing, unchanged         │
│                                                                     │
│  GET /health/detailed (requireRole owner) ─── NEW                   │
│       │                                                             │
│       ▼                                                             │
│   HealthAggregator.aggregate()                                      │
│   ┌───────────────────────────────────────────────────────────┐    │
│   │ Promise.allSettled([                                       │    │
│   │   queueDepthProbe(registry),       // BullMQ getJobCounts │    │
│   │   workerHeartbeatProbe(redis),     // SCAN worker:heartbeat:*  │
│   │   dbLagProbe(db),                  // db.execute(SELECT 1)│    │
│   │   recentErrorsProbe(ringBuffer),   // RingBufferingErrorTracker│
│   │   ...moduleContributors,           // def.health.check()  │    │
│   │ ], timeoutMs=2000)                                        │    │
│   │ Aggregate worst-of-N status                                │    │
│   │ Cache result for 5s                                        │    │
│   └───────────────────────────────────────────────────────────┘    │
│                                                                     │
│  /admin/bull-board/* (requireRole owner) ─── NEW                    │
│       │  Elysia plugin scope: requireRole + serverAdapter.registerPlugin()│
│       │  onAfterHandle: set CSP frame-ancestors                     │
│       ▼                                                             │
│   ElysiaAdapter (from @bull-board/elysia)                           │
│       │                                                             │
│       ▼                                                             │
│   createBullBoard({ queues: [BullMQAdapter(q, {readOnlyMode})], serverAdapter })│
│       │                                                             │
└───────┼─────────────────────────────────────────────────────────────┘
        │                                                              
        ▼                                                              
┌─────────────────────────────────────────────────────────────────────┐
│ Redis                                                               │
│                                                                     │
│  bull:* (BullMQ data)                                               │
│  worker:heartbeat:{instanceId} = {                                  │
│    instanceId, queues: [...], lastHeartbeat: ISO, version           │
│  }                                                                  │
│  TTL = 2 × WORKER_HEARTBEAT_INTERVAL_MS                             │
└─────────────────────────────────────────────────────────────────────┘
        ▲                                                              
        │ SET worker:heartbeat:... EX <ttl>                             
        │                                                              
┌─────────────────────────────────────────────────────────────────────┐
│ apps/api worker.ts (Bun, INSTANCE_ROLE=worker)                      │
│                                                                     │
│  await registry.loadAll()                                           │
│  startHeartbeatPublisher({                                          │
│    redis: getRedisConnection(redisUrl),                             │
│    instanceId, queues: workers.map(w => w.name),                    │
│    intervalMs: env.WORKER_HEARTBEAT_INTERVAL_MS                     │
│  })  // setInterval + process.unref(); cleared in shutdown()        │
└─────────────────────────────────────────────────────────────────────┘
```

**Component responsibilities:**

| Component | File (new or extended) | Responsibility |
|-----------|------------------------|----------------|
| Bull-board mount | `apps/api/src/routes/bull-board.ts` (NEW) | Construct `ElysiaAdapter`, `createBullBoard` with all module queues, wrap in `requireRole("owner")`, set CSP onAfterHandle |
| Health-detailed route | `apps/api/src/routes/health-detailed.ts` (NEW) | requireRole("owner") + invoke `registry.getHealthAggregator().aggregate()` + 5s cache |
| Health aggregator | `packages/observability/src/health/aggregator.ts` (NEW) | Run contributors via `Promise.allSettled` + per-contributor `Promise.race` timeout; rollup status |
| Health contributor types | `packages/shared/src/types/module.ts` (EXTENDED) | Add `health?: HealthContributor` slot |
| Worker heartbeat publisher | `packages/observability/src/health/heartbeat.ts` (NEW) | `setInterval` writing `worker:heartbeat:{instanceId}` with TTL; cleanup hook |
| Heartbeat reader | `packages/observability/src/health/heartbeat.ts` (NEW) | `SCAN worker:heartbeat:*`, JSON.parse, derive `healthy/stale/dead` per D-13 |
| Recent errors ringbuffer | `packages/observability/src/lib/ring-buffer-error-tracker.ts` (NEW) | Decorator wrapping `getErrorTracker()`; capacity 50, dedup by message+frame |
| Module registry extension | `apps/api/src/core/registry.ts` (EXTENDED) | Collect `def.health` into HealthAggregator; expose `getHealthAggregator()` |
| Worker bootstrap | `apps/api/src/worker.ts` (EXTENDED) | Start heartbeat after `loadAll()`; add cleanup in `shutdown()` |
| Env schema | `packages/config/src/env.ts` (EXTENDED) | Add `BULL_BOARD_READ_ONLY` + `WORKER_HEARTBEAT_INTERVAL_MS` |
| Admin sidebar | `apps/admin/src/layouts/admin-layout.tsx` (EXTENDED) | Add `{ titleKey: "nav.jobs", icon: ListTodo, href: "/jobs" }` |
| Admin /jobs route | `apps/admin/src/routes/jobs/index.tsx` (NEW) | Iframe wrapper |
| Vite proxy | `apps/admin/vite.config.ts` (EXTENDED) | Add `/admin/bull-board` proxy entry |
| i18n keys | `packages/i18n/src/locales/{en,pt-BR}/admin.json` (EXTENDED) | `nav.jobs` + healthDetailed keys |

### Recommended Project Structure (deltas)
```
apps/api/src/
├── routes/
│   ├── admin.ts            # existing, unchanged (deprecated alias adds 1 line)
│   ├── bull-board.ts       # NEW — Elysia plugin: requireRole + ElysiaAdapter
│   └── health-detailed.ts  # NEW — Elysia plugin: requireRole + aggregator
├── core/
│   └── registry.ts         # EXTENDED — collect def.health, expose getHealthAggregator()

packages/observability/src/
├── health/
│   ├── aggregator.ts       # NEW — HealthAggregator class
│   ├── contributors/
│   │   ├── queue-depth.ts  # NEW — built-in (uses BullMQ Queue.getJobCounts)
│   │   ├── worker-heartbeat.ts # NEW — built-in (SCAN heartbeat keys)
│   │   ├── db-lag.ts       # NEW — built-in (SELECT 1 round-trip)
│   │   └── recent-errors.ts# NEW — built-in (drains ringbuffer)
│   └── heartbeat.ts        # NEW — startHeartbeatPublisher + readHeartbeats
└── lib/
    └── ring-buffer-error-tracker.ts # NEW — decorator on ErrorTracker port

packages/shared/src/types/
└── module.ts               # EXTENDED — HealthContributor + HealthCheckResult types

apps/admin/src/
├── layouts/admin-layout.tsx # EXTENDED — navItems gains nav.jobs entry
├── lib/router.ts           # EXTENDED — adds { path: "jobs", lazy: () => import("../routes/jobs") }
├── routes/
│   └── jobs/
│       └── index.tsx       # NEW — iframe wrapper component (export Component)
└── vite.config.ts          # EXTENDED — proxy /admin/bull-board → :3000
```

### Pattern 1: Bull-board mount with RBAC + CSP (Elysia plugin file)

**What:** Compose `requireRole("owner")` + `ElysiaAdapter.registerPlugin()` + post-handle CSP header in a single Elysia plugin file.

**When to use:** This is the only way to mount bull-board such that ALL requests (HTML/CSS/JS/static) flow through the role check.

**Example:**
```typescript
// apps/api/src/routes/bull-board.ts
// Source: github.com/felixmosh/bull-board/tree/master/examples/with-elysia (verified 2026-04-27)
// Source: github.com/felixmosh/bull-board/blob/master/README.md#queue-options (readOnlyMode)
import { Elysia } from "elysia";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ElysiaAdapter } from "@bull-board/elysia";
import type { Queue } from "bullmq";
import { requireRole } from "@baseworks/module-auth";
import { env } from "@baseworks/config";

export async function createBullBoardPlugin(queues: Queue[]) {
  // D-04 — frame-ancestors: ADMIN_URL is the only allowed embedder.
  const frameAncestors = env.ADMIN_URL ? `'${env.ADMIN_URL}'` : "'none'";

  // Construct the Elysia adapter. Bun-eval workaround per oven-sh/bun#5809.
  const serverAdapter = new ElysiaAdapter({
    // basePath = the URL path the adapter believes it lives under
    // prefix   = the Elysia route group prefix (must match basePath in our case)
    basePath: "/admin/bull-board",
    prefix: "/admin/bull-board",
  });

  // D-02 — readOnlyMode is per-queue. Apply env-driven flag to every adapter.
  const readOnly = env.BULL_BOARD_READ_ONLY === "true";

  createBullBoard({
    queues: queues.map((q) => new BullMQAdapter(q, { readOnlyMode: readOnly })),
    serverAdapter,
    options: {
      // CRITICAL: Bun-compat workaround for oven-sh/bun#5809 (eval inside @bull-board/ui).
      // Without this, the build fails. Path is relative to process.cwd() at runtime.
      uiBasePath: "node_modules/@bull-board/ui",
      uiConfig: {
        boardTitle: "Baseworks Job Monitor",
        // Hides the "Redis Details" button — operators don't need raw Redis info from the iframe.
        hideRedisDetails: true,
      },
    },
  });

  // requireRole composition: every request inside this plugin (HTML/CSS/JS/static)
  // passes through the role derive. Returns 401 unauth, 403 wrong role.
  return new Elysia({ name: "bull-board-mount" })
    .use(requireRole("owner"))
    .use(await serverAdapter.registerPlugin())
    // D-04 — apply CSP frame-ancestors to every response in this plugin scope.
    .onAfterHandle(({ set }) => {
      set.headers["content-security-policy"] = `frame-ancestors ${frameAncestors}`;
    });
}
```

Then mount in `apps/api/src/index.ts` AFTER `/health` and BEFORE `tenantMiddleware`:
```typescript
// Collect all module queues for bull-board.
const moduleQueues: Queue[] = collectModuleQueues(registry); // helper iterates def.jobs and constructs Queue refs
const bullBoardPlugin = await createBullBoardPlugin(moduleQueues);
app.use(bullBoardPlugin);
```

### Pattern 2: Vite same-origin reverse proxy

**What:** Forward `/admin/bull-board/*` requests from the Vite dev server to the API (`localhost:3000`) so the better-auth cookie travels seamlessly.

**When to use:** Dev mode only. In production, nginx/Caddy/Traefik plays the same role.

**Example:**
```typescript
// apps/admin/vite.config.ts
// Source: vite.dev/config/server-options#server-proxy (verified 2026-04-27)
// Source: mattslifebytes.com/2025/03/30/unbreaking-cookies-in-local-dev-with-vite-proxy/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      // NEW — same-origin proxy for bull-board so the iframe inherits the
      // admin-origin session cookie. changeOrigin rewrites the Host header
      // so better-auth's cookie domain check passes.
      "/admin/bull-board": {
        target: "http://localhost:3000",
        changeOrigin: true,
        // ws: true is unnecessary — bull-board uses HTTP polling, not WebSockets,
        // for queue refresh (verified by examining @bull-board/api/dist routes:
        // every endpoint is GET/POST HTTP, no /socket.io upgrade path).
        // If a future bull-board version adds WS, set ws: true.
      },
      // OPTIONAL — same-origin proxy for /health/detailed so the admin SPA
      // can hit it via fetch without CORS. Eden Treaty already covers /api/*;
      // this entry covers the operator-only /health/detailed endpoint that
      // lives at the API root (not under /api/).
      "/health/detailed": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
```

**Production reverse proxy (documentation only — Phase 23 territory):**
```nginx
# nginx
location /admin/bull-board/ {
  proxy_pass http://api:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
location /health/detailed {
  proxy_pass http://api:3000;
}
```

### Pattern 3: HealthAggregator with parallel contributors + per-contributor timeout

**What:** Run all health contributors in parallel; race each against a 2000ms timeout; aggregate worst-of-N status; cache for 5 seconds.

**When to use:** This is the single entry point for `/health/detailed`. Both built-in checks (queue/heartbeat/DB/errors) and module-supplied `def.health` flow through it.

**Example:**
```typescript
// packages/observability/src/health/aggregator.ts
// Pattern: Promise.allSettled + Promise.race per item
// Source: developer.mozilla.org/Promise.allSettled (standard JS; HIGH confidence)

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface HealthCheckResult {
  status: HealthStatus;
  details?: Record<string, unknown>;
}

export interface HealthContributor {
  name: string;
  check: () => Promise<HealthCheckResult>;
  timeoutMs?: number; // default 2000
}

export interface AggregatedHealth {
  status: HealthStatus;
  contributors: Array<{ name: string; result: HealthCheckResult }>;
  timestamp: string;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 2000;
const CACHE_TTL_MS = 5000;

export class HealthAggregator {
  private contributors: HealthContributor[] = [];
  private cached: { value: AggregatedHealth; expiresAt: number } | null = null;

  register(contributor: HealthContributor): void {
    this.contributors.push(contributor);
  }

  async aggregate(): Promise<AggregatedHealth> {
    if (this.cached && Date.now() < this.cached.expiresAt) {
      return this.cached.value;
    }

    const start = Date.now();

    // D-11 — parallel via allSettled; per-item timeout via race.
    const settled = await Promise.allSettled(
      this.contributors.map((c) => this.runWithTimeout(c)),
    );

    const results = settled.map((s, i) => ({
      name: this.contributors[i].name,
      result:
        s.status === "fulfilled"
          ? s.value
          : ({
              status: "unhealthy" as HealthStatus,
              details: { error: String(s.reason) },
            } satisfies HealthCheckResult),
    }));

    // Worst-of-N rollup (D-10).
    const overall: HealthStatus = results.some((r) => r.result.status === "unhealthy")
      ? "unhealthy"
      : results.some((r) => r.result.status === "degraded")
        ? "degraded"
        : "healthy";

    const value: AggregatedHealth = {
      status: overall,
      contributors: results,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - start,
    };

    this.cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }

  private async runWithTimeout(c: HealthContributor): Promise<HealthCheckResult> {
    const timeoutMs = c.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return Promise.race<HealthCheckResult>([
      c.check(),
      new Promise<HealthCheckResult>((resolve) =>
        setTimeout(
          () => resolve({ status: "unhealthy", details: { error: "timeout" } }),
          timeoutMs,
        ),
      ),
    ]);
  }
}
```

**Critical decision (resolves Open Question 7 from upstream context):** The timeout race **resolves with an `unhealthy` HealthCheckResult**, NOT throws. Reason: `Promise.allSettled` already absorbs throws into rejections, but if the underlying contributor throws AFTER the race resolves, the unhandled rejection escapes. Resolving cleanly avoids that race condition entirely. The `details.error` field carries the timeout signal for observability.

### Pattern 4: Recent-errors ringbuffer decorator

**What:** Decorator that wraps the existing `ErrorTracker` port (Sentry/GlitchTip/Pino/Noop), retains a rolling window of recent error reports, and exposes them to the aggregator.

**When to use:** D-15 — feeds `/health/detailed.recentErrors` without depending on Sentry's API.

**Example:**
```typescript
// packages/observability/src/lib/ring-buffer-error-tracker.ts
import type { ErrorTracker, CaptureScope } from "../ports/error-tracker";

export interface RingBufferEntry {
  timestamp: string;       // ISO 8601
  message: string;          // truncated to 500 chars
  source: "cqrs" | "http" | "worker" | "global";
  count: number;            // dedup count within window
  firstFrame: string;       // first non-internal stack frame for dedup key
}

export class RingBufferingErrorTracker implements ErrorTracker {
  private buffer: RingBufferEntry[] = [];
  private dedupIndex = new Map<string, number>(); // key → buffer index

  constructor(
    private inner: ErrorTracker,
    private capacity: number = 50,
  ) {}

  // Delegate every port method to the inner tracker, then update buffer.
  captureException(err: unknown, scope?: CaptureScope): void {
    this.inner.captureException(err, scope);
    this.append(err, scope);
  }
  captureMessage(message: string, level?: any, scope?: CaptureScope): void {
    this.inner.captureMessage(message, level, scope);
    this.append(new Error(message), scope);
  }
  addBreadcrumb(...args: Parameters<ErrorTracker["addBreadcrumb"]>): void {
    this.inner.addBreadcrumb(...args);
  }
  withScope<T>(...args: Parameters<ErrorTracker["withScope"]>): T {
    return this.inner.withScope(...args) as T;
  }
  flush(timeoutMs?: number): Promise<boolean> {
    return this.inner.flush(timeoutMs);
  }

  /** Read-only snapshot for the health aggregator. */
  snapshot(): RingBufferEntry[] {
    return [...this.buffer];
  }

  private append(err: unknown, scope?: CaptureScope): void {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    const stack = err instanceof Error && err.stack ? err.stack : "";
    // First non-internal frame — strips "    at " prefix and node_modules paths.
    const firstFrame = (stack.split("\n").slice(1).find(
      (l) => !l.includes("node_modules"),
    ) ?? "").trim().slice(0, 200);
    const dedupKey = `${message} ${firstFrame}`;
    const source: RingBufferEntry["source"] =
      (scope?.tags?.source as RingBufferEntry["source"]) ?? "global";

    const existingIdx = this.dedupIndex.get(dedupKey);
    if (existingIdx !== undefined && this.buffer[existingIdx]) {
      this.buffer[existingIdx].count++;
      this.buffer[existingIdx].timestamp = new Date().toISOString();
      return;
    }

    if (this.buffer.length >= this.capacity) {
      const evicted = this.buffer.shift()!;
      const evictedKey = `${evicted.message} ${evicted.firstFrame}`;
      this.dedupIndex.delete(evictedKey);
      // Reindex remaining entries (their indices shifted by -1).
      for (const [k, idx] of this.dedupIndex) this.dedupIndex.set(k, idx - 1);
    }

    const entry: RingBufferEntry = {
      timestamp: new Date().toISOString(),
      message,
      firstFrame,
      source,
      count: 1,
    };
    this.buffer.push(entry);
    this.dedupIndex.set(dedupKey, this.buffer.length - 1);
  }
}
```

**Wire-up in `apps/api/src/index.ts` and `worker.ts`:** Replace
```typescript
installGlobalErrorHandlers(getErrorTracker());
wrapCqrsBus(registry.getCqrs(), getErrorTracker());
```
with
```typescript
const ringBuffer = new RingBufferingErrorTracker(getErrorTracker(), 50);
installGlobalErrorHandlers(ringBuffer);
wrapCqrsBus(registry.getCqrs(), ringBuffer);
// Expose to aggregator:
const aggregator = registry.getHealthAggregator();
aggregator.register({
  name: "recentErrors",
  check: async () => ({
    status: "healthy",                       // ringbuffer presence isn't a failure signal
    details: { entries: ringBuffer.snapshot() },
  }),
});
```

**Concurrency note:** Bun's event loop is single-threaded for JavaScript execution. `append()` runs to completion atomically between awaits — no lock needed. This holds even under high concurrent CQRS error reports.

### Pattern 5: Worker heartbeat publisher (setInterval + Redis SET EX)

**What:** Single timer per worker process that writes `worker:heartbeat:{instanceId}` JSON value with TTL `2 × interval`. Started after `loadAll()`, cleared in `shutdown()`.

**When to use:** D-12, D-13, D-14 — ONLY in `apps/api/src/worker.ts` (not in API process).

**Example:**
```typescript
// packages/observability/src/health/heartbeat.ts
import os from "node:os";
import type IORedis from "ioredis";
import { logger } from "../lib/logger"; // or pass logger in via params

export interface HeartbeatPayload {
  instanceId: string;
  queues: string[];
  lastHeartbeat: string;  // ISO 8601
  version?: string;
}

export interface HeartbeatPublisherOptions {
  redis: IORedis;
  instanceId: string;
  getQueues: () => string[];     // lazy — workers may register late
  intervalMs: number;
  version?: string;
}

export interface HeartbeatPublisherHandle {
  stop: () => Promise<void>;
}

export function resolveInstanceId(): string {
  // D-12 resolution order.
  return process.env.INSTANCE_ID ?? process.env.HOSTNAME ?? os.hostname();
}

export function startHeartbeatPublisher(
  opts: HeartbeatPublisherOptions,
): HeartbeatPublisherHandle {
  const key = `worker:heartbeat:${opts.instanceId}`;
  const ttlSec = Math.ceil((opts.intervalMs * 2) / 1000);

  const publish = async () => {
    const payload: HeartbeatPayload = {
      instanceId: opts.instanceId,
      queues: opts.getQueues(),
      lastHeartbeat: new Date().toISOString(),
      version: opts.version,
    };
    try {
      await opts.redis.set(key, JSON.stringify(payload), "EX", ttlSec);
    } catch (err) {
      // D-14 — Redis hiccup logs warn, does NOT crash the worker.
      logger.warn({ err: String(err), key }, "worker heartbeat publish failed");
    }
  };

  // Publish once immediately so the dashboard sees the worker without waiting
  // for the first interval tick.
  void publish();

  const timer = setInterval(publish, opts.intervalMs);

  // Bun 1.2.11+ — process.unref(timer) so the heartbeat does NOT keep the
  // process alive past worker.close(). Without this, in pre-1.2.11 Bun, the
  // process exits only when the explicit clearInterval runs in shutdown().
  // Either path is fine; unref is just cleaner.
  if (typeof (process as any).unref === "function") {
    try {
      (process as any).unref(timer);
    } catch {
      // Older Bun — tolerable; the explicit clearInterval below handles cleanup.
    }
  }

  return {
    stop: async () => {
      clearInterval(timer);
      // D-14 — DEL the key on graceful shutdown so the dashboard transitions
      // the worker from healthy → absent immediately, rather than waiting
      // for TTL expiry.
      try {
        await opts.redis.del(key);
      } catch (err) {
        logger.warn({ err: String(err), key }, "worker heartbeat DEL failed during shutdown");
      }
    },
  };
}

/** Read all live heartbeats. Used by the worker-heartbeat health contributor. */
export async function readHeartbeats(redis: IORedis): Promise<HeartbeatPayload[]> {
  // D-12 — SCAN, not KEYS.
  const out: HeartbeatPayload[] = [];
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(
      cursor,
      "MATCH",
      "worker:heartbeat:*",
      "COUNT",
      100,
    );
    cursor = next;
    if (keys.length) {
      const values = await redis.mget(...keys);
      for (const v of values) {
        if (!v) continue;
        try {
          out.push(JSON.parse(v) as HeartbeatPayload);
        } catch {
          // Malformed entry — ignore.
        }
      }
    }
  } while (cursor !== "0");
  return out;
}
```

**Wire-up in `apps/api/src/worker.ts`** (after `await registry.loadAll()`, before processing the worker loop):
```typescript
import {
  startHeartbeatPublisher,
  resolveInstanceId,
} from "@baseworks/observability";
import { getRedisConnection } from "@baseworks/queue";

// ... existing worker bootstrap up through `const workers: Worker[] = []` ...
// ... then the `for (const [name, def] of registry.getLoaded())` loop populates `workers` ...

const heartbeat = startHeartbeatPublisher({
  redis: getRedisConnection(redisUrl),
  instanceId: resolveInstanceId(),
  getQueues: () => workers.map((w) => w.name),
  intervalMs: env.WORKER_HEARTBEAT_INTERVAL_MS,
});

// In the existing shutdown() function (line 154):
async function shutdown() {
  logger.info("Worker shutting down...");
  await heartbeat.stop();              // NEW — clear timer + DEL key
  healthServer.stop();
  await Promise.all(workers.map((w) => w.close()));
  await closeConnection();
  process.exit(0);
}
```

### Pattern 6: DB lag probe (drizzle SELECT 1)

**What:** Round-trip latency from a `SELECT 1` against the existing `db` instance.

**When to use:** D-07's `db.lagMs` field.

**Example:**
```typescript
// packages/observability/src/health/contributors/db-lag.ts
import { sql } from "drizzle-orm";
import type { HealthContributor, HealthCheckResult } from "../aggregator";

export function dbLagContributor(db: { execute: (q: any) => Promise<unknown> }): HealthContributor {
  return {
    name: "db",
    timeoutMs: 1000,  // tighter than the 2000 default — DB unresponsive at 1s is degraded.
    check: async (): Promise<HealthCheckResult> => {
      const start = performance.now();
      try {
        await db.execute(sql`SELECT 1`);
        const lagMs = Math.round(performance.now() - start);
        return {
          status: lagMs < 500 ? "healthy" : "degraded",
          details: { connected: true, lagMs },
        };
      } catch (err) {
        return {
          status: "unhealthy",
          details: { connected: false, error: String(err) },
        };
      }
    },
  };
}
```

**Note:** This reuses the existing `db = createDb(env.DATABASE_URL)` instance from `apps/api/src/index.ts:41` (or `apps/api/src/routes/admin.ts:21`). NO new connection pool. The existing `apps/api/src/index.ts:106` already proves this pattern works.

**Connection-pool concern:** The probe takes ONE connection from postgres.js's pool for ~5–50ms. Under heavy load this is one fewer connection for app traffic. Mitigations:
1. The aggregator caches results for 5s (D-11) — at most 12 probes/min per process.
2. postgres.js default pool size is 10 — reserving 1 for ~50ms every 5s is negligible.
3. If a future Phase wants stricter isolation, route the probe through a dedicated single-connection pool — but defer for v1.3.

### Pattern 7: Iframe wrapper inside React Router 7 layout

**What:** Plain `<iframe>` element rendered inside `AdminLayout`'s `<Outlet />`. No special React Router pattern required — the iframe is just a DOM element in the route's component.

**When to use:** D-06 — the `/jobs` route in admin SPA.

**Example:**
```typescript
// apps/admin/src/routes/jobs/index.tsx
import { useTranslation } from "react-i18next";

export function Component() {
  const { t } = useTranslation("admin");
  return (
    <div className="h-[calc(100vh-3.5rem)] w-full -mx-6 -my-6">
      {/* Negative margins offset AdminLayout's p-6 so iframe fills the
          main content area edge-to-edge. The 3.5rem subtraction matches
          the existing header height (h-14 = 3.5rem in admin-layout.tsx:157). */}
      <iframe
        src="/admin/bull-board"
        title={t("nav.jobs")}
        className="w-full h-full border-0"
        // Sandbox provides a defense-in-depth layer above CSP frame-ancestors
        // (operator-side mitigation if our own SPA were compromised). Allow
        // same-origin since the iframe IS our own origin.
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        // Loading skeleton via a parent suspense boundary is overkill — bull-board
        // shows its own loading state. Use the iframe's onLoad/onError if a
        // skeleton is desired (Claude's Discretion).
      />
    </div>
  );
}
```

Add to `apps/admin/src/lib/router.ts`:
```typescript
{ path: "jobs", lazy: () => import("../routes/jobs") },
```

Add to `apps/admin/src/layouts/admin-layout.tsx:36-41`:
```typescript
const navItems = [
  { titleKey: "nav.tenants", icon: Building2, href: "/tenants" },
  { titleKey: "nav.users", icon: Users, href: "/users" },
  { titleKey: "nav.billing", icon: CreditCard, href: "/billing" },
  { titleKey: "nav.system", icon: Activity, href: "/system" },
  { titleKey: "nav.jobs", icon: ListTodo, href: "/jobs" },  // NEW
];
```
And add `ListTodo` to the lucide import on line 31.

### Pattern 8: `/health/detailed` Elysia plugin (response shape from D-07)

**What:** Single Elysia plugin file that wraps `requireRole("owner")` around a handler that calls `aggregator.aggregate()` and shapes the D-07 response envelope.

**Example:**
```typescript
// apps/api/src/routes/health-detailed.ts
import { Elysia } from "elysia";
import { requireRole } from "@baseworks/module-auth";
import { sql } from "drizzle-orm";
import type { HealthAggregator } from "@baseworks/observability";
import type { Queue } from "bullmq";
import type IORedis from "ioredis";
import { readHeartbeats } from "@baseworks/observability";
import { env } from "@baseworks/config";

export interface HealthDetailedDeps {
  aggregator: HealthAggregator;
  moduleQueues: Queue[];                       // for queue depth probe
  redis: IORedis;                              // for worker heartbeats
  loadedModuleNames: () => string[];
  contributorsByModule: () => Map<string, "healthy" | "degraded" | "unhealthy" | "unknown">;
  recentErrorsSnapshot: () => Array<{
    timestamp: string; message: string; source: string; count: number;
  }>;
}

export function createHealthDetailedPlugin(deps: HealthDetailedDeps) {
  return new Elysia({ name: "health-detailed" })
    .use(requireRole("owner"))
    .get("/health/detailed", async () => {
      const agg = await deps.aggregator.aggregate();

      // Compose the D-07 response envelope.
      // Queue depths
      const queueResults = await Promise.all(
        deps.moduleQueues.map(async (q) => {
          const counts = await q.getJobCounts(
            "waiting", "active", "delayed", "completed", "failed",
          );
          const status =
            (counts.waiting ?? 0) > 1000 ? "critical"
              : (counts.waiting ?? 0) > 100 ? "warning"
                : "healthy";
          return {
            name: q.name,
            ...counts,
            status,
            thresholds: { warn: 100, critical: 1000 },  // D-09
          };
        }),
      );

      // Worker heartbeats
      const heartbeats = await readHeartbeats(deps.redis);
      const now = Date.now();
      const intervalMs = env.WORKER_HEARTBEAT_INTERVAL_MS;
      const workers = heartbeats.map((hb) => {
        const ageMs = now - new Date(hb.lastHeartbeat).getTime();
        const ageSec = Math.round(ageMs / 1000);
        // D-13 thresholds
        const status: "healthy" | "stale" | "dead" =
          ageMs < 2 * intervalMs ? "healthy"
            : ageMs < 5 * intervalMs ? "stale"
              : "dead";
        return {
          instanceId: hb.instanceId,
          queues: hb.queues,
          lastHeartbeat: hb.lastHeartbeat,
          ageSec,
          status,
        };
      });

      // DB status — read from contributor results.
      const dbContrib = agg.contributors.find((c) => c.name === "db");
      const db = dbContrib?.result.details ?? {};

      // Modules — D-16 default to healthy if loaded.
      const contribStatuses = deps.contributorsByModule();
      const modules = deps.loadedModuleNames().map((name) => ({
        name,
        loaded: true,
        status: contribStatuses.get(name) ?? "healthy",  // D-16
      }));

      return {
        data: {
          status: agg.status,
          timestamp: agg.timestamp,
          uptime: process.uptime(),
          queues: queueResults,
          workers,
          db: {
            connected: (db as any).connected ?? false,
            lagMs: (db as any).lagMs ?? null,
            status: dbContrib?.result.status ?? "unhealthy",
          },
          recentErrors: deps.recentErrorsSnapshot(),
          modules,
        },
      };
    });
}
```

Mount in `apps/api/src/index.ts` (after `/health` Docker probe, before `tenantMiddleware`):
```typescript
const healthDetailedPlugin = createHealthDetailedPlugin({
  aggregator: registry.getHealthAggregator(),
  moduleQueues,
  redis: getRedisConnection(env.REDIS_URL!),
  loadedModuleNames: () => registry.getLoadedNames(),
  contributorsByModule: () => /* compute from aggregator results */ new Map(),
  recentErrorsSnapshot: () => ringBuffer.snapshot().map((e) => ({
    timestamp: e.timestamp, message: e.message, source: e.source, count: e.count,
  })),
});
app.use(healthDetailedPlugin);
```

**Eden Treaty exposure (resolves Open Question 13):** Because the plugin is `.use()`'d into the main `app`, its types flow through to `export type App = typeof app` automatically. The admin SPA can call `api['health/detailed'].get()` via Eden Treaty IF the path is reachable (it is, via the new Vite proxy entry). NO codegen, NO duplicate type definitions.

### Anti-Patterns to Avoid

- **Mounting bull-board inside `/api/admin/*`** — forces every static asset through tenant middleware, which expects a tenant context bull-board cannot supply. D-01 explicitly rejects this.
- **Setting CSP `frame-ancestors '*'` or `'self'`** — `*` enables clickjacking; `'self'` is wrong because the admin SPA runs on a DIFFERENT origin from the API. D-04 mandates `'${ADMIN_URL}'`.
- **Using `KEYS worker:heartbeat:*`** — blocks Redis under load. D-12 mandates `SCAN`.
- **Wrapping the heartbeat publisher in `wrapQueue()` / `wrapProcessorWithAls()`** — the heartbeat is NOT a BullMQ queue, has no producer/consumer relationship, and would mint orphan trace span trees. Use raw `redis.set()` only (canonical_refs comment from CONTEXT.md).
- **Calling `getErrorTracker()` directly in admin UI for recent errors** — couples the admin SPA to ErrorTracker port. Use the ringbuffer + Elysia endpoint only.
- **`Promise.all` for contributors** — one slow check sinks the whole endpoint. Use `allSettled` (D-11).
- **Storing tenant_id in heartbeat or recentErrors** — D-15 errors are process-local (cross-tenant); heartbeats are operator-scope. Adding tenant labels would create cardinality explosions and leak cross-tenant data into the operator view.
- **Mutating the bull-board readOnlyMode at runtime** — `readOnlyMode` is captured at `createBullBoard()` time. Toggling the env requires a process restart. Document in `.env.example`.
- **Forgetting the `uiBasePath` Bun workaround** — the build silently fails on Bun without `uiBasePath: 'node_modules/@bull-board/ui'`. Always include.
- **Iframe `src="https://api.example.com/admin/bull-board"`** — cross-origin defeats the cookie-sharing premise. Always use the same-origin proxy path.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Queue inspection UI | Custom React tables querying BullMQ over an admin API | `@bull-board/elysia` + iframe | bull-board solves jobs/retries/queue navigation/log viewer; rebuilding takes weeks and is explicitly Out of Scope per PROJECT.md |
| Per-queue read-only enforcement | Route-level filtering in Elysia | `BullMQAdapter(q, { readOnlyMode: true })` | Adapter-level toggle is the documented mechanism (verified 2026-04-27 in README.md) |
| Worker liveness signal | A queue ping job that workers report on | Redis SET with TTL | The ping-job approach is circular: a stuck worker can't report it's stuck. TTL-based heartbeats are the standard pattern for systemd / k8s liveness. |
| Health check parallelism | Sequential `await` chain | `Promise.allSettled` + per-item `Promise.race` timeout | Sequential probes turn 5 × 200ms = 1s into a guaranteed 1s tail; parallel is ~200ms total. `allSettled` prevents one failure from sinking the rest. |
| Recent-errors aggregation | Sentry API query from admin UI | In-process ringbuffer decorator on ErrorTracker | Sentry API needs project-read tokens, network egress per page load, and breaks under `ERROR_TRACKER=noop`. Ringbuffer works for every adapter selection. |
| Iframe security | `X-Frame-Options: DENY` | CSP `frame-ancestors '${ADMIN_URL}'` | XFO is single-origin; CSP supports multiple origins, is the modern HTML5-spec replacement, and degrades gracefully via `'none'`. |
| Same-origin cookie sharing | Token-passing iframe with `postMessage` | Reverse proxy (Vite dev / nginx prod) | Token-passing reintroduces auth complexity the better-auth cookie already solves. |
| RBAC for static assets | Custom auth middleware on every static route | Wrap the entire bull-board plugin in `requireRole("owner")` | The Elysia plugin scope means the role check derives on every request including HTML/CSS/JS — proven by D-03's integration test recipe. |
| `instanceId` resolution | Hard-coded HOSTNAME env reads | `process.env.INSTANCE_ID ?? process.env.HOSTNAME ?? os.hostname()` | Resolves cleanly in k8s (HOSTNAME = pod name), Docker (`docker run -e INSTANCE_ID=...`), and bare-metal (os.hostname()). D-12. |
| Status enum vocabulary | New `"ok"/"warning"/"critical"` taxonomy | Reuse `"healthy"/"degraded"/"unhealthy"/"warning"/"critical"` from existing `apps/admin/src/routes/system/health.tsx` | Two enums = two UI badge mappings = bug surface. Existing UI already maps these. |

**Key insight:** Phase 22 is almost entirely composition: existing primitives (requireRole, ErrorTracker port, getRedisConnection, drizzle db) wired into a small set of new Elysia plugins. The only genuinely new code is `HealthAggregator`, `RingBufferingErrorTracker`, and `startHeartbeatPublisher` — none of which is more than ~150 lines. Custom solutions in this domain are larger AND less reliable than the standard pieces.

## Runtime State Inventory

> Phase 22 introduces NEW runtime state (heartbeat keys, ringbuffer entries, bull-board internal Redis usage). Below is the inventory of what comes into existence and how to reason about it across deployments.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | (1) Redis keys `worker:heartbeat:{instanceId}` written by every worker process; TTL `2 × WORKER_HEARTBEAT_INTERVAL_MS`. (2) bull-board reads existing `bull:*` keys (BullMQ data) — NO new persistent state. (3) RingBufferingErrorTracker buffer is in-memory only (D-15) — process restart wipes. | (1) No migration — fresh keys on first publish. Document key shape in deployment docs. (2) None. (3) None — by design. |
| Live service config | NONE — bull-board configuration (queues, readOnlyMode) is reconstructed at API startup from registered modules + env. No remote config dependency. | None. |
| OS-registered state | NONE — no Windows Task Scheduler / launchd / systemd unit changes. The heartbeat publisher runs inside the existing worker process. | None. |
| Secrets / env vars | TWO new vars: `BULL_BOARD_READ_ONLY` (string `"true"`/`"false"`, default `"true"`) and `WORKER_HEARTBEAT_INTERVAL_MS` (number, default `15000`). NO new DSNs / API tokens / secret material. | Append both to `.env.example` with inline comments documenting effect. |
| Build artifacts | (1) `node_modules/@bull-board/ui/` — bull-board's UI bundle is read at runtime via `uiBasePath`. After installing the new packages, the `dist` builds resolve at runtime correctly. (2) NEW `apps/api/src/routes/{bull-board,health-detailed}.ts` — picked up by Elysia mount in `index.ts`. | After `bun install`, no rebuild needed (Bun runs TS natively). For Docker images, ensure the `node_modules/@bull-board/ui` directory is present in the final image (multi-stage builds must not prune it as an "unused" dep). |

**Cross-replica concern:** When operating multiple API replicas, each replica has its OWN ringbuffer (D-15 acknowledged trade-off). Each worker replica has its OWN heartbeat key (instanceId-keyed → no collision). bull-board itself is process-global within an API replica — Redis is the source of truth for queue state, so replicas converge on the same view. Document explicitly: an operator hitting `/health/detailed` on replica A will see only replica A's recent errors.

## Common Pitfalls

### Pitfall 1: Bun eval issue in `@bull-board/ui` static asset bundling
**What goes wrong:** `bun build` or runtime fails with an eval error from the bundled UI assets.
**Why it happens:** `@bull-board/ui` uses dynamic `eval` paths that Bun's build pipeline doesn't handle by default. Tracked in oven-sh/bun#5809.
**How to avoid:** ALWAYS pass `options.uiBasePath: 'node_modules/@bull-board/ui'` to `createBullBoard()`. The path is relative to `process.cwd()` at runtime — confirm production Docker images preserve `node_modules/@bull-board/ui/`.
**Warning signs:** Stack traces mentioning `eval` and `@bull-board/ui` during admin iframe load. Build-time errors during `bun build`.
[CITED: github.com/felixmosh/bull-board/blob/master/examples/with-elysia/index.ts comment + linked issue oven-sh/bun#5809]

### Pitfall 2: Cookie domain mismatch in iframe (Vite proxy or nginx misconfig)
**What goes wrong:** Bull-board iframe loads but every request returns 401 — the better-auth session cookie isn't sent.
**Why it happens:** The session cookie's `Domain` attribute (or browser's SameSite enforcement) restricts the cookie to the admin origin. If the iframe URL is `http://localhost:3000/admin/bull-board` (the API origin) instead of `http://localhost:5173/admin/bull-board` (the admin origin via proxy), the cookie isn't sent for the iframe request.
**How to avoid:** ALWAYS use the same-origin proxy path (`/admin/bull-board` on the admin origin, NOT the raw API origin). Verify `vite.config.ts` includes `changeOrigin: true` so the upstream Host header matches the API's expected domain. In production, document the same nginx behavior.
**Warning signs:** Iframe shows the bull-board login or 401 even though the operator is logged into the admin SPA. Browser devtools Network tab shows iframe requests without a Cookie header.
[CITED: github.com/vitejs/vite/discussions/6455 + mattslifebytes.com/2025/03/30/unbreaking-cookies-in-local-dev-with-vite-proxy/]

### Pitfall 3: Heartbeat keys persist past worker death (TTL too long, no DEL)
**What goes wrong:** Operator sees a "healthy" worker in the dashboard for ~30s after that worker actually crashed.
**Why it happens:** TTL-only cleanup means the dashboard waits for `2 × interval` (30s default) before the key expires. SIGKILL'd workers can't DEL their key.
**How to avoid:** D-14 mandates `clearInterval` + `redis.del(key)` in graceful shutdown. SIGKILL'd workers WILL still leave the key for ≤ TTL — that's the irreducible window. If reducing it matters more than reducing Redis writes, lower `WORKER_HEARTBEAT_INTERVAL_MS` to 5000 (10s TTL).
**Warning signs:** Dashboard shows a worker as healthy that operators know was killed. SCAN returns more keys than running workers.

### Pitfall 4: Aggregator timeout escapes as unhandled rejection
**What goes wrong:** Server logs show `unhandledRejection` even though `/health/detailed` returns successfully.
**Why it happens:** A naive `Promise.race([check(), timeout])` resolves the race when timeout fires — but the underlying `check()` is still running. If it later throws, the throw becomes unhandled.
**How to avoid:** Pattern 3 above resolves the timeout with an `unhealthy` HealthCheckResult; the underlying promise's eventual settlement is then absorbed by `Promise.allSettled`. The combination of `allSettled` (catches rejections) + race-resolves-rather-than-throws (avoids escape) is the safe shape. NEVER use `setTimeout(reject, ...)` inside the race.
**Warning signs:** Pino logs `unhandledRejection` after every `/health/detailed` hit when one contributor is slow.

### Pitfall 5: bull-board adapter peer dep version drift
**What goes wrong:** After a future bull-board major bump, `@bull-board/elysia` peer requires a newer Elysia than the project ships.
**Why it happens:** bull-board ships frequent majors (v6 → v7 in ~weeks). Peer deps are not strictly enforced by Bun.
**How to avoid:** When upgrading `@bull-board/elysia`, check `npm view @bull-board/elysia peerDependencies` and confirm the project's Elysia version satisfies. CI should run a smoke-test that boots the API and hits `/admin/bull-board` once per release.
**Warning signs:** Runtime `TypeError: ... is not a function` errors during plugin registration after a dependency bump. `bun install` warns about peer dep mismatch.

### Pitfall 6: CSP `onAfterHandle` leaking outside the bull-board plugin
**What goes wrong:** Every API response gets `Content-Security-Policy: frame-ancestors '...'` — including JSON API responses where it makes no sense.
**Why it happens:** Elysia lifecycle hooks default to "scoped" within a plugin, but `.use()`-ing a plugin into a parent CAN leak hooks if scope is misconfigured.
**How to avoid:** Define the `.onAfterHandle()` hook INSIDE the `new Elysia({ name: "bull-board-mount" })` plugin (Pattern 1 above). Elysia's default scope is `"local"` per plugin name (verified in elysiajs.com/essential/plugin docs). The hook fires only for routes registered inside this plugin instance.
**Warning signs:** CSP header appears on `/api/admin/tenants` responses. Browser dev tools show `frame-ancestors` blocking unrelated UI from being framed.

### Pitfall 7: `process.unref()` not present on older Bun
**What goes wrong:** Heartbeat publisher's `process.unref(timer)` throws `process.unref is not a function` on Bun < 1.2.11.
**Why it happens:** `process.unref()` was added in Bun 1.2.11.
**How to avoid:** Pattern 5 wraps the `unref` call in `if (typeof (process as any).unref === "function")` and a try/catch. The publisher works without unref — `clearInterval` in shutdown still terminates the timer; the only loss is that the process won't exit on its own without `process.exit(0)`. The existing worker.ts already calls `process.exit(0)` at the end of `shutdown()`.
**Warning signs:** Worker process hangs for ≤ heartbeat interval after SIGTERM if shutdown() somehow doesn't fire.

### Pitfall 8: Elysia plugin scope swallowing requireRole errors
**What goes wrong:** Unauthenticated requests to `/admin/bull-board` get 500 instead of 401.
**Why it happens:** `requireRole` throws `new Error("Unauthorized")`. The default Elysia error mapper returns 500 unless errorMiddleware translates it.
**How to avoid:** The existing `errorMiddleware` (apps/api/src/core/middleware/error.ts) already maps "Unauthorized" → 401 and "Forbidden" → 403. Verify by reading `errorMiddleware`. The integration test recipe in D-03 catches this regression: hit `/admin/bull-board/static/main.css` unauthenticated → expect 401.
**Warning signs:** Smoke test asserts `expect(res.status).toBe(401)` but receives 500.

### Pitfall 9: Recent errors ringbuffer leaking PII
**What goes wrong:** Operator's `/health/detailed` UI shows error messages containing tenant emails / user names / sensitive payloads.
**Why it happens:** The ringbuffer captures `err.message`. A handler that throws `new Error(\`Customer ${email} not found\`)` will surface that in the buffer.
**How to avoid:** The decorator wraps the existing `ErrorTracker` which already runs `scrubPii` for Sentry/GlitchTip adapters (Phase 18). HOWEVER, the ringbuffer captures the RAW err, not the scrubbed event. Apply `scrubPii({ exception: { values: [{ value: err.message }] } })` to the message before storing OR truncate to `<error class>: <message snippet up to 200 chars>` and rely on Phase 18's scrubPii catching most known patterns. Recommendation: truncate at 500 chars (already in pattern) AND apply the scrubPii regex set to the message.
**Warning signs:** UI shows email addresses, CPFs, or webhook payload fragments in the recent-errors list.

### Pitfall 10: Multiple module queues not collected at bull-board init time
**What goes wrong:** Operator sees an empty bull-board ("no queues registered").
**Why it happens:** Each module declares `def.jobs` with a `queue` name; the actual `Queue` object is constructed inside `worker.ts` during the worker bootstrap loop. The API process never instantiates Queue objects unless we explicitly do so.
**How to avoid:** In the API process, build a helper that iterates `registry.getLoaded()` and constructs a `Queue` reference (read-only — no Worker) for each unique `def.jobs[*].queue` name using the existing `getRedisConnection(env.REDIS_URL!)`. Pass the array to `createBullBoardPlugin(queues)`. Naming convention: `module:action` (e.g., `email-send`).
**Warning signs:** bull-board UI loads but the queue list sidebar is empty even though jobs are running on workers.

## Code Examples

Verified patterns from official sources, ready for direct use in the plan.

### bull-board mount with Elysia + Bun
```typescript
// Source: github.com/felixmosh/bull-board/tree/master/examples/with-elysia (verified 2026-04-27 raw fetch)
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ElysiaAdapter } from "@bull-board/elysia";

const serverAdapter = new ElysiaAdapter({ prefix: "/ui", basePath: "/api/ui" });

createBullBoard({
  queues: [new BullMQAdapter(exampleBullMq)],
  serverAdapter,
  options: {
    // CRITICAL Bun workaround per oven-sh/bun#5809
    uiBasePath: "node_modules/@bull-board/ui",
  },
});

const app = new Elysia({ prefix: "/api", normalize: true, aot: true })
  .use(await serverAdapter.registerPlugin())
  // ... other routes
  .listen(3000);
```

### bull-board readOnlyMode (per-queue)
```typescript
// Source: github.com/felixmosh/bull-board/blob/master/README.md#queue-options (verified 2026-04-27)
createBullBoard({
  queues: [
    new BullAdapter(someQueue, { readOnlyMode: true }),
    new BullMQAdapter(queueMQ, { readOnlyMode: true }),
  ],
});
```

### Drizzle SELECT 1 round-trip (existing project pattern)
```typescript
// Source: apps/api/src/index.ts:106 (existing in repo, verified 2026-04-27)
const dbStart = performance.now();
try {
  await db.execute(sql`SELECT 1`);
  checks.database = { status: "up", latency_ms: Math.round(performance.now() - dbStart) };
} catch (err) {
  checks.database = { status: "down", error: "Failed to connect" };
}
```

### Redis SCAN for safe key enumeration
```typescript
// Source: redis.io/commands/scan + ioredis docs (verified 2026-04-27)
let cursor = "0";
const keys: string[] = [];
do {
  const [next, batch] = await redis.scan(cursor, "MATCH", "worker:heartbeat:*", "COUNT", 100);
  cursor = next;
  keys.push(...batch);
} while (cursor !== "0");
```

### Vite proxy with cookie forwarding
```typescript
// Source: vite.dev/config/server-options#server-proxy + project's existing apps/admin/vite.config.ts (verified 2026-04-27)
server: {
  proxy: {
    "/api": { target: "http://localhost:3000", changeOrigin: true },
    "/admin/bull-board": { target: "http://localhost:3000", changeOrigin: true },
  },
}
```

### React Query polling (existing project pattern)
```typescript
// Source: apps/admin/src/routes/system/health.tsx:64-76 (existing, verified 2026-04-27)
const { data, isLoading, error, refetch } = useQuery({
  queryKey: ["admin", "health", "detailed"],
  queryFn: async () => {
    const res = await fetch("/health/detailed", { credentials: "include" });
    if (!res.ok) throw new Error("Failed");
    return (await res.json()).data;
  },
  refetchInterval: 30000,
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `X-Frame-Options: DENY/SAMEORIGIN` | CSP `frame-ancestors '<origin>'` | HTML5 spec ratified, supported by all modern browsers | Multi-origin support, finer-grained policy, fits this phase's "embed only from ${ADMIN_URL}" requirement |
| `KEYS pattern` for Redis enumeration | `SCAN cursor MATCH pattern` | Redis 2.8+ (long-standing) | Production-safe; doesn't block Redis under load |
| `bull-board` v5 (older Elysia adapter shape) | `@bull-board/elysia v7.0.0` (Bun-tested example, async `registerPlugin()`) | bull-board v7.0.0 published 2026-04-20 | Async plugin registration API; verified Bun-compat in official example |
| `@sentry/node` error tracking | `@sentry/bun` (Phase 18 already chose) | Bun-only constraint per CLAUDE.md | Source-map upload, Bun-native instrumentation |
| `setInterval` keeping process alive | `setInterval` + `process.unref(timer)` | Bun 1.2.11 (released early 2026) | Lets workers shut down cleanly without explicit `clearInterval` discipline |
| Sentry-API-driven recent errors UI | In-process ringbuffer | Industry pattern for ops dashboards (k8s, nomad, BullMQ-board itself) | No external dependency, no token rotation, works in offline/air-gapped deployments |

**Deprecated/outdated:**
- `X-Frame-Options` for clickjacking protection (CSP `frame-ancestors` supersedes — both work side-by-side, but new code should use CSP only).
- `bull-board` (the unscoped legacy package, published 2.x) — replaced by the `@bull-board/*` family. Project must use `@bull-board/api` + `@bull-board/elysia`.
- Polling Sentry's REST API for recent error display in admin dashboards — token rotation burden + cross-tenant scope confusion.

## Project Constraints (from CLAUDE.md)

The following directives from `CLAUDE.md` MUST be honored by Phase 22 plans. Research has selected libraries and patterns that comply:

| Constraint | How Phase 22 Complies |
|------------|----------------------|
| Runtime = Bun (all packages must be Bun-compatible) | `@bull-board/elysia` ships an official Bun example (`bun --watch`, `bun build --target bun`). Heartbeat publisher uses `process.unref` (Bun 1.2.11+). All other deps already in project. |
| ORM = Drizzle (no Prisma) | DB lag probe uses `db.execute(sql\`SELECT 1\`)` against existing Drizzle instance. |
| Auth = better-auth | `requireRole("owner")` is the existing better-auth-backed plugin. Iframe inherits the better-auth session cookie via same-origin proxy. |
| Database = PostgreSQL with tenant isolation via tenant_id | `/health/detailed` is operator-scope; uses raw `db` (NOT scopedDb) per Phase 20.1 D-07. |
| Queue = BullMQ + Redis | bull-board's `BullMQAdapter` wraps existing BullMQ Queue instances. Heartbeat uses raw Redis SET (no BullMQ). |
| API client = Eden Treaty | `/health/detailed` types flow into `App` type via Elysia's `.use()` chain — Eden Treaty discovers them automatically. |
| Styling = Tailwind 4 + shadcn/ui | `/jobs` and `/health/detailed` UI reuses existing `@baseworks/ui` components (Card, Badge, Skeleton). |
| GSD workflow enforcement | Phase 22 follows `/gsd:plan-phase` flow; this RESEARCH.md is an artifact of that flow. |

## Validation Architecture

> Phase 22 has 5 success criteria from milestone roadmap and 5 phase requirements. Below maps each to a falsifiable check.

### Test Framework
| Property | Value |
|----------|-------|
| Backend framework | `bun test` (existing — used in `apps/api/__tests__/`) |
| Frontend framework | Vitest (existing — used in `packages/ui` per `bun test` carve-out from STATE.md 260420-a4t) |
| Config files | `apps/api/tsconfig.json` (existing); admin SPA component tests via existing vitest setup |
| Quick run command | `bun test apps/api/src/__tests__/admin-ops.test.ts` (per-file) |
| Full suite command | `bun test` from repo root (covers all `apps/api/__tests__`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OPS-01 | bull-board mounted at `/admin/bull-board` behind requireRole, read-only by env | integration | `bun test apps/api/src/__tests__/bull-board-mount.test.ts` | ❌ Wave 0 |
| OPS-01 | Static asset (CSS/JS) request returns 401 unauth | integration | `curl -i -o /dev/null -w "%{http_code}" http://localhost:3000/admin/bull-board/static/main.css` (expect 401) | ❌ Wave 0 |
| OPS-01 | CSP `frame-ancestors '${ADMIN_URL}'` set on every bull-board response | integration | `curl -i http://localhost:3000/admin/bull-board \| grep -i "content-security-policy"` (expect `frame-ancestors '${ADMIN_URL}'`) | ❌ Wave 0 |
| OPS-01 | `BULL_BOARD_READ_ONLY=true` (default) hides retry/promote action buttons | integration | bun test asserts `BullMQAdapter` constructed with `{ readOnlyMode: true }` when env is "true" | ❌ Wave 0 |
| OPS-01 | Boot crashes when `BULL_BOARD_READ_ONLY` is invalid value (typo) | unit | `bun test packages/config/src/__tests__/env-bull-board.test.ts` — set to `"yes"` and assert env validation throws | ❌ Wave 0 |
| OPS-02 | Admin sidebar contains "Job Monitor" entry | component | Vitest test in `apps/admin/src/__tests__/sidebar.test.tsx` asserts `nav.jobs` href `/jobs` rendered | ❌ Wave 0 |
| OPS-02 | `/jobs` route renders an iframe with `src="/admin/bull-board"` | component | Vitest test in `apps/admin/src/routes/jobs/__tests__/index.test.tsx` asserts `<iframe>` element with correct `src` | ❌ Wave 0 |
| OPS-02 | Vite dev server proxies `/admin/bull-board` to API | manual smoke | Documented manual: `bun run dev:admin` + `curl -i http://localhost:5173/admin/bull-board` returns 401 (proves proxy reaches API requireRole) | ❌ Wave 0 |
| OPS-03 | `GET /health/detailed` requires `requireRole("owner")` | integration | bun test: unauth request → 401; member role → 403; owner role → 200 with envelope | ❌ Wave 0 |
| OPS-03 | Response shape matches D-07 envelope (queues, workers, db, recentErrors, modules) | integration | bun test asserts `Object.keys(res.data)` is superset of D-07 fields | ❌ Wave 0 |
| OPS-03 | Queue depth thresholds applied (warn=100, critical=1000) | unit | `bun test packages/observability/src/health/__tests__/queue-depth.test.ts` with mock counts at 99/100/101/999/1000/1001 | ❌ Wave 0 |
| OPS-03 | Worker heartbeat freshness derived per D-13 | unit | `bun test packages/observability/src/health/__tests__/heartbeat-status.test.ts` — fixed clock + heartbeats at age 0/1.5×interval/2×interval/4×interval/5×interval+1 | ❌ Wave 0 |
| OPS-03 | DB lag probe records round-trip ms | unit | `bun test packages/observability/src/health/__tests__/db-lag.test.ts` with mocked db (resolves after 50ms artificial delay) | ❌ Wave 0 |
| OPS-03 | Recent errors ringbuffer dedup keys merge same-message errors | unit | `bun test packages/observability/src/lib/__tests__/ring-buffer-error-tracker.test.ts` — capture same Error twice → 1 entry, count=2 | ❌ Wave 0 |
| OPS-03 | Aggregator caches result for 5 seconds | unit | `bun test packages/observability/src/health/__tests__/aggregator-cache.test.ts` — second call within 5s returns cached value (mock contributors record call count) | ❌ Wave 0 |
| OPS-03 | Aggregator times out slow contributor at 2000ms (default) | unit | `bun test` — slow contributor (3000ms sleep) → result `unhealthy` with `details.error: "timeout"`; total aggregate < 2500ms | ❌ Wave 0 |
| OPS-04 | `ModuleDefinition.health?: HealthContributor` slot exists in shared types | type | `bun tsc --noEmit` passes when a module declares `health: { name, check, timeoutMs? }` in its `default export` | ❌ Wave 0 |
| OPS-04 | `registry.loadAll()` collects `def.health` into the aggregator | unit | `bun test apps/api/src/__tests__/registry-health.test.ts` — load a module with `def.health`, assert `registry.getHealthAggregator().contributors` includes it | ❌ Wave 0 |
| OPS-04 | Modules without `def.health` default to `loaded ? "healthy" : "unhealthy"` (D-16) | integration | bun test: load auth module (no health), assert `/health/detailed` modules array includes `{ name: "auth", loaded: true, status: "healthy" }` | ❌ Wave 0 |
| EXT-02 | Worker publishes heartbeat key on interval | unit | `bun test packages/observability/src/health/__tests__/heartbeat-publisher.test.ts` — mock IORedis, fake-clock advances `intervalMs`, assert `redis.set` called with correct key + TTL | ❌ Wave 0 |
| EXT-02 | Heartbeat key TTL = `2 × intervalMs` | unit | Same test asserts `redis.set` third arg is `"EX"` and fourth arg = `2 × intervalMs / 1000` | ❌ Wave 0 |
| EXT-02 | Heartbeat publisher resilient to Redis errors | unit | Mock `redis.set` to reject; assert no exception escapes (logger.warn called instead) | ❌ Wave 0 |
| EXT-02 | Graceful shutdown clears interval + DELs key | unit | Test calls `handle.stop()`; asserts `clearInterval` called + `redis.del(key)` called | ❌ Wave 0 |
| EXT-02 | `instanceId` resolution order INSTANCE_ID → HOSTNAME → os.hostname() | unit | `bun test packages/observability/src/health/__tests__/resolve-instance-id.test.ts` with each env var set/unset | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `bun test apps/api/src/__tests__/admin-ops.test.ts packages/observability/src/health/__tests__/` (≤ 30 seconds local)
- **Per wave merge:** `bun test` from repo root (full backend suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`. Plus 3 manual smoke checks (run by gsd-executor as `checkpoint:human-action` items):
  1. `curl -i http://localhost:5173/admin/bull-board` — expect 401 with `WWW-Authenticate` or session redirect AND `content-security-policy: frame-ancestors '<ADMIN_URL>'`
  2. Open admin dashboard at `http://localhost:5173`, log in as owner, click Job Monitor sidebar entry — expect bull-board UI rendered inside iframe.
  3. Kill a worker (`kill -9 <pid>`), wait 90s, refresh `/health/detailed` page — expect that worker's `instanceId` shown as `dead`.

### Wave 0 Gaps
- [ ] `apps/api/src/__tests__/bull-board-mount.test.ts` — covers OPS-01
- [ ] `apps/api/src/__tests__/health-detailed.test.ts` — covers OPS-03 envelope + RBAC
- [ ] `apps/api/src/__tests__/registry-health.test.ts` — covers OPS-04 registration
- [ ] `apps/admin/src/__tests__/sidebar.test.tsx` — covers OPS-02 sidebar
- [ ] `apps/admin/src/routes/jobs/__tests__/index.test.tsx` — covers OPS-02 iframe
- [ ] `packages/observability/src/health/__tests__/aggregator.test.ts` — HealthAggregator core
- [ ] `packages/observability/src/health/__tests__/queue-depth.test.ts` — threshold contributor
- [ ] `packages/observability/src/health/__tests__/heartbeat-publisher.test.ts` — EXT-02 publisher
- [ ] `packages/observability/src/health/__tests__/heartbeat-status.test.ts` — EXT-02 reader
- [ ] `packages/observability/src/health/__tests__/db-lag.test.ts` — DB probe
- [ ] `packages/observability/src/health/__tests__/resolve-instance-id.test.ts` — instanceId fallback chain
- [ ] `packages/observability/src/lib/__tests__/ring-buffer-error-tracker.test.ts` — dedup + capacity
- [ ] `packages/config/src/__tests__/env-bull-board.test.ts` — env validation crash-hard
- [ ] No new test framework install needed — `bun test` already canonical for backend, vitest already canonical for frontend.

### Phase Success Criteria → Test Map (from v1.3-ROADMAP.md "Phase 22")

| SC# | Roadmap Criterion | Falsifiable Check |
|-----|-------------------|---------------------|
| SC#1 | bull-board mounted, RBAC + read-only + CSP, static assets gated | `OPS-01` test bundle above (5 distinct tests) |
| SC#2 | Admin sees "Job Monitor" sidebar + same-origin iframe + cookie sharing | `OPS-02` test bundle (sidebar component test + iframe component test + manual smoke #2) |
| SC#3 | `/health/detailed` returns queue depth + heartbeat + DB lag + recent errors + module status | `OPS-03` test bundle (envelope + each contributor + RBAC enforcement) |
| SC#4 | Module author registers HealthContributor; aggregator rolls up | `OPS-04` test bundle (type compile + registry collection + D-16 default behavior) |
| SC#5 | Workers publish heartbeat keys to Redis on configurable interval | `EXT-02` test bundle (4 tests: publish, TTL, resilience, shutdown DEL) |

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Reuses better-auth session via `requireRole("owner")`. No new auth surface. |
| V3 Session Management | yes | Same-origin proxy preserves better-auth session cookie; SameSite + HttpOnly enforced by existing better-auth config. NO token-passing. |
| V4 Access Control | yes | `requireRole("owner")` on every new endpoint AND on bull-board static assets. RBAC applied at framework layer (Elysia plugin scope), not per-handler. |
| V5 Input Validation | yes | New env vars validated by `@t3-oss/env-core` Zod schema (crash-hard on invalid). `/health/detailed` has no input parameters. |
| V6 Cryptography | no | No new crypto operations. Heartbeat key is opaque (instanceId). |
| V12 File and Resources | yes | bull-board static assets served only behind RBAC. `uiBasePath` is hard-coded path, not user-controlled. |
| V13 API and Web Service | yes | CSP `frame-ancestors` enforced. Same-origin policy enforced via reverse proxy. |
| V14 Configuration | yes | `BULL_BOARD_READ_ONLY` defaults to `"true"` (least privilege). Production envs explicitly opt-in to write mode. |

### Known Threat Patterns for Elysia + Bun + bull-board stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Operator clickjacks bull-board into a hostile iframe | Tampering / Elevation | CSP `frame-ancestors '${ADMIN_URL}'` (D-04) |
| Static asset fetch bypasses RBAC | Information Disclosure / Elevation | Wrap whole bull-board plugin in `requireRole("owner")` (D-03); test asserts `/static/*.css` returns 401 unauth |
| Cross-origin iframe cookie leak | Information Disclosure | Same-origin reverse proxy (D-05); browser only sends cookie to admin origin |
| Worker job data exposed in bull-board UI for non-operators | Information Disclosure | `requireRole("owner")` gates bull-board access entirely; no member-role bypass |
| Read-only mode bypassed via API | Tampering | bull-board's `readOnlyMode` is enforced server-side in `@bull-board/api` (per README); UI hiding alone is not the control |
| Recent errors leak PII (emails, tokens, payloads) | Information Disclosure / Privacy | Reuse Phase 18 `scrubPii` on message before storing in ringbuffer (Pitfall 9) |
| Heartbeat key collision across replicas | Tampering | `instanceId` includes hostname/pod-name; key shape `worker:heartbeat:{instanceId}` ensures uniqueness |
| KEYS command DoS on Redis | DoS | Use `SCAN` (D-12) — production-safe, incremental |
| Slow contributor stalls `/health/detailed` | DoS | `Promise.race` per-contributor timeout (D-11); 5s aggregate cache prevents stampede on poll |
| `BULL_BOARD_READ_ONLY` typo silently disables read-only | Tampering | `z.enum(["true","false"]).default("true")` — Zod rejects unknown values at boot |
| ADMIN_URL unset → CSP wide-open | Tampering / Information Disclosure | When unset, degrade to `'none'` — strictest possible (D-04) |
| Missing CSRF on bull-board write actions (when readOnly=false) | Tampering | Operator deployments accepting writes must enable better-auth CSRF (existing config); bull-board piggybacks on the same-origin cookie which carries the CSRF token. Document explicitly. |

## Sources

### Primary (HIGH confidence)
- `apps/api/src/routes/admin.ts` (existing source; verified 2026-04-27) — requireRole composition pattern, raw db pattern, status enum vocabulary
- `apps/api/src/index.ts` (existing source; verified 2026-04-27) — `db.execute(sql\`SELECT 1\`)` pattern, plugin mount order
- `apps/api/src/worker.ts` (existing source; verified 2026-04-27) — graceful shutdown handler, healthServer pattern, BullMQ Worker bootstrap
- `apps/api/src/core/registry.ts` (existing source; verified 2026-04-27) — `loadAll()` extension surface
- `packages/modules/auth/src/middleware.ts` (existing source; verified 2026-04-27) — requireRole derive shape
- `packages/queue/src/index.ts` + `connection.ts` (existing source; verified 2026-04-27) — `getRedisConnection`, wrapQueue/wrapProcessorWithAls (heartbeat must NOT use these)
- `packages/observability/src/index.ts` (existing source; verified 2026-04-27) — ErrorTracker port, getErrorTracker factory
- `apps/admin/src/routes/system/health.tsx` (existing source; verified 2026-04-27) — React Query polling pattern, status threshold values
- `apps/admin/src/layouts/admin-layout.tsx` (existing source; verified 2026-04-27) — sidebar navItems pattern
- `apps/admin/vite.config.ts` (existing source; verified 2026-04-27) — server.proxy pattern
- npm registry: `@bull-board/api@7.0.0`, `@bull-board/elysia@7.0.0` published 2026-04-20 (verified via `npm view`)
- `https://github.com/felixmosh/bull-board/blob/master/README.md` (verified raw fetch 2026-04-27) — readOnlyMode per-queue, uiConfig options
- `https://raw.githubusercontent.com/felixmosh/bull-board/master/examples/with-elysia/index.ts` (verified raw fetch 2026-04-27) — Bun-tested official example
- `https://raw.githubusercontent.com/felixmosh/bull-board/master/examples/with-elysia/package.json` (verified raw fetch 2026-04-27) — Bun build commands

### Secondary (MEDIUM confidence)
- [Elysia Handler docs — set.headers pattern](https://elysiajs.com/essential/handler) (verified via WebFetch 2026-04-27)
- [Elysia Lifecycle docs — onAfterHandle scope](https://elysiajs.com/essential/life-cycle) (web search 2026-04-27)
- [Vite Server Options — proxy](https://vite.dev/config/server-options) (web search 2026-04-27, cross-verified with project's existing config)
- [Bun v1.2.11 release notes — process.unref(timer)](https://bun.com/blog/bun-v1.2.11) (web search 2026-04-27)
- [bull-board oven-sh/bun#5809 eval workaround](https://github.com/oven-sh/bun/issues/5809) (cited inline in bull-board's official Bun example)
- [MDN — Content-Security-Policy frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors) (web search 2026-04-27)
- [Drizzle ORM — postgres-js usage](https://orm.drizzle.team/docs/get-started-postgresql) (web search 2026-04-27, cross-verified with project's existing usage)

### Tertiary (LOW confidence — flagged for confirmation if pivotal)
- [Vite cookie-domain rewriting — Matt's Life Bytes](https://mattslifebytes.com/2025/03/30/unbreaking-cookies-in-local-dev-with-vite-proxy/) (web search 2026-04-27) — used only as cross-reference for the canonical `changeOrigin: true` pattern; no novel claim depends on this source alone.

## Assumptions Log

> Claims tagged `[ASSUMED]` would normally appear here. After verification:

| # | Claim | Section | Risk if Wrong | Status |
|---|-------|---------|---------------|--------|
| (none) | (no claims left in `[ASSUMED]` state) | — | — | All material claims verified against npm registry, source code, or official docs cited above |

**Notes on near-assumptions resolved during research:**
- "bull-board uses HTTP polling, not WebSockets" — researched via WebSearch; no WS upgrade path documented in bull-board's API. The Vite proxy thus does NOT need `ws: true`. **Confidence: MEDIUM** — if a future bull-board release adds WS, the proxy entry needs updating. Documented in Pattern 2 inline comment.
- "Bun's single-threaded event loop makes ringbuffer concurrency-safe without locks" — standard JS semantics; not Bun-specific. **HIGH confidence.**
- "`@bull-board/elysia` v7.0.0 works under `elysia ^1.4.28`" — peer declared as `^1.1.0`; standard semver compat. Confirmed by official example using bun runtime. **HIGH confidence** — but executor should run a smoke test on Wave 1 to catch any edge case.

## Open Questions

> All questions raised in upstream `<additional_context>` resolved. Below are the remaining low-impact unknowns.

1. **Should the bull-board mount also accept `admin` role (not only `owner`)?**
   - What we know: D-01 says `requireRole("owner")`. Existing `apps/api/src/routes/admin.ts:39` mounts admin routes with the same single role.
   - What's unclear: Whether ops staff who are `admin` (not `owner`) should access bull-board.
   - Recommendation: Stick with `requireRole("owner")` for v1.3 (matches existing pattern); mention as a v1.4 candidate for fork users wanting tiered ops access.

2. **Should `/health/detailed` include a `version` field (Claude's Discretion item)?**
   - What we know: D-07's response shape doesn't list it; CONTEXT marks it as recommended.
   - Recommendation: Yes — read `process.env.RELEASE` (already used by Sentry releases per Phase 18) or read API package.json at boot. Adds 1 field, ~3 lines.

3. **How does the heartbeat reader behave under partial Redis read failures (one MGET key fails)?**
   - What we know: Pattern 5 wraps each JSON.parse in try/catch.
   - Recommendation: Already addressed by `try { JSON.parse(v) } catch { /* ignore */ }`. Document explicitly that a malformed entry is skipped, not surfaced as an error.

4. **Should the executor add a CI smoke test that boots the API and curls `/admin/bull-board`?**
   - What we know: D-03's integration test recipe assumes a running API.
   - Recommendation: Yes — add as `bun test:smoke` on Wave 1 task, gated by Redis being up. Catches Pitfall 5 (peer-dep drift on bull-board upgrades) before it ships.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun runtime | All — heartbeat publisher needs `process.unref()` ideally | Assumed available (project standard) | ≥1.2.11 recommended | Heartbeat publisher works without `process.unref` (only loses zero-effort process exit; explicit clearInterval still runs) |
| Redis | Heartbeat publisher + reader, bull-board, queue depth probe | Assumed available (project standard via docker-compose) | 7.x (existing) | None — Phase 22 deliverables are unavailable without Redis. `/health/detailed` would surface "redis unhealthy" gracefully but heartbeat publishing simply doesn't run. |
| PostgreSQL | DB lag probe | Assumed available (project standard) | 16+ (existing) | None — but `/health/detailed` will report `db: { connected: false, lagMs: null, status: "unhealthy" }` and continue. |
| `@bull-board/api` + `@bull-board/elysia` | bull-board mount | NOT YET INSTALLED (this phase installs) | 7.0.0 (target) | None — these are net-new deps; install is part of Wave 1. |
| `process.env.ADMIN_URL` | CSP frame-ancestors | Assumed set in deployments; default `http://localhost:5173` per existing env schema | URL string | When unset, CSP degrades to `'none'` (per D-04 — bull-board still mounts, just unembeddable). |
| `process.env.INSTANCE_ID` or `HOSTNAME` | Heartbeat instanceId | Available in Docker/k8s; falls back to os.hostname() | string | os.hostname() always works. |

**Missing dependencies with no fallback:** None — all blocking deps are either already in the project or net-new but well-supported.

**Missing dependencies with fallback:** Bun < 1.2.11 (rare; documented).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `@bull-board/elysia@7.0.0` Bun-compat verified via npm registry + official example with `bun --watch`; all other deps already in project
- Architecture: HIGH — every new file slots into existing patterns (Elysia plugin, ModuleDefinition extension, ErrorTracker decorator); no architectural reinvention
- Pitfalls: MEDIUM — all 10 pitfalls grounded in either source code, official docs, or known issues (oven-sh/bun#5809). Pitfall 5 (peer-dep drift) is forward-looking and only assertable post-upgrade.
- Validation Architecture: HIGH — every requirement mapped to a falsifiable bun-test or curl command; Wave 0 gap list complete

**Research date:** 2026-04-27
**Valid until:** 2026-05-27 (30 days — stable surface; bull-board v7.x just released, may see minor patches but not majors within this window)
