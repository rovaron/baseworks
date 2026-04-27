# Phase 22: Admin Ops Tooling - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 22-CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-27
**Phase:** 22-admin-ops-tooling
**Mode:** discuss --auto (recommended option auto-selected for each gray area; no interactive Q&A)
**Areas discussed:** bull-board mounting / RBAC, admin iframe integration, /health/detailed contract, HealthContributor registration, Worker heartbeat, Recent errors source, Per-module status

---

## bull-board mounting / RBAC

| Option | Description | Selected |
|--------|-------------|----------|
| Mount under `/api/admin/bull-board` (inside API admin prefix) | Reuses existing prefix; CORS / tenant middleware applies to static assets too — wasteful, confusing | |
| **Mount at top-level `/admin/bull-board` separately, requireRole("owner") wrapping the whole plugin (D-01, D-03)** | Static assets / WebSocket polling stay outside JSON-API middleware; requireRole derives on every sub-route including assets | ✓ |
| Custom Elysia plugin re-implementing bull-board's UI | Massive scope creep; rejected by PROJECT.md "Out of Scope" | |

**Auto-selected:** top-level mount with requireRole wrapping whole plugin (recommended). Closes success-criterion clause "static asset requests are also gated."

---

## Read-only mode default

| Option | Description | Selected |
|--------|-------------|----------|
| **`BULL_BOARD_READ_ONLY` env, default `"true"`, validated by @t3-oss/env-core (D-02)** | Crash-hard on typo (matches Phase 17 D-09); operators flip per deployment | ✓ |
| Hardcoded read-only with no env override | Forks needing retry/promote can't toggle without source edits | |
| Default `"false"` (writable) | Violates the requirement language "read-only mode enabled by default" | |

**Auto-selected:** env-validated default `"true"` (recommended).

---

## CSP / iframe protection

| Option | Description | Selected |
|--------|-------------|----------|
| `X-Frame-Options: SAMEORIGIN` | Legacy header; doesn't support multiple allowed origins; admin runs on different origin | |
| **CSP `frame-ancestors '${ADMIN_URL}'` (D-04); fallback to `'none'` if ADMIN_URL unset** | Modern, multi-origin support, browser-enforced | ✓ |
| No CSP / X-Frame headers | Phishing iframe risk | |

**Auto-selected:** CSP frame-ancestors.

---

## Admin iframe integration

| Option | Description | Selected |
|--------|-------------|----------|
| **Same-origin reverse-proxy (Vite dev `server.proxy`, Docker reverse-proxy in prod) so `${ADMIN_URL}/admin/bull-board` is served by API; cookie shared automatically (D-05)** | No CORS, no token; simplest mental model | ✓ |
| Cross-origin iframe with `credentials: 'include'` + CORS allow | Cookie attribution gets tricky with `SameSite=Lax`; more brittle | |
| Full-page redirect (no iframe, click → leaves admin SPA) | Loses the "without leaving the app" requirement | |

**Auto-selected:** same-origin reverse-proxy.

---

## Sidebar entry placement + icon

| Option | Description | Selected |
|--------|-------------|----------|
| **`{ titleKey: "nav.jobs", icon: ListTodo, href: "/jobs" }` between System and user dropdown (D-06)** | Reuses existing navItems pattern; `ListTodo` icon is on-theme | ✓ |
| Separate top-level "Operations" group | Premature category split (only one ops route); refactor when more land | |
| Inline within System dashboard | Fights the requirement "sees a sidebar entry" | |

**Auto-selected:** new sidebar entry "Job Monitor".

---

## /health/detailed contract

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse existing `/api/admin/system/health` (extend in place) | Couples admin-prefix middleware to a Docker-probe-shaped endpoint; muddles concerns | |
| **New `GET /health/detailed` at API root, requireRole("owner"), `{data: {...}}` envelope; existing route becomes deprecated alias (D-07, D-08)** | Clean separation: `/health` = unauthenticated Docker probe, `/health/detailed` = RBAC ops view | ✓ |
| Skip the endpoint, expose only via WebSocket | Overkill; polling is fine at 30s refetch interval | |

**Auto-selected:** new endpoint at API root.

---

## Queue depth thresholds

| Option | Description | Selected |
|--------|-------------|----------|
| **Hardcode warn=100 / critical=1000 (D-09; matches existing UI thresholds)** | Stable UI semantics; no env sprawl | ✓ |
| Env-tunable globals | Adds two env vars without clear demand | |
| Per-queue config file | Premature flexibility; defer to v1.4 if real queues differ | |

**Auto-selected:** hardcoded defaults.

---

## HealthContributor shape + registration

| Option | Description | Selected |
|--------|-------------|----------|
| **Optional `health?: HealthContributor` slot on `ModuleDefinition` (D-10); aggregator collects in `loadAll()`** | Mirrors existing `commands` / `queries` / `jobs` declarations; minimal surface | ✓ |
| Decorator-based registration `@HealthCheck` | Non-idiomatic in this codebase (no decorators used elsewhere) | |
| Imperative `registry.registerHealthContributor(...)` call | Forces module entry-point side effects; harder to type | |

**Auto-selected:** declarative slot.

---

## Aggregator timeout + caching

| Option | Description | Selected |
|--------|-------------|----------|
| **Parallel `Promise.allSettled` with 2s per-contributor timeout, 5s in-memory cache (D-11)** | Survives a slow contributor; prevents poll storms | ✓ |
| Sequential checks | Can blow the 3s overall budget if any contributor is slow | |
| No timeout | One bad check stalls `/health/detailed` | |

**Auto-selected:** parallel + per-check timeout + cache.

---

## Worker heartbeat key shape

| Option | Description | Selected |
|--------|-------------|----------|
| **`worker:heartbeat:{instanceId}` SET with EX TTL = 2× interval; SCAN to enumerate (D-12)** | Production-safe enumeration; missed beat shows as `stale` for one window | ✓ |
| Sorted set with timestamp scores | More complex; needs trim job; doesn't add ops value at this scale | |
| Redis Streams | Massive overkill | |

**Auto-selected:** SET-with-TTL + SCAN.

---

## Heartbeat interval

| Option | Description | Selected |
|--------|-------------|----------|
| **15s default, env `WORKER_HEARTBEAT_INTERVAL_MS` (z.coerce.number, min 1000, max 300000) (D-13)** | Reasonable detection latency; tunable for fork users | ✓ |
| Hardcoded 30s | Too slow to detect a dead worker for an admin UI showing real-time | |
| Hardcoded 5s | Excessive Redis writes for the value delivered | |

**Auto-selected:** 15s tunable.

---

## Recent errors source

| Option | Description | Selected |
|--------|-------------|----------|
| **In-memory ringbuffer wrapping `getErrorTracker()` (D-15) — works regardless of ERROR_TRACKER backend; capacity 50, dedup by message+frame** | No external auth burden; small memory; all-backends compatible | ✓ |
| Sentry API query in admin app | Requires read token + rotation handling; only works on Sentry SaaS | |
| Pino-sink JSON-tail file watcher | Filesystem-coupled; fragile under containers | |

**Auto-selected:** in-memory ringbuffer.

---

## Per-module status default

| Option | Description | Selected |
|--------|-------------|----------|
| **`loaded ? "healthy" : "unhealthy"` when no HealthContributor declared (D-16)** | "Loaded successfully" is real signal; doesn't punish minimal modules | ✓ |
| Always `"unknown"` when no contributor | Obscures real load failures | |
| Force every module to declare a contributor | Unnecessary boilerplate; v1.3 ships only auth/billing/example with no meaningful checks ready | |

**Auto-selected:** loaded → healthy default.

---

## Claude's Discretion

The following were left to executor judgment without auto-selecting from a structured option set:

- Exact icon for "Job Monitor" sidebar entry (recommended `ListTodo` from lucide).
- Iframe loading skeleton / error UI for `/jobs` route (reuse `apps/admin/src/routes/system/health.tsx` patterns).
- Additional CSP headers beyond `frame-ancestors`.
- Whether `/health/detailed` includes a process `version` field (recommended yes, read from `package.json`).
- Whether contributor `check()` runs inside an OTEL span (recommended yes, uses Phase 17/19 wrappers).

## Deferred Ideas

See `22-CONTEXT.md` `<deferred>` section. Highlights:

- Per-queue threshold overrides → v1.4
- Native bull-board UI rebuild → explicitly Out of Scope (PROJECT.md)
- Sentry-sourced recent errors → only if ringbuffer proves insufficient
- Tenant-scoped admin job views → v1.4+
- Cross-replica error aggregation → requires Redis pub/sub layer; deferred
- HealthContributor implementations for auth/billing/example modules → follow-up phase
- Module version reporting in /health/detailed → tied to Phase 23 doc needs
