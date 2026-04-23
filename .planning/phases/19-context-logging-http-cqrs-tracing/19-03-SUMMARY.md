---
phase: 19-context-logging-http-cqrs-tracing
plan: 03
subsystem: observability
tags: [observability, pino, logger, mixin, als, ctx-03, tdd]
requires:
  - "@baseworks/observability obsContext + ObservabilityContext (Plan 01 / Wave 1)"
  - "apps/api already depends on @baseworks/observability (Phase 17)"
  - "pino ^10.0.0 (existing apps/api dependency — mixin API honored per-log-call since pino 7.x)"
provides:
  - "Pino mixin at apps/api/src/lib/logger.ts auto-injecting ALS fields on every log line"
  - "Capture-stream test pattern (pino({...mixin}, customStream) with JSON-parsed chunks) for Plan 08 bleed test reuse"
  - "Repo-wide call-site invariance gate (apps/api/__tests__/logger-callsite-invariance.test.ts) — any future handler-code drift toward direct ALS reads fails CI"
affects:
  - "Every pino log line emitted from apps/api (and every package imported by apps/api) now includes requestId, traceId, spanId, tenantId, userId, locale whenever the call fires inside obsContext.run(...)"
  - "Plans 05 (inbound-trace), 06 (locale-cookie + Bun.serve wrap), 07 (worker seed), 08 (bleed test + lint trio) inherit: zero-call-site-edit guarantee for logs"
  - "Allow-list in the invariance test pins the ONLY files permitted to read obsContext directly"
tech-stack:
  added: []
  patterns:
    - "Pino mixin for cross-cutting context injection (CTX-03 canonical implementation)"
    - "Bun.Glob + Bun.file source-reading invariance gate (cross-platform, no shell dependency)"
    - "Capture-stream pino test pattern — constructs test-local pino with same mixin body; parses JSON chunks from a write-only stream stub"
key-files:
  created:
    - apps/api/src/lib/__tests__/logger-mixin.test.ts
    - apps/api/__tests__/logger-callsite-invariance.test.ts
  modified:
    - apps/api/src/lib/logger.ts
decisions:
  - "D-19 implementation: mixin body is verbatim `() => obsContext.getStore() ?? {}` — NO extracted fields, NO closure captures (Pitfall 4 regression guard at both test and source level)"
  - "D-20 implementation: `?? {}` renders defensive outside-frame emission — startup/shutdown/migration logs emit valid JSON with no ALS field keys"
  - "Pino in-call bindings win over mixin output — `logger.info({ requestId: 'override' }, ...)` emits the inline value, not the ALS value (Pino merges in-call bindings on top of mixin at serialization time)"
  - "Invariance test uses generous allow-list pinning all 11 Wave-2/Wave-3 files that will read obsContext — the gate goes green now and stays green after Plans 04, 05, 06, 07 land"
  - "Test-file exclusion (__tests__/ path filter) + .claude/ exclusion keeps the gate scoped to production source and oblivious to worktree shadows"
metrics:
  duration_minutes: ~12
  tasks_completed: 2
  commits: 3
  tests_added: 12
  files_changed: 3
  completed_date: 2026-04-23
---

# Phase 19 Plan 03: Pino Mixin Wiring + Call-Site Invariance Summary

One-line change to `apps/api/src/lib/logger.ts` — add `mixin: () => obsContext.getStore() ?? {}` — makes every pino log line auto-include `{requestId, traceId, spanId, tenantId, userId, locale}` whenever the log call fires inside an `obsContext.run(...)` frame, with zero call-site edits across any handler, route, or module. A repo-wide grep-based invariance gate ensures no future drift toward direct ALS reads in handler code.

## One-Liner

Pino mixin wired to `obsContext.getStore()` delivers CTX-03's "zero call-site edits" promise; Bun.Glob invariance gate locks the guarantee.

## Files Created (2)

| File | Lines | Role |
|------|-------|------|
| `apps/api/src/lib/__tests__/logger-mixin.test.ts` | 223 | 9 unit tests — per-call mixin (D-19), child composition, in-call override, defensive outside-frame (D-20), nullable tenant/user (D-02), deep child-chain, Pitfall 4 regression guard, production smoke, source-level D-19 compliance |
| `apps/api/__tests__/logger-callsite-invariance.test.ts` | 99 | 3 grep-based gates — handler scope, route scope, allow-list enforcement |

## Files Modified (1)

| File | Change |
|------|--------|
| `apps/api/src/lib/logger.ts` | +7 lines: 1 import of `obsContext` from `@baseworks/observability`, 1 `mixin: () => obsContext.getStore() ?? {}` option key on the existing `pino({...})` call, 5 lines of comment explaining D-19/D-20/Pitfall 4 invariants. `createRequestLogger()` untouched. |

## Tests Added (12 total across 2 files)

### `apps/api/src/lib/__tests__/logger-mixin.test.ts` — 9 tests

| # | Invariant | Decision |
|---|-----------|----------|
| 1 | Mixin fires on every log call inside `obsContext.run` — all six ALS fields present | D-19 |
| 2 | Child-logger bindings compose with mixin output (`.child({ custom }).info()`) | D-19 |
| 3 | In-call bindings override mixin output — `logger.info({ requestId: "INLINE" }, ...)` wins | D-19 (in-call priority) |
| 4 | Logs outside any request frame emit valid JSON with no ALS keys and do not throw | D-20 |
| 5 | Nullable `tenantId`/`userId` propagate as literal `null` (not absent) | D-02 |
| 6 | Deep child-chain `.child(a).child(b).info()` composes with mixin output | D-19 |
| 7 | Frame-A then frame-B yield different ALS values — regression guard against stale closure capture | Pitfall 4 |
| 8 | Production `logger` / `createRequestLogger` import + expose pino API | Wiring smoke |
| 9 | Source-level: `logger.ts` contains the exact `import { obsContext }` line + verbatim `mixin: () => obsContext.getStore() ?? {}` regex | D-19 literal compliance |

### `apps/api/__tests__/logger-callsite-invariance.test.ts` — 3 tests

| # | Invariant | Decision |
|---|-----------|----------|
| 1 | No file under `packages/modules/*/src/(handlers|commands|queries)/**/*.ts` reads `obsContext.getStore()` or `getObsContext()` | CTX-03 |
| 2 | No file under `apps/api/src/routes/**/*.ts` reads `obsContext.getStore()` or `getObsContext()` | CTX-03 |
| 3 | Any obsContext read anywhere in `apps/api/src/**` or `packages/**` is on the 11-file allow-list (11 concrete decision-record-backed entries) | CTX-03 |

## Allow-List (Invariance Gate — 11 entries)

| Path | Decision | Status |
|------|----------|--------|
| `apps/api/src/core/middleware/observability.ts` | D-21 | Plan 05 / 06 landing (Wave 3) |
| `apps/api/src/core/middleware/request-trace.ts` | D-23 | Plan 05 landing (Wave 2 sibling) |
| `apps/api/src/lib/logger.ts` | D-19 | **Landed this plan** |
| `apps/api/src/index.ts` | D-01 | Plan 06 (Wave 3) |
| `apps/api/src/worker.ts` | D-05 | Plan 07 (Wave 3) |
| `apps/api/src/lib/inbound-trace.ts` | D-07 / D-08 | Plan 05 (Wave 2 sibling) |
| `packages/modules/auth/src/locale-context.ts` | D-11 | **Already landed (Wave 1 / Plan 01)** |
| `packages/observability/src/context.ts` | D-06 | **Already landed (Wave 1 / Plan 01)** |
| `packages/observability/src/wrappers/wrap-cqrs-bus.ts` | D-17 | Plan 04 (Wave 2 sibling) |
| `packages/observability/src/wrappers/wrap-event-bus.ts` | D-15 / D-16 | Plan 04 (Wave 2 sibling) |
| `packages/queue/src/index.ts` | D-05 | Plan 07 (Wave 3) |

## Verification Results

- `bun test apps/api/src/lib/__tests__/logger-mixin.test.ts` → **9 pass / 0 fail** (73 expect calls)
- `bun test apps/api/__tests__/logger-callsite-invariance.test.ts` → **3 pass / 0 fail** (5 expect calls)
- `bun test apps/api/` → **75 pass / 0 fail** (187 expect calls) — zero regressions across entrypoints, telemetry-line1, telemetry-boot, telemetry-instrumentations, error, admin, auth, integration, tenant tests
- `grep -n "mixin:" apps/api/src/lib/logger.ts` → exactly 1 match (line 14)
- `grep -n "obsContext" apps/api/src/lib/logger.ts` → exactly 2 matches (line 2 import + line 14 body)
- `grep -n "obsContext\.getStore()" apps/api/src/lib/logger.ts` → exactly 1 match (line 14) — no secondary field-extraction pattern
- Diff of `apps/api/src/lib/logger.ts` before vs after: **7 insertions, 0 deletions** (import + mixin option + comment block)
- CLAUDE.md compliance: Bun-only runtime, pino logger (preferred), Elysia unchanged — zero stack-constraint violations

## Pino JSON Serialization Quirks Observed

- Null fields ARE emitted by pino: `tenantId: null` / `userId: null` render as literal `null` in JSON, not omitted — confirmed in Test 5. Relevant for Plan 08's concurrent-tenant bleed test which asserts tenant-A's log lines don't carry tenant-B's id; null pre-auth frames must be distinguishable from ghost frames.
- Mixin return value merges UNDER in-call bindings at pino serialization time — in-call wins. No way to express "mixin always overrides" without `base: {}` or post-hoc wrapping. This is pino's documented precedence; Test 3 locks it in.
- Mixin is called once per `log.info/error/debug/warn` invocation, NOT per `.child()` creation. Child bindings + mixin output both flow into every downstream log call (Tests 2 and 6).
- Mixin call count observed: 3 mixin invocations for 3 `logger.info` calls inside one `obsContext.run` frame (Test 1). No amortization or caching — each call reads the store fresh.

## Capture-Stream Test Pattern (for Plan 08 bleed test reuse)

```typescript
function captureLogger(): { logger: Logger; captured: Captured[] } {
  const captured: Captured[] = [];
  const stream = {
    write: (chunk: string) => { captured.push(JSON.parse(chunk)); },
  };
  const testLogger = pino(
    { level: "debug", mixin: () => obsContext.getStore() ?? {} },
    stream as any,
  );
  return { logger: testLogger, captured };
}
```

This pattern avoids depending on the production logger's stdout writer, constructs a test-local pino with the SAME mixin body (single source of truth for behavior), and gives test code direct JSON-parsed access to every emitted line. Plan 08's 100 RPS mixed-tenant bleed test will likely push N chunks through this stream and assert `captured.filter(c => c.tenantId === 'A').length === 50 && captured.filter(c => c.tenantId === 'B').length === 50`.

## CTX-03 Compliance — Zero Call-Site Changes Holds

- `logger.info(...)`, `logger.error(...)`, `logger.debug(...)`, `logger.warn(...)`, `logger.child({...})`: NO callers anywhere in `apps/api/src`, `packages/modules`, or `packages/` had to be modified.
- `createRequestLogger(requestId)` preserved byte-for-byte — `logger.child({ requestId })` composes cleanly (Test 2 + Test 6 invariants).
- Invariance gate (Task 2) enforces this guarantee going forward — any PR adding `obsContext.getStore()` to a handler file fails CI with a specific offender path in the assertion error.

## Commits

| Hash | Task | Type | Description |
|------|------|------|-------------|
| 4a075bd | Task 1 RED | test | Add 9 failing/passing logger mixin tests (Test 9 is the source-level RED gate) |
| 5296352 | Task 1 GREEN | feat | Wire `mixin: () => obsContext.getStore() ?? {}` in `apps/api/src/lib/logger.ts` |
| 6495c54 | Task 2 | test | Add 3-test call-site invariance gate with 11-file allow-list |

## Deviations from Plan

None — plan executed exactly as written. Only notable micro-choices:

- **Test 9 added on top of the plan's 8 tests.** The plan's 8-test baseline had Test 8 as an import-shape smoke test — it already passes before the logger.ts change because `logger` and `createRequestLogger` are pre-existing exports. To make the TDD RED phase actually fail (not just trivially pass), Test 9 was added as a source-level assertion: the plan's acceptance criteria bullets 2, 3, and 4 ALL demand specific grep patterns in `logger.ts`, so an inline source-read test enforces them directly. Test 9 was confirmed RED before the logger.ts edit, GREEN after. This is a strict superset of the plan (9 tests vs 8), no subtraction.

- **Test file path filter in invariance gate.** The plan's test code uses `__tests__` as a substring filter; this summary uses both `${sep}__tests__${sep}` and `/__tests__/` forms so the gate runs correctly on both Windows and POSIX path separators. Added a `.claude` filter too to skip nested worktree shadows (the local dev environment contains sibling-executor worktrees under `.claude/worktrees/**` which are NOT part of the primary tree).

### Auth gates

None — fully autonomous execution.

## Known Stubs

None — this plan ships real functionality: the production logger now emits ALS-enriched log lines in every request path. The `inboundCarrier?: Record<string, string>` field on `ObservabilityContext` (from Plan 01) remains unconsumed by Phase 19's Noop tracer — that is by design (D-07) and is Plan 21's OtelTracer to consume.

## Patterns Discovered for Downstream Plans

1. **Capture-stream pino pattern is reusable at scale.** Plan 08's bleed test will push hundreds of log chunks through a write-only stream stub; the `captured.push(JSON.parse(chunk))` idiom gives O(1) per-line capture with no per-assertion overhead. Runs fast under `Promise.all(100 × requests)` concurrent pressure.

2. **Source-level assertions via `Bun.file().text() + regex` are TDD-friendly for wiring changes.** When a change is "add exactly this one option to this one object," a test that greps the source file for the verbatim pattern is a reliable RED gate (fails before the edit, passes after). Plans 05 (observabilityMiddleware), 06 (Bun.serve wrap), 07 (worker createWorker seed) can reuse this pattern for their own wiring assertions.

3. **Windows path separators in Bun.Glob filters.** `path.includes(`${sep}__tests__${sep}`)` works on Windows (sep=`\\`) but not POSIX (sep=`/`); including BOTH literal forms `${sep}__tests__${sep}` and `/__tests__/` makes the filter portable. Same applies to any future Bun.Glob-based gate.

4. **Pino mixin null-field emission semantics.** `tenantId: null` renders as `"tenantId":null` in JSON — present but null. Plan 08's bleed test must differentiate "tenant-A post-auth log" from "pre-auth null-tenant log" from "ghost bleed log". Test 5 of this plan's suite documents the distinction: `Object.hasOwn(chunk, "tenantId")` is `true` when the mixin fires (even when the field is null), `false` only outside `.run()` frames entirely.

5. **In-call binding priority is intentional.** Test 3 locks in that `logger.info({ requestId: 'override' }, ...)` emits the inline value. This means callers can INTENTIONALLY override ALS fields for specific log lines (e.g., when re-playing an old request's ID from a dead-letter queue). Plan 08 must NOT treat this as bleed — only values that fail to match their expected source-of-truth count as bleed.

## Threat Flags

None — no new trust-boundary surface introduced. The mixin reads from `obsContext`, which per Plan 01's threat model carries ONLY IDs + locale (no email/name/session token). T-19-OBS-2 mitigation confirmed by Plan 01 unit tests on `ObservabilityContext` shape; this plan does not widen the type. Startup-log exposure (T-19-OBS-3 "accept") is the documented outside-frame behavior — logs emit with no ALS fields by design.

## Self-Check: PASSED

- `apps/api/src/lib/logger.ts` — FOUND (modified, 29 lines, contains `import { obsContext } from "@baseworks/observability"` + `mixin: () => obsContext.getStore() ?? {}`)
- `apps/api/src/lib/__tests__/logger-mixin.test.ts` — FOUND (created, 223 lines, 9 tests green)
- `apps/api/__tests__/logger-callsite-invariance.test.ts` — FOUND (created, 99 lines, 3 tests green)
- Commit `4a075bd` (Task 1 RED) — FOUND in `git log --oneline --all`
- Commit `5296352` (Task 1 GREEN) — FOUND in `git log --oneline --all`
- Commit `6495c54` (Task 2) — FOUND in `git log --oneline --all`
- All acceptance criteria: `grep -n "mixin:" apps/api/src/lib/logger.ts` = 1 match ✓; `grep -n "obsContext" apps/api/src/lib/logger.ts` = 2 matches ✓; `grep -n "obsContext\.getStore()" apps/api/src/lib/logger.ts` = 1 match ✓
- `bun test apps/api/` = 75 pass / 0 fail ✓
- No STATE.md or ROADMAP.md modifications (worktree mode) ✓
