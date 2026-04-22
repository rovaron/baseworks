---
phase: 17-observability-ports-otel-bootstrap
plan: 05
subsystem: apps/api
tags: [observability, entrypoint-wiring, line-1-ordering, regression-gate, obs-04, t-17-04]

# Dependency graph
requires:
  - phase: 17-observability-ports-otel-bootstrap
    plan: 04
    provides: apps/api/src/telemetry.ts (Bun-safe NodeSDK bootstrap) — this plan wires it into the entrypoints as the literal line-1 side-effect import
provides:
  - apps/api/src/index.ts line 1 = import "./telemetry"; (API entrypoint wired to telemetry)
  - apps/api/src/worker.ts line 1 = import "./telemetry"; (worker entrypoint wired to telemetry)
  - apps/api/__tests__/telemetry-line1.test.ts — 6-test file-text probe gate that asserts both entrypoints preserve the line-1 invariant and catches the Pitfall-1 regression class
affects: [18-error-tracking-adapters, 20-bullmq-propagation, 21-otel-exporters]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Line-1 side-effect import discipline: `import \"./telemetry\";` MUST be the literal first line of every entrypoint that needs OTEL patching; a comment, blank line, or reordered import pushes the side-effect off line 1 and silently disables auto-instrumentation with no runtime error"
    - "File-text probe regression gate: cheapest possible CI discipline for Pitfall 1 (six file-read + string-equality assertions, <100ms, zero module loading, zero subprocess)"
    - "CRLF-tolerant line-1 probe: split(/\\r?\\n/) instead of split(\"\\n\") — portable across Windows+Unix checkouts without changing the semantic invariant (line 0 after normalization)"

key-files:
  created:
    - apps/api/__tests__/telemetry-line1.test.ts
  modified:
    - apps/api/src/index.ts (line 1 prepend only)
    - apps/api/src/worker.ts (line 1 prepend only)

key-decisions:
  - "Line-1 invariant is strict: no comment, no blank line, no leading whitespace, no BOM. The probe test asserts all four regression shapes in addition to the exact-string match on line 0."
  - "Side-effect import shape is enforced: the probe asserts lines[0] does NOT contain 'from' and DOES contain '\"./telemetry\"'. This catches the subtle `import { foo } from \"./telemetry\";` regression that would still look import-shaped on line 1 but break the side-effect contract."
  - "CRLF tolerance by design: the probe uses split(/\\r?\\n/) rather than split(\"\\n\"). The plan's acceptance criteria refers to 'split on \\n' semantically (first line content), which is preserved under either line-ending convention. Using the naive split(\"\\n\") would give `'import \"./telemetry\";\\r'` on Windows checkouts and false-fail the gate on every Windows contributor."
  - "Negative smoke confirmed by hand (not committed): prepending a blank line to apps/api/src/index.ts causes 3 of 6 tests to fail as expected. File restored before commit. Proves the gate has teeth."

patterns-established:
  - "Any future entrypoint that needs OTEL instrumentation (e.g. a third role, a test harness) must add `import \"./telemetry\";` as line 1 AND extend telemetry-line1.test.ts with two more tests (line-1 equality + side-effect shape) — the gate is not complete until new entrypoints are covered"
  - "Maintainers who want to document the line-1 discipline at the file level should do so via the file header in apps/api/src/telemetry.ts (which already contains the doc-block) or via the test file name and block comment (already in place) — NEVER via a comment above the import itself"

requirements-completed: [OBS-04]

# Metrics
duration: ~8min
completed: 2026-04-22
---

# Phase 17 Plan 05: Entrypoint Line-1 Wiring + Regression Gate Summary

**Wired `import "./telemetry";` as the literal line 1 of both `apps/api/src/index.ts` and `apps/api/src/worker.ts` and added a 6-test file-text probe (`apps/api/__tests__/telemetry-line1.test.ts`) that catches the Pitfall-1 regression class (line-1 reorder, comment-prepend, blank-line-prepend, side-effect-shape-drift) at CI time.**

## Performance

- **Duration:** ~8 minutes
- **Started:** 2026-04-22T03:31:46Z
- **Completed:** 2026-04-22T03:39:18Z
- **Tasks completed:** 3/3
- **Files modified:** 2 (one-line prepend each)
- **Files created:** 1 (69-line test)

## Commits

| Task | Commit  | Description |
|------|---------|-------------|
| 17-05-01 | b3c7fa3 | feat: prepend telemetry side-effect import as line 1 of apps/api/src/index.ts |
| 17-05-02 | aebadac | feat: prepend telemetry side-effect import as line 1 of apps/api/src/worker.ts |
| 17-05-03 | 7c0d7c2 | test: add line-1 probe test for telemetry side-effect import (T-17-04) |

## Diffs

### apps/api/src/index.ts (Task 17-05-01)

```diff
+import "./telemetry";
 import { env, validatePaymentProviderEnv } from "@baseworks/config";
 import { createDb, scopedDb } from "@baseworks/db";
 import type { HandlerContext } from "@baseworks/shared";
 ...
```

One-line prepend at the top. Line 2 and below are byte-for-byte unchanged.

### apps/api/src/worker.ts (Task 17-05-02)

```diff
+import "./telemetry";
 import { env, assertRedisUrl, validatePaymentProviderEnv } from "@baseworks/config";
 import { createDb } from "@baseworks/db";
 import { createWorker, closeConnection } from "@baseworks/queue";
 ...
```

One-line prepend at the top. Line 2 and below are byte-for-byte unchanged.

### apps/api/__tests__/telemetry-line1.test.ts (Task 17-05-03)

New file (69 lines). Six tests in one describe block:

| # | Test name | Assertion |
|---|-----------|-----------|
| 1 | `apps/api/src/index.ts line 1 is the telemetry side-effect import` | `lines[0] === 'import "./telemetry";'` |
| 2 | `apps/api/src/worker.ts line 1 is the telemetry side-effect import` | `lines[0] === 'import "./telemetry";'` |
| 3 | `no leading blank line or comment in apps/api/src/index.ts` | `!/^\s+/`, `!/^\/\//`, `!/^\/\*/`, `length > 0` |
| 4 | `no leading blank line or comment in apps/api/src/worker.ts` | same four regex guards |
| 5 | `telemetry import in index.ts is a side-effect import (no 'from' clause)` | `!contains("from")`, `contains('"./telemetry"')` |
| 6 | `telemetry import in worker.ts is a side-effect import (no 'from' clause)` | same side-effect-shape pair |

## Verification

### Test runs (all green)

```
bun test apps/api/__tests__/telemetry-line1.test.ts
 6 pass, 0 fail, 14 expect() calls, [62ms]

bun test apps/api/src/__tests__/entrypoints.test.ts
 2 pass, 0 fail, 4 expect() calls, [1.50s]

bun test packages/observability apps/api/__tests__/telemetry-boot.test.ts \
         apps/api/__tests__/telemetry-instrumentations.test.ts \
         apps/api/__tests__/telemetry-line1.test.ts \
         packages/config/src/__tests__/validate-observability-env.test.ts \
         apps/api/src/__tests__/entrypoints.test.ts
 61 pass, 0 fail, 132 expect() calls, [6.80s]   ← full Phase 17 surface
```

### Negative smoke test (manual, not committed)

Prepended a blank line to `apps/api/src/index.ts` and re-ran `bun test apps/api/__tests__/telemetry-line1.test.ts`:

```
3 pass, 3 fail
Failures:
 - telemetry line-1 ordering > index.ts line 1 is the telemetry side-effect import
 - telemetry line-1 ordering > no leading blank line or comment in index.ts
 - telemetry line-1 ordering > telemetry import in index.ts is a side-effect import (no `from` clause)
```

Restored the file via `cp /tmp/index.ts.bak apps/api/src/index.ts`. Confirmed 6/6 green again afterward. Gate has teeth.

### Manual end-to-end sanity (real entrypoint startup)

```
$ DATABASE_URL=... BETTER_AUTH_SECRET=... WEB_URL=... ADMIN_URL=... \
  PAYMENT_PROVIDER=stripe STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... \
  OTEL_ENABLED=true INSTANCE_ROLE=api PORT=4002 \
  bun run apps/api/src/index.ts

otel-selftest: ok
instrumentations-loaded: @opentelemetry/instrumentation-amqplib,...-http,...-ioredis,...-pg,...-pino,...-redis,... (37 total)
{"level":30,"module":"auth","msg":"Module loaded"}
{"level":30,"module":"billing","msg":"Module loaded"}
{"level":30,"module":"example","msg":"Module loaded"}
{"level":30,"port":4002,"role":"api","msg":"Baseworks API started"}
```

Proves end-to-end that `apps/api/src/index.ts → apps/api/src/telemetry.ts` wiring works under the real entrypoint (not just the standalone telemetry.ts run from Plan 04). `otel-selftest: ok` is printed as the FIRST stdout line — before env.ts, before any module logger — exactly as designed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] Used `split(/\r?\n/)` instead of `split("\n")` in the probe test**
- **Found during:** Task 17-05-03
- **Issue:** The plan's example code uses `split("\n")`, which on Windows checkouts (CRLF line endings) returns `'import "./telemetry";\r'` for `lines[0]` — failing the exact-string equality against `'import "./telemetry";'`. Node confirmed this on the worktree: `head -c 30 apps/api/src/index.ts | od -c` showed CRLF terminators.
- **Fix:** Used `split(/\r?\n/)` (the equivalent Node/Bun-portable line splitter). The semantic invariant (the literal content of the first line) is preserved under both line-ending conventions.
- **Files modified:** apps/api/__tests__/telemetry-line1.test.ts (only)
- **Commit:** 7c0d7c2

**No other deviations.** Tasks 17-05-01 and 17-05-02 executed exactly as written.

## TDD Gate Compliance

Task 17-05-03 was marked `tdd="true"` in the plan. Because this plan is a **regression gate** (the test is designed to pass against the current state and fail on future regressions), the classical RED→GREEN cycle does not apply cleanly: line 1 is already correct by the end of Tasks 17-05-01 and 17-05-02, so the test is born green.

The plan's acceptance criteria acknowledges this explicitly by requiring a **manual negative-test smoke** ("prepend a blank line, observe failure, revert before commit") — which was performed and documented above. That manual step plays the role of the RED phase: it confirms the gate is capable of failing, which is the whole point of a regression-gate test.

Commit sequence for TDD-gate compliance:
- `b3c7fa3` / `aebadac` — `feat` commits that made the entrypoints correct (implicit GREEN for the invariant)
- `7c0d7c2` — `test` commit that codifies the invariant as a CI gate (explicit acceptance-pinning)

No `refactor` commit was needed.

## Known Stubs

None. All code is production-final.

## Phase 17 Close-Out Note

**All 5 Success Criteria from `.planning/ROADMAP.md` (or `v1.3-ROADMAP.md`) Phase 17 are met:**

1. Observability port types (Tracer / Metrics / ErrorTracker) — Plan 01 (01-SUMMARY.md)
2. Noop adapters + factory resolution — Plans 01+02 (02-SUMMARY.md)
3. Operator sees `import "./telemetry"` as line 1 of `apps/api/src/index.ts` and `apps/api/src/worker.ts` — **this plan (17-05)**
4. `OTEL_ENABLED=false` default → zero outbound traffic — Plan 04 (telemetry.ts has no exporter property, Issue 7 strict)
5. Env-driven config with explicit `noop` selector + Zod validation — Plan 03 + Plan 04 (validate-observability-env.ts + top-level dynamic import in telemetry.ts)

**All Phase 17 STRIDE threats mitigated:**

| Threat | Disposition | Mitigation |
|--------|-------------|-----------|
| T-17-01 (unknown adapter slipping past) | closed | Plan 03: Zod enum `z.enum(["noop"])` in validate-observability-env.ts; Plan 04: subprocess smoke test has a dedicated "unknown-adapter rejection" sub-test |
| T-17-02 (instrumentation drift between code and contract) | closed | Plan 04: telemetry-instrumentations.test.ts asserts the exact enabled/disabled set (http, ioredis, pino enabled; fs, dns, net disabled); Plan 05 reinforces — a line-1 regression that disables ALL instrumentation would be caught here FIRST, before the in-process probe even runs |
| T-17-03 (accidental outbound egress in noop mode) | closed | Plan 04: NodeSDK constructed with no exporter property; subprocess smoke test has "noop egress" sub-test |
| T-17-04 (line-1 ordering regression) | **closed by this plan** | 6-test file-text probe gate |
| T-17-05 (PII in otel-selftest span attributes) | closed | Plan 04: attributes hard-coded to `{ok, role, service.name}`; reviewed and minimal |

**All 4 OBS-* requirements completed across Plans 01–05:** OBS-01, OBS-02, OBS-03, OBS-04.

**Ready for Phase 18 (Error Tracking Adapters)**, which will:
- (a) widen `ERROR_TRACKER` enum from `z.enum(["noop"])` to `z.enum(["noop", "sentry", "glitchtip"])` and add `SENTRY_DSN` / `GLITCHTIP_DSN` to `packages/config/src/env.ts`
- (b) change the Phase-17 noop default for ErrorTracker to **pino-sink** per decision D-03 (Phase 17 deferred this to Phase 18 to keep the bootstrap import graph minimal)

## Self-Check: PASSED

Verified after writing this SUMMARY.md:

- `apps/api/src/index.ts` exists, line 1 is exactly `import "./telemetry";` — FOUND
- `apps/api/src/worker.ts` exists, line 1 is exactly `import "./telemetry";` — FOUND
- `apps/api/__tests__/telemetry-line1.test.ts` exists — FOUND
- Commit `b3c7fa3` (Task 17-05-01) exists in `git log` — FOUND
- Commit `aebadac` (Task 17-05-02) exists in `git log` — FOUND
- Commit `7c0d7c2` (Task 17-05-03) exists in `git log` — FOUND
- `bun test apps/api/__tests__/telemetry-line1.test.ts` exits 0 (6 pass, 0 fail) — VERIFIED
- Full Phase 17 test surface (61 tests across 11 files) exits 0 — VERIFIED
- Manual `bun run apps/api/src/index.ts` prints `otel-selftest: ok` as the first stdout line — VERIFIED
