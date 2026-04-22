---
phase: 17-observability-ports-otel-bootstrap
plan: 04
subsystem: apps/api
tags: [observability, otel, bootstrap, bun, smoke-test, instrumentation-matrix, node-sdk]

# Dependency graph
requires:
  - phase: 17-observability-ports-otel-bootstrap
    plan: 01
    provides: Noop Tracer/Metrics/ErrorTracker port types + adapters (resolve transitively via @baseworks/observability workspace dep)
  - phase: 17-observability-ports-otel-bootstrap
    plan: 02
    provides: getTracer/getMetrics/getErrorTracker factories (available but not invoked by telemetry.ts — D-06 keeps the import graph minimal during bootstrap)
  - phase: 17-observability-ports-otel-bootstrap
    plan: 03
    provides: validateObservabilityEnv() + z.enum(["noop"]) schema on TRACER/METRICS_PROVIDER/ERROR_TRACKER — telemetry.ts awaits this dynamically after sdk.start()
provides:
  - apps/api/src/telemetry.ts — Bun-safe NodeSDK bootstrap, role-branched instrumentation matrix, otel-selftest span, instrumentations-loaded log line, SIGTERM/SIGINT shutdown
  - apps/api/__tests__/telemetry-boot.test.ts — 4-subtest subprocess smoke test (api role, worker role, noop egress, unknown-adapter rejection)
  - apps/api/__tests__/telemetry-instrumentations.test.ts — 5-test in-process bidirectional probe on the instrumentation matrix
  - 5 OTEL workspace deps (@opentelemetry/api, sdk-node, auto-instrumentations-node, resources, semantic-conventions) in both packages/observability and apps/api
affects: [17-05-entrypoint-wiring, 18-error-tracking, 20-bullmq-propagation, 21-otel-exporters]

# Tech tracking
tech-stack:
  added:
    - "@opentelemetry/api@^1.9.1"
    - "@opentelemetry/sdk-node@^0.215.0"
    - "@opentelemetry/auto-instrumentations-node@^0.73.0"
    - "@opentelemetry/resources@^2.7.0"
    - "@opentelemetry/semantic-conventions@^1.40.0"
  patterns:
    - "Bun-safe NodeSDK bootstrap with line-1 side-effect import — no NODE_OPTIONS=--require reliance"
    - "Top-level await import('@baseworks/config') AFTER sdk.start() — keeps the import graph minimal pre-instrumentation (D-06 strict / Issue 3) while still crashing synchronously on Zod failure before the acceptance log reaches stdout"
    - "NodeSDK constructed with no exporter property — zero outbound traffic by construction (Issue 7 / T-17-03)"
    - "Role branching via process.env.INSTANCE_ROLE read inline, strict union 'api' | 'worker' (Issue 5 Option A) — no dependency on @baseworks/config for role detection during boot"
    - "Subprocess smoke test via Bun.spawn — exercises line-1 ordering end-to-end, catches instrumentation-attach regressions that package-level unit tests miss"
    - "Bidirectional instrumentation probe: positive on enabled (http/ioredis/pino), negative on disabled (fs/dns/net) — drift detection in place"

key-files:
  created:
    - apps/api/src/telemetry.ts
    - apps/api/__tests__/telemetry-boot.test.ts
    - apps/api/__tests__/telemetry-instrumentations.test.ts
  modified:
    - packages/observability/package.json
    - apps/api/package.json
    - bun.lock

key-decisions:
  - "D-04 honored: single shared telemetry.ts parameterized by INSTANCE_ROLE; api role enables HTTP instr + service.name=baseworks-api, worker role disables HTTP + service.name=baseworks-worker"
  - "D-05 honored: otel-selftest span end-to-end; attributes hard-coded to {ok, role, service.name} — no PII (T-17-05)"
  - "D-06 strict (Issue 3): no 'from \"@baseworks/config\"' static import in telemetry.ts; top-level 'await import(\"@baseworks/config\")' runs AFTER sdk.start() and BEFORE the 'otel-selftest: ok' log — a Zod failure crashes the process before any acceptance string reaches stdout"
  - "Issue 5 Option A: INSTANCE_ROLE union strictly 'api' | 'worker'; unset defaults to 'api'. No third 'all' value in telemetry.ts."
  - "Issue 7 (strict): NodeSDK constructor has NO exporter property anywhere in the file (not in code, not in comments). 'grep -c traceExporter apps/api/src/telemetry.ts' returns 0."
  - "D-10 + Issue 4 honored: smoke test has 4 sub-tests in a single file — api role, worker role, noop egress (T-17-03), and unknown-adapter rejection (T-17-01 end-to-end)"
  - "D-11 honored: in-process probe asserts HTTP (api-only), ioredis, pino are registered AND fs, dns, net are not. Matrix mirrors telemetry.ts exactly."
  - "D-12 honored: @appsignal/opentelemetry-instrumentation-bullmq NOT installed (deferred to Phase 20); in-process probe explicitly asserts no 'bullmq' instrumentation name present"

patterns-established:
  - "Instrumentation matrix co-location: the six-key getNodeAutoInstrumentations({...}) config appears in two places (telemetry.ts, telemetry-instrumentations.test.ts) and both must change together — if they drift, the in-process probe fails"
  - "OTEL dep ownership: packages/observability owns the 5 OTEL workspace deps; apps/api mirrors them for direct resolution (Bun 1.3 isolated linker does not hoist transitive workspace deps to the consumer's node_modules)"
  - "Subprocess-test pattern for bootstrap files that cannot be import-tested: Bun.spawn with 5s kill timeout + stdout/stderr capture"

requirements-completed: [OBS-04]

# Metrics
duration: ~6min
completed: 2026-04-22
---

# Phase 17 Plan 04: OTEL Bootstrap + Smoke Tests Summary

**Bun-safe OTEL NodeSDK bootstrap at `apps/api/src/telemetry.ts` with role-branched instrumentation matrix, zero-outbound noop defaults (no exporter property per Issue 7), top-level dynamic @baseworks/config import after sdk.start() (D-06 strict / Issue 3), plus a 4-subtest subprocess smoke test (including T-17-01 unknown-adapter rejection) and a 5-test bidirectional instrumentation probe.**

## Performance

- **Duration:** ~6 minutes
- **Started:** 2026-04-22T03:21:17Z (approx)
- **Completed:** 2026-04-22T03:27:43Z
- **Tasks:** 4 (17-04-00 deps, 17-04-01 bootstrap, 17-04-02 subprocess test, 17-04-03 in-process probe)
- **Files created:** 3 (telemetry.ts, telemetry-boot.test.ts, telemetry-instrumentations.test.ts)
- **Files modified:** 3 (packages/observability/package.json, apps/api/package.json, bun.lock)
- **Commits:** 4

## Artifact Stats

| File | Lines | Size |
|------|-------|------|
| `apps/api/src/telemetry.ts` | 111 | 5018 bytes |
| `apps/api/__tests__/telemetry-boot.test.ts` | 107 | — |
| `apps/api/__tests__/telemetry-instrumentations.test.ts` | 83 | — |

## Instrumentation Matrix (verbatim from telemetry.ts)

```typescript
const instrumentations = getNodeAutoInstrumentations({
  "@opentelemetry/instrumentation-http":    { enabled: isApiFlavour },
  "@opentelemetry/instrumentation-ioredis": { enabled: true },
  "@opentelemetry/instrumentation-pino":    { enabled: true },
  "@opentelemetry/instrumentation-fs":      { enabled: false },
  "@opentelemetry/instrumentation-dns":     { enabled: false },
  "@opentelemetry/instrumentation-net":     { enabled: false },
});
```

`isApiFlavour = role === "api"` → HTTP enabled for api role, disabled for worker role. `fs`/`dns`/`net` disabled for both to keep cardinality and noise low (Phase 17 only cares about pino + ioredis + role-dependent http).

## Subprocess Smoke Test Results (D-10)

| Sub-test | INSTANCE_ROLE | Extra env | Expected exit | Actual | Status |
|----------|---------------|-----------|---------------|--------|--------|
| api role | `api` | — | 0 | 0 | ✅ |
| worker role | `worker` | — | 0 | 0 | ✅ |
| noop egress (T-17-03) | `api` | — | 0, stderr clean | 0, stderr clean | ✅ |
| unknown adapter rejection (T-17-01 / Issue 4) | `api` | `TRACER=otel` | non-zero, stderr contains TRACER+noop, stdout NOT contains selftest | non-zero, matches | ✅ |

**Full run:** `bun test apps/api/__tests__/telemetry-boot.test.ts` → `4 pass / 0 fail / 17 expect() calls / 4.06s`.

## Resolved `instrumentations-loaded:` Lines (Real Runs)

**API role** (http present, fs/dns/net absent — 37 members, HTTP at index 13):

```
instrumentations-loaded: @opentelemetry/instrumentation-amqplib,@opentelemetry/instrumentation-aws-lambda,@opentelemetry/instrumentation-aws-sdk,@opentelemetry/instrumentation-bunyan,@opentelemetry/instrumentation-cassandra-driver,@opentelemetry/instrumentation-connect,@opentelemetry/instrumentation-cucumber,@opentelemetry/instrumentation-dataloader,@opentelemetry/instrumentation-express,@opentelemetry/instrumentation-generic-pool,@opentelemetry/instrumentation-graphql,@opentelemetry/instrumentation-grpc,@opentelemetry/instrumentation-hapi,@opentelemetry/instrumentation-http,@opentelemetry/instrumentation-ioredis,@opentelemetry/instrumentation-kafkajs,@opentelemetry/instrumentation-knex,@opentelemetry/instrumentation-koa,@opentelemetry/instrumentation-lru-memoizer,@opentelemetry/instrumentation-memcached,@opentelemetry/instrumentation-mongodb,@opentelemetry/instrumentation-mongoose,@opentelemetry/instrumentation-mysql2,@opentelemetry/instrumentation-mysql,@opentelemetry/instrumentation-nestjs-core,@opentelemetry/instrumentation-openai,@opentelemetry/instrumentation-oracledb,@opentelemetry/instrumentation-pg,@opentelemetry/instrumentation-pino,@opentelemetry/instrumentation-redis,@opentelemetry/instrumentation-restify,@opentelemetry/instrumentation-router,@opentelemetry/instrumentation-runtime-node,@opentelemetry/instrumentation-socket.io,@opentelemetry/instrumentation-tedious,@opentelemetry/instrumentation-undici,@opentelemetry/instrumentation-winston
```

**Worker role** (http absent, ioredis + pino still present — 36 members):

```
instrumentations-loaded: @opentelemetry/instrumentation-amqplib,@opentelemetry/instrumentation-aws-lambda,@opentelemetry/instrumentation-aws-sdk,@opentelemetry/instrumentation-bunyan,@opentelemetry/instrumentation-cassandra-driver,@opentelemetry/instrumentation-connect,@opentelemetry/instrumentation-cucumber,@opentelemetry/instrumentation-dataloader,@opentelemetry/instrumentation-express,@opentelemetry/instrumentation-generic-pool,@opentelemetry/instrumentation-graphql,@opentelemetry/instrumentation-grpc,@opentelemetry/instrumentation-hapi,@opentelemetry/instrumentation-ioredis,@opentelemetry/instrumentation-kafkajs,@opentelemetry/instrumentation-knex,@opentelemetry/instrumentation-koa,@opentelemetry/instrumentation-lru-memoizer,@opentelemetry/instrumentation-memcached,@opentelemetry/instrumentation-mongodb,@opentelemetry/instrumentation-mongoose,@opentelemetry/instrumentation-mysql2,@opentelemetry/instrumentation-mysql,@opentelemetry/instrumentation-nestjs-core,@opentelemetry/instrumentation-openai,@opentelemetry/instrumentation-oracledb,@opentelemetry/instrumentation-pg,@opentelemetry/instrumentation-pino,@opentelemetry/instrumentation-redis,@opentelemetry/instrumentation-restify,@opentelemetry/instrumentation-router,@opentelemetry/instrumentation-runtime-node,@opentelemetry/instrumentation-socket.io,@opentelemetry/instrumentation-tedious,@opentelemetry/instrumentation-undici,@opentelemetry/instrumentation-winston
```

Note: `auto-instrumentations-node@0.73.0` ships a superset bundle; our config only toggles the 6 keys we care about (http, ioredis, pino, fs, dns, net). The other ~30 instrumentations default to enabled — they patch modules we don't have installed, so they're effectively no-ops, but the smoke-test assertion is specifically on http (absent in worker role) and ioredis/pino (present in both). The in-process probe (Task 17-04-03) asserts the matrix keys individually via `findByName` + `isEnabled`, so cardinality of other defaults is out of scope.

## Unknown-Adapter Stderr Excerpt (Issue 4 / T-17-01)

```
❌ Invalid environment variables: [
  {
    received: "otel",
    code: "invalid_enum_value",
    options: [ "noop" ],
    path: [ "TRACER" ],
    message: "Invalid enum value. Expected 'noop', received 'otel'",
  }
]
...
error: Invalid environment variables
      at <anonymous> (.../node_modules/.bun/@t3-oss+env-core@0.13.11.../index.js:32:13)
      at .../packages/config/src/env.ts:42:20
```

- `TRACER` (the offending key) appears in stderr ✅
- `noop` (the only allowed enum value in Phase 17) appears in stderr ✅
- `otel-selftest: ok` does NOT reach stdout — the crash happens during `await import("@baseworks/config")` BEFORE the selftest log ✅
- Exit code: non-zero ✅

T-17-01 closed end-to-end.

## OTEL Dep Versions (match 17-RESEARCH.md)

| Package | Pinned | RESEARCH.md verified |
|---------|--------|----------------------|
| @opentelemetry/api | ^1.9.1 | ^1.9.1 ✅ |
| @opentelemetry/sdk-node | ^0.215.0 | ^0.215.0 ✅ |
| @opentelemetry/auto-instrumentations-node | ^0.73.0 | ^0.73.0 ✅ |
| @opentelemetry/resources | ^2.7.0 | ^2.7.0 ✅ |
| @opentelemetry/semantic-conventions | ^1.40.0 | ^1.40.0 ✅ |

All 5 OTEL workspace deps land at the 2026-04-22 versions verified in 17-RESEARCH.md (NOT the older STACK.md pins — "Versions diverge" finding). Phase 18/20/21 deps (`@sentry/bun`, `@appsignal/opentelemetry-instrumentation-bullmq`, `@opentelemetry/exporter-trace-otlp-proto`) are explicitly NOT installed.

## Verification Results

```
$ bun test packages/observability apps/api/__tests__/telemetry-boot.test.ts \
    apps/api/__tests__/telemetry-instrumentations.test.ts \
    packages/config/src/__tests__/validate-observability-env.test.ts

53 pass / 0 fail / 114 expect() calls / 9 files / 4.80s
```

Breakdown:

| Test file | Tests | Runtime |
|-----------|-------|---------|
| `apps/api/__tests__/telemetry-boot.test.ts` | 4 | ~4.06s |
| `apps/api/__tests__/telemetry-instrumentations.test.ts` | 5 | ~0.59s |
| `packages/observability/**` | 41 | — |
| `packages/config/src/__tests__/validate-observability-env.test.ts` | 3 | — |

## Security / Threat Mitigation

| Threat | Mitigation | Evidence |
|--------|-----------|----------|
| T-17-01 (env-typo silent fallback) | `validateObservabilityEnv()` + Plan 03's `z.enum(["noop"])` + Issue-4 subprocess sub-test asserting `TRACER=otel` crashes non-zero with key name in stderr | `telemetry-boot.test.ts` sub-test 4 — green |
| T-17-02 (instrumentation drift) | Bidirectional in-process probe (5 tests) — positive on enabled, negative on disabled, explicit no-bullmq assertion | `telemetry-instrumentations.test.ts` — green |
| T-17-03 (egress on noop default) | NodeSDK constructed with NO exporter property anywhere in the file + subprocess test asserts stderr is clean of ECONNREFUSED/ENOTFOUND/localhost:4318/4317/OTLPTrace/OTLPMetric | `grep -c "traceExporter" apps/api/src/telemetry.ts` returns `0`; sub-test 3 green |
| T-17-05 (PII in self-test span) | Span attributes hard-coded to `{ok, role, "service.name": serviceName}` — no request data, no env values beyond INSTANCE_ROLE | telemetry.ts lines 74-78 |

T-17-04 (line-1 ordering) remains owned by Plan 05.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Add 5 OTEL deps to apps/api/package.json**

- **Found during:** Task 17-04-00 verification (`bun -e "import('@opentelemetry/sdk-node')"` from apps/api failed with `Cannot find module`)
- **Issue:** Plan Task 17-04-00 modifies only `packages/observability/package.json` based on RESEARCH.md's assumption that "OTEL SDK packages are pulled in transitively through that workspace dep so apps/api does not need to list them in its own package.json." This is incorrect under Bun 1.3's default isolated linker — transitive workspace deps are placed in `packages/observability/node_modules/@opentelemetry/*` but are NOT hoisted into `apps/api/node_modules` or the root `node_modules`. Because `apps/api/src/telemetry.ts` imports OTEL packages directly (not re-exported via `@baseworks/observability`), the imports fail to resolve when `bun run apps/api/src/telemetry.ts` executes.
- **Fix:** Added the same 5 OTEL packages to `apps/api/package.json` `dependencies`. Also added `@baseworks/observability: workspace:*` as a forward-compatible workspace dep (not imported yet; telemetry.ts keeps the D-06 minimal import graph — factory can be lifted in later phases).
- **Files modified:** `apps/api/package.json`
- **Commit:** `f44ce4f`
- **Impact on acceptance criteria:** `packages/observability/package.json` still contains all 5 OTEL deps (primary acceptance criterion unchanged). The mirror install on apps/api is additive — it does not remove any dep, does not introduce any Phase-18/20/21 dep, does not alter the noop-egress posture.

No other deviations. Instrumentation matrix, telemetry.ts body, both test files match plan verbatim.

## Known Stubs

None. All features fully wired.

## Plan 05 Handoff

> Plan 05 will wire `import "./telemetry";` as line 1 of `apps/api/src/index.ts` and `apps/api/src/worker.ts` — only after that wiring does the line-1 discipline gate (T-17-04) close.

telemetry.ts is self-contained, side-effect-only, and import-ordered correctly: validateObservabilityEnv() runs synchronously before any acceptance string reaches stdout. When Plan 05 prepends the side-effect import, subsequent `import …` lines in index.ts/worker.ts will be patched by the auto-instrumentations as they load, closing the end-to-end observability wiring for Phase 17.

## Self-Check: PASSED

**Created files verified present:**

- `apps/api/src/telemetry.ts` — FOUND (111 lines, 5018 bytes)
- `apps/api/__tests__/telemetry-boot.test.ts` — FOUND (107 lines)
- `apps/api/__tests__/telemetry-instrumentations.test.ts` — FOUND (83 lines)

**Commits verified in git log:**

- `f44ce4f` (chore 17-04: OTEL deps) — FOUND
- `ab7bf07` (feat 17-04: telemetry.ts bootstrap) — FOUND
- `52bf3ef` (test 17-04: subprocess smoke test) — FOUND
- `18da24f` (test 17-04: instrumentation probe) — FOUND

**Acceptance criteria verified:**

- `grep -c "traceExporter" apps/api/src/telemetry.ts` → 0 ✅ (Issue 7)
- `grep -c '"all"' apps/api/src/telemetry.ts` → 0 ✅ (Issue 5 Option A)
- `grep -cE "^\s*import\b.*from\s+\"@baseworks/config\"" apps/api/src/telemetry.ts` → 0 ✅ (D-06 strict)
- `grep -cE "await\s+import\(.?@baseworks/config.?\)"` → 2 (JSDoc reference + actual code) ✅ (Issue 3)
- `grep -cE "role\s*:\s*\"api\"\s*\|\s*\"worker\""` → 1 ✅ (Issue 5 role union type)
- Line ordering: sdk.start() (line 67) → await import (line 72) → console.log selftest (line 86) ✅ (Issue 3 ordering)
- 4/4 subprocess sub-tests pass, 5/5 in-process probe tests pass, 53/53 Phase-17 suite total ✅
