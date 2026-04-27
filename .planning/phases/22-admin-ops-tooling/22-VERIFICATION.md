---
phase: 22-admin-ops-tooling
verified: 2026-04-27T19:30:00Z
status: human_needed
score: 5/5
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 2/5
  gaps_closed:
    - "OPS-01: apps/api/src/routes/bull-board.ts now exists with createBullBoardPlugin, requireRole(owner), CSP frame-ancestors, readOnly env flag; @bull-board/* at 7.0.0 installed; bullBoardPlugin mounted in index.ts"
    - "OPS-03: apps/api/src/routes/health-detailed.ts now exists with createHealthDetailedPlugin and full D-07 envelope; RingBufferingErrorTracker wired in index.ts; 4 built-in contributors registered; .use(healthDetailedPlugin) mounted"
    - "EXT-02: packages/observability/src/health/heartbeat.ts now exists with startHeartbeatPublisher (raw redis.set, SCAN-not-KEYS reader); worker.ts wired with publisher start + heartbeat.stop() in shutdown()"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Iframe session cookie sharing"
    expected: "Navigating to /jobs in the admin dashboard renders bull-board inside the iframe with no second login prompt"
    why_human: "Browser cookie forwarding through the Vite reverse proxy cannot be verified programmatically"
  - test: "CSP frame-ancestors browser enforcement"
    expected: "Opening a foreign-origin HTML page with an iframe pointing to http://localhost:3000/admin/bull-board shows a CSP violation in the browser console and the iframe is blocked"
    why_human: "CSP enforcement is browser-side; integration tests can only verify header presence, not browser enforcement"
  - test: "Worker heartbeat dead status after SIGKILL"
    expected: "After pkill -9 of the worker process and waiting 80s, GET /health/detailed shows workers[].status === 'dead'"
    why_human: "Requires process kill + 80s TTL wait — too slow for CI"
  - test: "pt-BR locale rendering of Job Monitor sidebar and health status badges"
    expected: "Switching the admin app to pt-BR shows 'Monitor de Jobs' in the sidebar and localized status badges on the /system page"
    why_human: "Visual locale validation"
---

# Phase 22: Admin Ops Tooling — Verification Report

**Phase Goal:** Admin user can monitor jobs and system health from the Vite admin dashboard without leaving the app, with bull-board gated by RBAC and read-only by default.
**Verified:** 2026-04-27T19:30:00Z
**Status:** human_needed
**Re-verification:** Yes — all 3 previously failed gaps are now closed; 5/5 truths verified; 4 items require human testing before status can advance to passed.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | bull-board mounted at /admin/bull-board behind requireRole("owner") with read-only default, admin-origin CSP, and 401/403 gating including static assets | VERIFIED | `apps/api/src/routes/bull-board.ts` confirmed (71 lines). `.use(requireRole("owner"))` at line 68. CSP via `.onRequest` so it survives requireRole-throws path (line 65-67). `env.BULL_BOARD_READ_ONLY === "true"` drives readOnly flag (line 39). `@bull-board/api`, `@bull-board/elysia`, `@bull-board/ui` at 7.0.0 in `apps/api/package.json`. `.use(bullBoardPlugin)` at line 288 in index.ts, after `/health` (line 250) and before authRoutes (line 295). `admin-bull-board.test.ts` has 9 integration tests covering 401/403/static-asset/CSP/readOnly. |
| 2 | Admin "Job Monitor" sidebar entry renders bull-board as same-origin iframe sharing better-auth session cookie | VERIFIED | `admin-layout.tsx` line 41: `{titleKey:"nav.jobs", icon:ListTodo, href:"/jobs"}`. `router.ts` line 19: lazy `/jobs` route. `jobs.tsx` iframe `src="/admin/bull-board"` with `IframeWithErrorHandler` ref-based load/error. `vite.config.ts`: `/admin/bull-board` proxy with `changeOrigin:true, ws:true`. `en/admin.json` `nav.jobs:"Job Monitor"`. Backend mount confirmed in Truth 1. |
| 3 | /health/detailed endpoint + admin dashboard page showing queue depth, worker heartbeat freshness, DB lag, recent errors, and per-module status | VERIFIED | `apps/api/src/routes/health-detailed.ts` confirmed (180 lines). `createHealthDetailedPlugin(deps)` factory behind `requireRole("owner")`. D-07 envelope (status/timestamp/uptime/queues/workers/db/recentErrors/modules) confirmed. Queue thresholds QUEUE_WARN=100, QUEUE_CRITICAL=1000. Worker freshness 2×/5× interval thresholds. Per-queue try/catch. Heartbeat read failure surfaces as empty workers[]. `.use(healthDetailedPlugin)` at line 292 in index.ts. `health.tsx` rewritten to `fetch("/health/detailed", {credentials:"include"})` with `refetchInterval:30000`. All 5 sections rendered (queues, workers, db, recentErrors, modules). `health-detailed.test.ts` has 10 integration tests. |
| 4 | HealthContributor registered at module registration time; central aggregator rolls up all contributions | VERIFIED | `HealthContributor` + `HealthCheckResult` in `packages/shared/src/types/module.ts`. `ModuleDefinition.health?` slot present. `HealthAggregator` class in `apps/api/src/core/health-aggregator.ts` (133 lines): Promise.allSettled fanout, per-contributor 2000ms timeout (race-resolves-not-throws per Pitfall 4), 5000ms in-memory cache, worst-of-N rollup. `registry.ts` collects `def.health` at lines 100-103 in `loadAll()`. `getHealthAggregator()` getter confirmed. 4 built-in contributors (db, queueDepth, workerHeartbeat, recentErrors) registered in `index.ts` lines 122-207. D-16 default ("healthy") applied for v1.3 modules that ship no contributor — intentional and documented. |
| 5 | Workers publishing heartbeat keys to Redis on configurable interval; health dashboard worker-heartbeat reflects real state | VERIFIED | `packages/observability/src/health/heartbeat.ts` confirmed (134 lines). `startHeartbeatPublisher` writes `worker:heartbeat:{instanceId}` with `EX TTL = 2 × intervalMs / 1000`. `readHeartbeats` uses `SCAN MATCH worker:heartbeat:* COUNT 100` (no `redis.keys` call). `apps/api/src/worker.ts`: publisher started at line 116 via `startHeartbeatPublisher({redis, instanceId: resolveInstanceId(), getQueues: () => workers.map(w=>w.name), intervalMs: env.WORKER_HEARTBEAT_INTERVAL_MS})`. `heartbeat.stop()` called first in shutdown() at line 178, before workers.close() and closeConnection(). `WORKER_HEARTBEAT_INTERVAL_MS` env var in `packages/config/src/env.ts` (z.coerce.number, min 1000, max 300000, default 15000). `worker-heartbeat.test.ts` has 4 integration tests covering instanceId resolution, queue enumeration, EX TTL, and DEL on stop(). |

**Score:** 5/5 truths verified

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Per-module rollup propagation — data.modules[].status falls through to D-16 "healthy" default for all v1.3 modules | Phase 23 / v1.4 | Intentional: no v1.3 module ships a HealthContributor. Aggregator infrastructure (slot, class, registry wiring, 4 built-in contributors) is complete. Per-module status propagation is documented as v1.4 follow-up in 22-CONTEXT.md Deferred Ideas and 22-05-SUMMARY.md key-decisions. Not a gap — the aggregator's worst-of-N rollup IS reflected in data.status overall. |
| 2 | Hardcoded "Uptime" label and "Loaded"/"Not loaded" strings in health.tsx | Phase 23 / v1.4 | Minor UI-SPEC violation noted in 22-06-SUMMARY.md Hardcoded Copy Fallback Audit. Two strings only; flagged for v1.4 i18n cleanup. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/config/src/env.ts` | BULL_BOARD_READ_ONLY + WORKER_HEARTBEAT_INTERVAL_MS | VERIFIED | Lines 49-52. z.enum crash-hard + z.coerce.number with min/max bounds. |
| `packages/shared/src/types/module.ts` | HealthContributor + HealthCheckResult + ModuleDefinition.health? | VERIFIED | All 3 present. HealthContributor.{name, check, timeoutMs?} per D-10. |
| `packages/observability/src/instance-id.ts` | resolveInstanceId() with INSTANCE_ID → HOSTNAME → os.hostname() | VERIFIED | 16 lines. Correct D-12 fallback chain. No @baseworks/config coupling. |
| `packages/observability/src/lib/ring-buffer-error-tracker.ts` | RingBufferingErrorTracker decorator, capacity 50, dedup, snapshot() | VERIFIED | 130 lines. Full port delegation. Dedup-index reindexing on eviction. snapshot() returns defensive copy. |
| `packages/observability/src/health/heartbeat.ts` | startHeartbeatPublisher + readHeartbeats + HeartbeatPayload | VERIFIED | 134 lines. Raw redis.set with EX TTL. SCAN-not-KEYS reader. Publish-once-immediately on start. DEL on stop(). |
| `packages/observability/src/index.ts` | Exports resolveInstanceId, RingBufferingErrorTracker, startHeartbeatPublisher, readHeartbeats | VERIFIED | All confirmed at lines 71, 74, 82. |
| `apps/api/src/core/health-aggregator.ts` | HealthAggregator with allSettled + timeout + 5s cache + worst-of-N | VERIFIED | 133 lines. DEFAULT_TIMEOUT_MS=2000, CACHE_TTL_MS=5000. Race-resolves-not-throws (Pitfall 4). |
| `apps/api/src/core/registry.ts` | def.health collector + getHealthAggregator() | VERIFIED | def.health collected at lines 100-103. getHealthAggregator() getter confirmed. |
| `apps/api/src/routes/bull-board.ts` | createBullBoardPlugin factory + RBAC + CSP + readOnly | VERIFIED | 71 lines. requireRole("owner"), CSP via onRequest, readOnly env-driven, uiBasePath Bun workaround. |
| `apps/api/package.json` | @bull-board/api + @bull-board/elysia + @bull-board/ui at 7.0.0 | VERIFIED | All 3 at "7.0.0" in dependencies. |
| `apps/api/src/routes/health-detailed.ts` | createHealthDetailedPlugin factory + D-07 envelope | VERIFIED | 180 lines. Factory-shaped plugin, deps injection, requireRole("owner"), full envelope. |
| `apps/api/src/index.ts` | Mounts bullBoardPlugin (L288) + healthDetailedPlugin (L292); RingBufferingErrorTracker (L59); 4 contributors (L122-207) | VERIFIED | All mounts confirmed. Mount order: /health (250) < bullBoardPlugin (288) < healthDetailedPlugin (292) < authRoutes (295) < tenantMiddleware (297). |
| `apps/api/src/worker.ts` | startHeartbeatPublisher after loadAll() (L116); heartbeat.stop() first in shutdown() (L178) | VERIFIED | Both confirmed. Shutdown order: heartbeat.stop() → healthServer.stop() → workers.close() → closeConnection(). |
| `apps/api/test/admin-bull-board.test.ts` | 9 integration tests (RBAC, CSP, readOnly, uiBasePath) | VERIFIED | 9 tests covering unauth-401, member-403, static-asset 401, CSP success/error/fallback, readOnly true/false, scope-leak guard. |
| `apps/api/test/health-detailed.test.ts` | 10 integration tests (RBAC, envelope, thresholds, freshness, modules, recentErrors) | VERIFIED | 10 tests across 6 describe blocks. |
| `apps/api/test/worker-heartbeat.test.ts` | 4 integration tests (instanceId, queue enumeration, TTL, DEL on stop) | VERIFIED | 4 tests with fake redis stub. |
| `apps/admin/src/routes/jobs.tsx` | IframeWithErrorHandler + loading skeleton + error card | VERIFIED | 128 lines. Ref-based load/error listeners. src="/admin/bull-board". sandbox attrs. |
| `apps/admin/src/routes/system/health.tsx` | fetch("/health/detailed") + React Query refetchInterval:30000 + full envelope rendering | VERIFIED | fetch confirmed at line 108. refetchInterval:30000 at line 117. All 5 sections rendered. |
| `apps/admin/src/layouts/admin-layout.tsx` | nav.jobs + ListTodo icon | VERIFIED | ListTodo imported at line 31. nav.jobs item at line 41. |
| `apps/admin/src/lib/router.ts` | /jobs lazy route | VERIFIED | Line 19: {path:"jobs", lazy: () => import("../routes/jobs")}. |
| `apps/admin/vite.config.ts` | /admin/bull-board (ws:true) + /health/detailed proxy entries | VERIFIED | Both present. changeOrigin:true on both. ws:true on /admin/bull-board. |
| `packages/i18n/src/locales/en/admin.json` | nav.jobs + jobs.* + systemHealth.workers/db/recentErrors/modules/errors keys | VERIFIED | nav.jobs:"Job Monitor". jobs.* (5 keys). 44 total keys added including all systemHealth extensions. |
| `packages/i18n/src/locales/pt-BR/admin.json` | pt-BR translations for all above | VERIFIED | nav.jobs:"Monitor de Jobs". jobs.title:"Monitor de Jobs". 44 keys added. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `apps/api/src/routes/bull-board.ts` | `requireRole("owner")` | `.use(requireRole("owner"))` | WIRED | Line 68. Covers every request including static assets (D-03). |
| `apps/api/src/routes/bull-board.ts` | CSP header | `.onRequest` sets frame-ancestors | WIRED | Line 65-67. Fires before requireRole so header present even on 401/403 responses. |
| `apps/api/src/index.ts` | `bull-board.ts` | `.use(bullBoardPlugin)` | WIRED | Line 288. After /health, before authRoutes. |
| `apps/api/src/routes/health-detailed.ts` | `requireRole("owner")` | `.use(requireRole("owner"))` | WIRED | Line 43. |
| `apps/api/src/index.ts` | `health-detailed.ts` | `.use(healthDetailedPlugin)` | WIRED | Line 292. After bullBoardPlugin, before authRoutes. |
| `apps/api/src/index.ts` | `RingBufferingErrorTracker` | `new RingBufferingErrorTracker(getErrorTracker(), 50)` | WIRED | Line 59. Passed to installGlobalErrorHandlers and wrapCqrsBus. snapshot() passed to healthDetailedPlugin deps. |
| `apps/api/src/index.ts` | 4 built-in HealthContributors | `aggregator.register({...})` × 4 | WIRED | Lines 122-207. db, queueDepth, workerHeartbeat, recentErrors. |
| `apps/api/src/core/registry.ts` | `HealthAggregator` | `this.healthAggregator.register(def.health)` | WIRED | Lines 100-103 in loadAll(). |
| `apps/api/src/worker.ts` | `startHeartbeatPublisher` | call at line 116 | WIRED | After registry.loadAll() and workers loop. getQueues lazy arrow re-evaluated each tick. |
| `apps/api/src/worker.ts` | `heartbeat.stop()` | called first in shutdown() | WIRED | Line 178. Before healthServer.stop(), workers.close(), closeConnection(). |
| `apps/admin/src/routes/jobs.tsx` | `/admin/bull-board` (backend) | iframe src + vite proxy | WIRED | Both ends confirmed: iframe src="/admin/bull-board" + vite.config.ts proxy entry. |
| `apps/admin/src/routes/system/health.tsx` | `/health/detailed` (backend) | fetch + vite proxy | WIRED | Both ends confirmed: fetch("/health/detailed") + vite.config.ts proxy entry. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `apps/admin/src/routes/system/health.tsx` | `data` (DetailedHealth) | `fetch("/health/detailed", {credentials:"include"})` → `/health/detailed` endpoint → HealthAggregator.aggregate() + Queue.getJobCounts() + readHeartbeats() + db SELECT 1 | Yes — 4 real infra probes | FLOWING |
| `apps/admin/src/routes/jobs.tsx` | iframe content | `/admin/bull-board` → bull-board Elysia plugin → BullMQ Queue.getJobCounts() | Yes — bull-board reads live BullMQ queues | FLOWING |
| `apps/api/src/core/health-aggregator.ts` | `AggregatedHealth` | 4 built-in contributors registered in index.ts: db (SELECT 1), queueDepth (Queue.getJobCounts), workerHeartbeat (readHeartbeats/SCAN), recentErrors (errorTracker.snapshot()) | Yes — all 4 probe real infrastructure | FLOWING |
| `apps/api/src/routes/health-detailed.ts` | `data.workers` | `readHeartbeats(redis)` → Redis SCAN worker:heartbeat:* | Yes — reads real Redis keys published by worker.ts heartbeat publisher | FLOWING |

### Behavioral Spot-Checks

SKIPPED — behavioral spot-checks require a running API server with Redis and PostgreSQL. All code-level verification confirms the logic is substantive and wired. The human verification items below cover the key behavioral assertions that require a live environment.

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| OPS-01 | 22-01, 22-03 | bull-board at /admin/bull-board, RBAC owner-only, readOnly default, admin-origin CSP, static-asset gating | SATISFIED | bull-board.ts confirmed; requireRole on every request including static assets; BULL_BOARD_READ_ONLY env var; CSP frame-ancestors via onRequest; 9 integration tests. |
| OPS-02 | 22-06, 22-03 | Admin sidebar "Job Monitor" + same-origin iframe sharing better-auth session cookie | SATISFIED (human test pending) | jobs.tsx + nav entry + router + vite proxy all confirmed. Session cookie sharing requires browser test (human item 1). |
| OPS-03 | 22-05, 22-06 | /health/detailed endpoint + admin dashboard page (queue depth, worker heartbeat, DB lag, recent errors, per-module status) | SATISFIED | health-detailed.ts + index.ts mount + health.tsx rewrite all confirmed. 10 integration tests pass. |
| OPS-04 | 22-01, 22-02, 22-05 | HealthContributor slot + central aggregator rolls up all contributions | SATISFIED | Types, HealthAggregator class, registry def.health collector, 4 built-in contributors all confirmed. D-16 default for modules without a contributor is intentional (documented deferred item, not a gap). |
| EXT-02 | 22-04 | Workers publish heartbeat keys to Redis on configurable interval; real state feeds health dashboard | SATISFIED | heartbeat.ts confirmed; worker.ts wired; SCAN-not-KEYS enforced; TTL = 2×interval; DEL on graceful shutdown; 4+16 unit/integration tests. |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `apps/admin/src/routes/system/health.tsx` line ~198 | Hardcoded "Uptime" English string | Warning | Minor UI-SPEC deviation; documented in 22-06-SUMMARY.md for v1.4 i18n cleanup. Does not affect functionality. |
| `apps/admin/src/routes/system/health.tsx` line ~379 | Hardcoded "Loaded"/"Not loaded" English strings | Warning | Same as above. v1.4 cleanup. |

No blockers found. Both anti-patterns are warnings only, documented by the executor, and deferred to v1.4.

### Human Verification Required

All automated checks passed. The following items require a live environment and browser.

#### 1. Iframe Session Cookie Sharing (OPS-02)

**Test:** Run `bun run dev` from repo root. Log in as owner. Navigate to `/jobs`.
**Expected:** Bull-board renders inside the iframe without a second login prompt. The better-auth session cookie is forwarded by the Vite proxy with `changeOrigin: true`.
**Why human:** Browser cookie forwarding through a reverse proxy is not verifiable with file-level checks; the Vite proxy config and iframe sandbox attributes are correct in code but cookie behavior depends on browser security context at runtime.

#### 2. CSP frame-ancestors Browser Enforcement (OPS-01)

**Test:** Create a local HTML file at a different origin (e.g., `file://`) containing `<iframe src="http://localhost:3000/admin/bull-board">`. Open in browser.
**Expected:** Browser console shows a CSP `frame-ancestors` violation. Iframe is blank.
**Why human:** Integration tests confirm the `content-security-policy` header is set to `frame-ancestors '${ADMIN_URL}'` (or `'none'` fallback). Browser enforcement is the remaining check that cannot be done programmatically.

#### 3. Worker Heartbeat Dead Status After SIGKILL (EXT-02)

**Test:** Start the worker (`bun run worker`). Wait 30s to confirm heartbeat is publishing. Run `pkill -9 -f bun.*worker`. Wait 80s (5× the default 15s interval). `curl -H "Authorization: Bearer $OWNER_TOKEN" http://localhost:3000/health/detailed | jq '.data.workers'`.
**Expected:** Worker entry shows `status: "dead"` after TTL expiry. No `stale` intermediate state visible at 80s.
**Why human:** Requires process kill and 80s TTL wait — too slow for CI. The heartbeat.ts stop() logic (DEL key on graceful shutdown) is code-verified; only the SIGKILL → TTL expiry → dead path is untestable without running the worker.

#### 4. pt-BR Locale Rendering (OPS-02, OPS-03)

**Test:** Switch the admin app locale to pt-BR (if locale switching is supported in the admin UI). Navigate to `/jobs` and `/system`.
**Expected:** Sidebar shows "Monitor de Jobs". System health page shows localized status badges (Saudável/Degradado/Instável as applicable).
**Why human:** Visual locale validation. i18n keys in pt-BR/admin.json are confirmed correct in code; rendering requires browser.

---

_Verified: 2026-04-27T19:30:00Z_
_Verifier: Claude (gsd-verifier)_
