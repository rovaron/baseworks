# Phase 22: Admin Ops Tooling - Context

**Gathered:** 2026-04-27 (--auto mode — recommended defaults selected; human review encouraged before plan-phase)
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver in-app ops visibility for operators of a Baseworks fork — without leaving the Vite admin dashboard. Three deliverables, all gated by `requireRole("owner")`:

1. **`@bull-board/elysia`** mounted at `/admin/bull-board` behind the existing `requireRole("owner")` Elysia plugin, **read-only by default** via env feature-flag, with admin-origin CSP and 401/403 enforcement extended to bull-board's own static assets (CSS/JS/images).
2. **Admin "Job Monitor"** sidebar entry in `apps/admin` rendering bull-board as a **same-origin iframe** that shares the better-auth session cookie. No second auth step, no token-passing.
3. **`/health/detailed`** API endpoint + matching admin dashboard page surfacing: queue depth (with warn/critical thresholds), worker heartbeat freshness (must be **real**, fed by Redis heartbeat keys workers publish), DB lag, recent errors, per-module status. Modules contribute via a new `HealthContributor` slot on `ModuleDefinition`; a central aggregator rolls contributions up to overall status.

In scope: OPS-01..04 + EXT-02 (5 requirements). Out of scope: native bull-board UI rebuild (iframe is canonical — see PROJECT.md "Out of Scope"); Sentry-sourced "recent errors" UI (defer to Phase 23 runbooks if more than ringbuffer needed); browser-origin telemetry from the Next.js customer app; cross-tenant queue/job views (bull-board is process-global, not tenant-scoped — operator view, not customer view).

Phase 21 was deferred 2026-04-27 — no Grafana dashboards or OTLP wiring in scope here. The observability ports shipped in Phase 17 stay intact for fork users to wire OTLP later.

</domain>

<decisions>
## Implementation Decisions

### bull-board mounting + RBAC

- **D-01:** **Mount path = `/admin/bull-board` (root, not under `/api/admin/`).** bull-board ships its own Express-style adapter (`@bull-board/elysia`) that owns a path subtree including HTML, CSS, JS, and websocket-style polling endpoints. Mounting under `/api/admin/` would force every static asset request through the JSON-API tenant middleware, which is wasteful and confuses CORS. Use `/admin/bull-board` as a **separate top-level segment** that is NOT inside the `/api/admin/*` prefix used by `apps/api/src/routes/admin.ts`. Both segments are still protected by `requireRole("owner")`, just via separate Elysia plugin mounts.

- **D-02:** **Read-only mode default ON via `BULL_BOARD_READ_ONLY` env (default `"true"`).** Use `@bull-board/api`'s built-in `readOnlyMode: true` option rather than route-level filtering. Operator who needs to retry/promote/remove jobs flips the env var on a specific deployment. **`@t3-oss/env-core` schema** in `packages/config/src/env.ts` validates the var as `z.enum(["true","false"]).default("true")` so a typo crashes at boot rather than silently enabling writes. Crash-hard pattern matches Phase 17 D-09 (`validateObservabilityEnv`).

- **D-03:** **`requireRole("owner")` covers static assets too.** The `@bull-board/elysia` adapter exposes a single Elysia plugin — wrapping the entire mount in `.use(requireRole("owner"))` derives the role check on every request including HTML / CSS / JS / WebSocket-upgrade. Verify with an integration test that hits `/admin/bull-board/static/main.css` unauthenticated → 401, and authenticated as `member` role → 403. This closes the success-criterion clause "static asset requests are also gated."

- **D-04:** **Admin-origin CSP** — set `Content-Security-Policy: frame-ancestors '${ADMIN_URL}'` on the `/admin/bull-board/*` response set. No `frame-ancestors *` and no `frame-ancestors 'self'` — the admin dashboard runs on a different origin (`ADMIN_URL`), and we want the browser to refuse iframe embedding from anywhere else (e.g., a phishing page wrapping the operator's bull-board in a hostile iframe). `X-Frame-Options` is **dropped** in favor of CSP `frame-ancestors` (modern, supports multiple origins, HTML5-spec). When `ADMIN_URL` is unset, the policy degrades to `frame-ancestors 'none'` — bull-board still serves but cannot be iframed (manual `/admin/bull-board` visit still works).

### Admin iframe integration

- **D-05:** **Same-origin iframe via reverse-proxy at the admin Vite dev server / production deployment.** The admin dashboard is deployed alongside the API in Docker; in production, an nginx (or Caddy / Traefik) layer routes `/admin/bull-board/*` to the API service while serving the rest from the admin SPA. In dev, the Vite dev server proxies `/admin/bull-board/*` to `http://localhost:3000` via `vite.config.ts` server.proxy. **Result: bull-board appears at `${ADMIN_URL}/admin/bull-board` from the browser's perspective**, the better-auth session cookie (issued by the API on `ADMIN_URL` if same-origin or via `SameSite=Lax` cookie domain) is automatically sent. No CORS, no token-passing, no second login step.
  - Fallback if reverse-proxy is not feasible in a fork's deployment: use `credentials: 'include'` iframe sandbox attributes — but document this as the secondary path. Same-origin proxy stays canonical.

- **D-06:** **Sidebar entry: "Job Monitor"** with the lucide `ListTodo` icon, slot in `apps/admin/src/layouts/admin-layout.tsx` `navItems` between `system` and the user dropdown. Route path `/jobs`. The route is a thin `<iframe src="/admin/bull-board" title="Job Monitor" className="w-full h-[calc(100vh-3.5rem)] border-0" />` rendered inside the existing `AdminLayout`'s main content slot — keeps the sidebar visible, no chrome-in-chrome. i18n key: add `nav.jobs` to `packages/i18n/src/locales/{en,pt-BR}/admin.json`.

### `/health/detailed` API contract

- **D-07:** **Endpoint = `GET /health/detailed`, RBAC = `requireRole("owner")`, response shape is `data` envelope identical to `/api/admin/system/health` for consistency.**
  ```ts
  {
    data: {
      status: "healthy" | "degraded" | "unhealthy",   // overall — derived from contributors + queues + heartbeat
      timestamp: string,                               // ISO 8601
      uptime: number,                                  // process.uptime() seconds
      queues: Array<{
        name: string,
        waiting: number,
        active: number,
        delayed: number,
        completed: number,
        failed: number,
        status: "healthy" | "warning" | "critical",
        thresholds: { warn: number, critical: number }
      }>,
      workers: Array<{
        instanceId: string,    // hostname or pod name
        queues: string[],      // queues this worker serves
        lastHeartbeat: string, // ISO 8601
        ageSec: number,        // now - lastHeartbeat in seconds
        status: "healthy" | "stale" | "dead"  // healthy if age < 2x interval, stale if 2-5x, dead if > 5x or missing
      }>,
      db: {
        connected: boolean,
        lagMs: number | null,  // round-trip latency from a SELECT 1; null on failure
        status: "healthy" | "degraded" | "unhealthy"
      },
      recentErrors: Array<{
        timestamp: string,
        message: string,    // truncated to 500 chars
        source: "cqrs" | "http" | "worker" | "global",
        count: number       // dedup count within window
      }>,
      modules: Array<{
        name: string,
        loaded: boolean,
        status: "healthy" | "degraded" | "unhealthy" | "unknown",
        details?: Record<string, unknown>  // module-supplied
      }>
    }
  }
  ```
  Existing `/api/admin/system/health` (apps/api/src/routes/admin.ts:321) becomes a thin alias / deprecated stub redirecting to `/health/detailed` — keeps existing admin UI working during cutover, single deprecation note in the response. Phase 22 ships both routes; remove the old route in v1.4 cleanup.

- **D-08:** **Endpoint location: top-level on the API root, NOT mounted via the `module-auth` admin routes plugin.** Reason: `requireRole("owner")` is composable — wrap the new endpoint in its own Elysia plugin at `apps/api/src/routes/health-detailed.ts` so the `/health` (unauthenticated, Docker probe) and `/health/detailed` (RBAC, admin) live side-by-side at the API root. Don't co-locate inside `routes/admin.ts` because that file is `/api/admin/*`-prefixed; we want `/health/detailed` raw at the root for clarity (Docker probes hit `/health`, ops dashboards hit `/health/detailed`).

- **D-09:** **Default queue depth thresholds: `warn=100`, `critical=1000`.** Hardcoded in the aggregator, not env-tunable in v1.3 (avoid env sprawl). Rationale: matches the existing `apps/admin/src/routes/system/health.tsx:32-35` `getQueueStatus` thresholds — keeps UI semantics stable. Per-queue overrides land in v1.4 if a fork user reports a queue with wildly different volume.

### `HealthContributor` registration

- **D-10:** **Extend `ModuleDefinition` with optional `health?: HealthContributor` slot.** Mirrors how `commands` / `queries` / `jobs` are declared today. New type in `packages/shared/src/types/module.ts`:
  ```ts
  export interface HealthContributor {
    name: string;          // typically the module name; required so the aggregator can label results
    check: () => Promise<HealthCheckResult>;
    timeoutMs?: number;    // default 2000
  }
  export interface HealthCheckResult {
    status: "healthy" | "degraded" | "unhealthy";
    details?: Record<string, unknown>;
  }
  ```
  The registry's `loadAll()` (apps/api/src/core/registry.ts:67) collects all `def.health` entries into a `HealthAggregator` instance the API entrypoint exposes to the `/health/detailed` route. Thrown errors / timeouts → contributor reported as `unhealthy` with `details.error: <stringified>`. Worst-of-N rollup: any `unhealthy` contributor → overall `unhealthy`; any `degraded` → overall `degraded`; otherwise `healthy`.

- **D-11:** **Aggregator runs contributors in parallel via `Promise.allSettled`** with a per-contributor timeout (default 2000ms via `Promise.race`). Total budget for `/health/detailed` ≤ 3 seconds. Cache last successful aggregation for 5 seconds (in-memory) to debounce admin UI's `refetchInterval: 30000` plus any concurrent dashboard reloads — ops dashboards should not pummel the DB/Redis with a real query every poll.

### Worker heartbeat (EXT-02)

- **D-12:** **Heartbeat key shape: `worker:heartbeat:{instanceId}` (Redis SET with EX TTL).** `instanceId` resolution order: `process.env.INSTANCE_ID` → `process.env.HOSTNAME` → `os.hostname()` (a `lib/instance-id.ts` helper, exported from `@baseworks/observability` since other packages already import obs helpers). Value is JSON: `{ instanceId, queues: string[], lastHeartbeat: ISO, version?: string }`. TTL = `2 × WORKER_HEARTBEAT_INTERVAL_MS` so a missed beat shows as `stale` for one full window before disappearing entirely (`dead` is computed by absence). Reading uses `SCAN 0 MATCH worker:heartbeat:*` not `KEYS` — production-safe.

- **D-13:** **Heartbeat interval default: 15 seconds, env-tunable via `WORKER_HEARTBEAT_INTERVAL_MS` (z.coerce.number with min 1000, max 300000, default 15000).** Derived thresholds (D-07 worker.status): `healthy` if `age < 2 × interval` (≤30s), `stale` if `age < 5 × interval` (≤75s), `dead` if older or missing. The ratio is hardcoded (not env-tunable) because tunable ratios produce unobservable latency curves.

- **D-14:** **Worker publishes via `setInterval` started after `registry.loadAll()` and before workers attach.** Wraps in a try/catch so a Redis hiccup logs (pino warn) but does not crash the worker. Cleared on graceful shutdown via the existing `shutdown()` handler (apps/api/src/worker.ts:154). Single timer per worker process, regardless of how many BullMQ Workers it owns — the heartbeat enumerates `workers.map(w => w.name)` at publish time.

### Recent errors source

- **D-15:** **In-memory ringbuffer fed by an `ErrorTracker` adapter wrapper, capacity 50, deduped by error.message + first stack frame.** Wraps `getErrorTracker()` from `@baseworks/observability` with a `RingBufferingErrorTracker` decorator that **delegates** to the underlying adapter (Sentry / GlitchTip / Pino / Noop) for actual reporting AND retains a process-local rolling window for the admin UI. **Deliberately NOT a Sentry API query** — that requires a project read token in the admin app, fork-user maintenance burden, and works only when Sentry SaaS is configured. The ringbuffer works regardless of `ERROR_TRACKER` choice including `noop`. Memory bound: 50 entries × ~600 bytes = 30 KB/process. Cleared on process restart, which is fine — operators wanting persistent error history go to Sentry.

- **D-16:** **Per-module status defaults to `loaded ? "healthy" : "unhealthy"` when a module declares no `HealthContributor`.** Don't punish modules that have no meaningful health to report; "loaded successfully" is a real signal. v1.3 ships only `auth`, `billing`, `example` modules — none ships a `HealthContributor` in this phase (intentional minimal-footprint cut; demonstrate the slot in a follow-up phase).

### Claude's Discretion

- Exact icon for "Job Monitor" sidebar entry — `ListTodo` is the recommended pick from lucide; substitute if visual reviewer disagrees.
- Iframe loading skeleton / error state UI in `/jobs` route — reuse the patterns from `apps/admin/src/routes/system/health.tsx` (Skeleton + Card + retry button on error).
- Exact CSP headers beyond `frame-ancestors` — let the executor add reasonable defaults (no inline scripts in bull-board's own page, etc.) without user input.
- Whether `/health/detailed` includes a `version` field — recommended yes (read from `package.json`), no human input needed.
- Whether to emit a span around each contributor's `check()` — recommended yes (uses Phase 17/19 wrappers), no user input needed.

### Folded Todos

None. The single matched todo (`Harden inbound traceparent trust-gate (re-introduce CIDR/header check before public ingress)`, score 0.2) is below the auto-fold threshold (0.4) and unrelated to admin ops tooling — listed in `<deferred>` instead.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + requirements
- `.planning/REQUIREMENTS.md` §OPS — OPS-01..04 + EXT-02 acceptance language
- `.planning/milestones/v1.3-ROADMAP.md` §"Phase 22: Admin Ops Tooling" — full success criteria
- `.planning/ROADMAP.md` §"Phase 22: Admin Ops Tooling" — mirrored summary

### Prior CONTEXT (decisions to honor)
- `.planning/phases/17-observability-ports-otel-bootstrap/17-CONTEXT.md` — `Tracer` / `MetricsProvider` / `ErrorTracker` ports, env-selected factory, OTEL line-1 bootstrap pattern (D-09 crash-hard env validation pattern reused here for `BULL_BOARD_READ_ONLY` + `WORKER_HEARTBEAT_INTERVAL_MS`)
- `.planning/phases/19-context-logging-http-cqrs-tracing/19-CONTEXT.md` — `obsContext` ALS shape; observability middleware patterns the `/health/detailed` route should respect (no PII labels, no per-tenant cardinality on cross-tenant ops endpoint)
- `.planning/phases/20-bullmq-trace-propagation/20-CONTEXT.md` — `wrapQueue` / `wrapProcessorWithAls` are the ONLY enqueue/dequeue surface; the heartbeat publisher must NOT mint orphan span trees (just call `redis.set` directly)
- `.planning/phases/20.1-close-v13-milestone-gaps/20.1-CONTEXT.md` — billing scopedDb correction; the `/health/detailed` route uses RAW `db` (cross-tenant operator view), NOT scopedDb — same pattern as `apps/api/src/routes/admin.ts:21`

### Existing source patterns to extend
- `apps/api/src/routes/admin.ts:39` — `requireRole("owner")` mount pattern; the new `/health/detailed` route plugin and the bull-board mount both copy this
- `apps/api/src/routes/admin.ts:321-349` — current `/api/admin/system/health`; deprecated alias path in D-07
- `apps/api/src/index.ts:100-133` — current `/health` (unauthenticated, Docker probe); STAYS unchanged
- `apps/api/src/worker.ts:113-149` — worker `/health` server (port 3001); the heartbeat publisher attaches alongside this, not inside it
- `apps/api/src/core/registry.ts:67-110` — `ModuleRegistry.loadAll()`; extend to collect `def.health` contributors
- `apps/admin/src/layouts/admin-layout.tsx:36-41` — `navItems` array; add `{ titleKey: "nav.jobs", icon: ListTodo, href: "/jobs" }`
- `apps/admin/src/routes/system/health.tsx` — UI patterns (React Query, refetchInterval, Skeleton + Card error/loading); the new `/jobs` and updated `/system` routes follow this style
- `packages/modules/auth/src/middleware.ts:57-90` — `requireRole(...roles)` Elysia plugin; reused unmodified
- `packages/queue/src/index.ts` — `wrapQueue` / `wrapProcessorWithAls`; heartbeat publisher uses raw `getRedisConnection`, NOT a wrapped Queue
- `packages/shared/src/types/module.ts` — `ModuleDefinition`; extend with `health?: HealthContributor`
- `packages/config/src/env.ts` — env validator; add `BULL_BOARD_READ_ONLY` + `WORKER_HEARTBEAT_INTERVAL_MS`
- `.env.example` — append the two new vars with documentation

### Project doctrine
- `CLAUDE.md` — Bun-only constraint applies to `@bull-board/elysia` selection (see PITFALLS below)
- `.planning/PROJECT.md` "Out of Scope" → "Building a native bull-board UI in the Vite admin SPA" — iframe is canonical

### External docs (planner verifies versions/compatibility under Bun)
- `@bull-board/api` + `@bull-board/elysia` — bull-board's native Elysia adapter (preferred; verify Bun-compat in research phase)
- `bullmq` — already a dep
- `lucide-react` `ListTodo` icon — already a dep

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`requireRole(...roles)`** (`packages/modules/auth/src/middleware.ts:57`) — Elysia plugin, drop-in for both bull-board mount and `/health/detailed` route plugin. No new RBAC code needed.
- **`getRedisConnection(redisUrl)`** (`packages/queue/src/connection.ts` exported via `@baseworks/queue`) — heartbeat publisher uses this directly; no new connection pool needed.
- **`createDb(env.DATABASE_URL)` / raw `db`** — existing pattern in `apps/api/src/routes/admin.ts:21`; `/health/detailed` reuses for the DB-lag probe.
- **`getErrorTracker()`** (`@baseworks/observability`) — `RingBufferingErrorTracker` decorator wraps it; existing factory pattern preserved.
- **`obsContext`** (`@baseworks/observability`) — `/health/detailed` route inherits trace context automatically via existing observabilityMiddleware (Phase 19).
- **Admin `Card` / `Badge` / `Skeleton` from `@baseworks/ui`** — UI for `/jobs` iframe wrapper and `/health/detailed` page reuses Phase 19 + existing system/health.tsx patterns.
- **`logger.child({ ... })`** (`apps/api/src/lib/logger.ts`) — heartbeat publisher logs warnings on Redis failures via existing pino setup.
- **i18n keys + `useTranslation("admin")`** (`apps/admin`) — sidebar label flows through existing translation pipeline (en + pt-BR JSON).

### Established Patterns

- **Env validation crashes at boot** (`packages/config/src/env.ts` + `validateObservabilityEnv()` in Phase 17 D-09) — both new env vars (`BULL_BOARD_READ_ONLY`, `WORKER_HEARTBEAT_INTERVAL_MS`) follow this; no graceful degradation, no silent defaults that diverge from the schema.
- **Cross-tenant admin queries use raw `db`, NOT scopedDb** — `apps/api/src/routes/admin.ts:21` and `routes/admin.ts:42-90` queries via raw db; `/health/detailed` and bull-board's `getQueue` calls are operator-scope by definition (Phase 20.1 D-07 reinforced this — scopedDb on operator endpoints corrupts results).
- **Admin React Query polling** — `useQuery({ queryKey, queryFn, refetchInterval: 30000 })` is the canonical client pattern in `apps/admin/src/routes/system/health.tsx`.
- **Same-origin reverse proxy** — Vite dev server `server.proxy` is the existing pattern; production via Docker reverse-proxy. New `/admin/bull-board` route follows the same wiring.
- **Module-registry registration** — `def.commands` / `def.queries` / `def.jobs` are all collected in `loadAll()`. Adding `def.health` is a one-line collector extension.
- **Status enums consistent** across UI and API — `"healthy" | "degraded" | "unhealthy" | "warning" | "critical"` already used in `apps/admin/src/routes/system/health.tsx`; new endpoint emits the same vocabulary.

### Integration Points

- **`apps/api/src/index.ts`** — mount `/admin/bull-board` plugin AND `/health/detailed` plugin; both wrap `requireRole("owner")`. Mount BEFORE the `/api/auth/*` mount? After? Verdict: mount AFTER `/health` (unauthenticated probe) and BEFORE the tenant middleware group, so neither requires tenant context.
- **`apps/api/src/worker.ts`** — heartbeat `setInterval` started after `registry.loadAll()`, cleared in `shutdown()`. `WORKER_HEARTBEAT_INTERVAL_MS` env var read once at startup.
- **`apps/api/src/core/registry.ts`** — `loadAll()` extended to collect `def.health` contributors into a `HealthAggregator` instance accessible via a new `registry.getHealthAggregator()` method.
- **`apps/admin/src/main.tsx`** route table — add `{ path: "/jobs", lazy: () => import("./routes/jobs") }` (matching the existing lazy-loaded route pattern).
- **`apps/admin/src/layouts/admin-layout.tsx:36-41`** — append nav item.
- **`packages/i18n/src/locales/{en,pt-BR}/admin.json`** — add `nav.jobs` key (en: "Job Monitor", pt-BR: "Monitor de Jobs"), plus any new keys for `/health/detailed` UI elements not already covered by `systemHealth.*`.
- **`packages/config/src/env.ts`** — add `BULL_BOARD_READ_ONLY` and `WORKER_HEARTBEAT_INTERVAL_MS` to env schema.
- **`vite.config.ts`** in `apps/admin` — add `server.proxy['/admin/bull-board']` → `http://localhost:3000` for dev.
- **Docker / production reverse-proxy config** — document the `/admin/bull-board/*` route to the API service in the deployment docs (Phase 23 runbooks territory; reference here only).

</code_context>

<specifics>
## Specific Ideas

- "Job Monitor" naming follows the requirement language ("Admin user sees a 'Job Monitor' entry"); keep it.
- Operator UX: clicking the sidebar entry should NOT navigate away from the admin SPA — iframe inside the existing layout (D-06).
- DB-lag metric is round-trip latency from `SELECT 1`, not replication lag — Baseworks runs single-instance Postgres per the project constraints; replication-lag instrumentation belongs in v1.4+ if read-replicas land.
- Recent-errors ringbuffer is intentionally process-local; operators running multiple API replicas see only their hit replica's slice. Acceptable trade-off given the alternative is Sentry-API-query complexity.
- Worker heartbeat replaces a previously mocked dashboard signal — operators were getting a green light on a worker that had crashed. Real heartbeat keys close that observability gap.

</specifics>

<deferred>
## Deferred Ideas

- **Per-queue threshold overrides** (e.g., `email-send` may tolerate a 5000-deep waiting queue while `billing-webhook` should warn at 50). Deferred to v1.4. v1.3 ships single global `warn=100` / `critical=1000` defaults.
- **Native bull-board UI inside the Vite SPA** — explicitly Out of Scope per PROJECT.md. Iframe is the long-term shape.
- **Sentry-sourced recent errors** — defer until/unless ringbuffer proves insufficient. Adding a Sentry API call from the admin app introduces a project-read token + token rotation problem the v1.3 scope avoids.
- **Tenant-scoped admin views of jobs / queues** — bull-board is process-global; per-tenant filtering is a different feature. v1.4+ if customers want self-serve job visibility.
- **Cross-replica error-aggregation across multiple API processes** — the ringbuffer is local to the hit replica. Cross-replica aggregation requires Redis pub/sub or a streaming layer; defer.
- **`HealthContributor` for auth/billing/example modules** — the slot ships in Phase 22 but the modules don't populate it. Follow-up phase wires meaningful checks (e.g., billing pings the active payment provider's `/health` if one exists).
- **`/metrics` Prometheus scrape endpoint** — already deferred per REQUIREMENTS.md MET-future-01.
- **Runbook entries for "bull-board inaccessible" alert** — listed in Phase 23 success criteria; cross-reference there.
- **Module-version reporting** — adding `version` per module in `/health/detailed` is small, but defer until Phase 23 docs indicates it's needed for runbook diagnostics.

### Reviewed Todos (not folded)

- **`2026-04-26-harden-inbound-traceparent-trust-gate.md`** (score 0.2, area: api) — keyword match was incidental (`env`); the todo is about trust gates on inbound `traceparent` headers, which is observability-trust hardening, not admin ops tooling. Belongs in a future security-hardening phase. Not folded.

</deferred>

---

*Phase: 22-admin-ops-tooling*
*Context gathered: 2026-04-27 (--auto mode)*
