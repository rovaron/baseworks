---
phase: 17
slug: observability-ports-otel-bootstrap
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-21
updated: 2026-04-21
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Aligned to actual PLAN.md task IDs and waves after planner revision.
> See `17-RESEARCH.md` § "Validation Architecture" for the source mapping.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (built-in, Bun 1.1+) |
| **Config file** | none — `bun test` discovers `**/__tests__/**/*.test.ts` automatically |
| **Quick run command** | `bun test packages/observability` |
| **Full suite command** | `bun test packages/observability packages/config apps/api/__tests__/telemetry-boot.test.ts apps/api/__tests__/telemetry-instrumentations.test.ts apps/api/__tests__/telemetry-line1.test.ts` |
| **Estimated runtime** | ~15 seconds (subprocess boot test ≤10 s, in-process tests ≤5 s) |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/observability packages/config` (port + factory + env unit tests, ~3 s)
- **After every plan wave:** Run the full suite command above
- **Before `/gsd-verify-work`:** Full suite must be green AND `bun run check` (typecheck) must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

> Task IDs and waves taken from PLAN.md frontmatter. TDD pattern interleaves test+impl in the same task — no separate Wave 0 stub creation needed.

| Task ID    | Plan | Wave | Requirement       | Threat Ref       | Secure Behavior                                                                                | Test Type                | Automated Command                                                                                  | File Exists | Status |
|------------|------|------|-------------------|------------------|------------------------------------------------------------------------------------------------|--------------------------|----------------------------------------------------------------------------------------------------|-------------|--------|
| 17-01-00   | 01   | 1    | OBS-01,02,03      | —                | `@baseworks/observability` workspace package resolves; tsconfig + barrel compile               | build                    | `bun install && bun --filter @baseworks/observability tsc --noEmit`                                | created in-task | ⬜ pending |
| 17-01-01   | 01   | 1    | OBS-01            | —                | `Tracer` port + `NoopTracer` adapter type-check; readonly name = "noop"                        | unit                     | `bun test packages/observability/src/ports/__tests__/tracer.test.ts`                               | created in-task | ⬜ pending |
| 17-01-02   | 01   | 1    | OBS-02            | —                | `MetricsProvider` port + `NoopMetricsProvider` adapter type-check                              | unit                     | `bun test packages/observability/src/ports/__tests__/metrics.test.ts`                              | created in-task | ⬜ pending |
| 17-01-03   | 01   | 1    | OBS-03            | —                | `ErrorTracker` port + `NoopErrorTracker` adapter type-check                                    | unit                     | `bun test packages/observability/src/ports/__tests__/error-tracker.test.ts`                        | created in-task | ⬜ pending |
| 17-02-01   | 02   | 2    | OBS-01,02,03      | T-17-01          | `getTracer/getMetrics/getErrorTracker` with `set*`/`reset*` trios; unknown adapter values throw | type-check               | `bun --filter @baseworks/observability tsc --noEmit`                                               | created in-task | ⬜ pending |
| 17-02-02   | 02   | 2    | OBS-01,02,03      | T-17-01          | Lazy singleton + override + reset semantics for all 3 factories                                | unit                     | `bun test packages/observability/src/factory/__tests__/`                                           | created in-task | ⬜ pending |
| 17-03-01   | 03   | 1    | OBS-04            | T-17-01          | `validateObservabilityEnv()` rejects unknown adapter values; defaults all to `noop`            | unit                     | `bun test packages/config/src/__tests__/validate-observability-env.test.ts`                        | created in-task | ⬜ pending |
| 17-04-00   | 04   | 3    | OBS-04            | —                | OTEL deps installed in `packages/observability/package.json` at versions verified by RESEARCH.md | manual probe             | `grep '@opentelemetry/sdk-node' packages/observability/package.json && bun install --dry-run`       | created in-task | ⬜ pending |
| 17-04-01   | 04   | 3    | OBS-04            | T-17-02, T-17-05 | `telemetry.ts` constructs `NodeSDK` with `traceExporter: undefined`; otel-selftest span carries only `{ok:true}` | type-check + grep | `bun build apps/api/src/telemetry.ts --target=bun --outfile=/dev/null && grep -E "^\s*traceExporter\s*:" apps/api/src/telemetry.ts \| wc -l \| grep -q "^0$"` | created in-task | ⬜ pending |
| 17-04-02   | 04   | 3    | OBS-04            | T-17-03          | Subprocess test: `INSTANCE_ROLE=api` and `=worker` exit 0, stdout `otel-selftest: ok`, stderr clean | integration (subprocess) | `bun test apps/api/__tests__/telemetry-boot.test.ts`                                               | created in-task | ⬜ pending |
| 17-04-03   | 04   | 3    | OBS-04            | T-17-02          | Bidirectional probe: enabled (HTTP api-only / pino / ioredis) present; disabled (fs/dns/net) absent | unit (in-process)        | `bun test apps/api/__tests__/telemetry-instrumentations.test.ts`                                   | created in-task | ⬜ pending |
| 17-05-01   | 05   | 4    | OBS-04            | T-17-04          | `apps/api/src/index.ts` line 1 == `import "./telemetry";` (modify, no regression)              | covered by 17-05-03      | (see 17-05-03)                                                                                     | modified in-task | ⬜ pending |
| 17-05-02   | 05   | 4    | OBS-04            | T-17-04          | `apps/api/src/worker.ts` line 1 == `import "./telemetry";` (modify, no regression)             | covered by 17-05-03      | (see 17-05-03)                                                                                     | modified in-task | ⬜ pending |
| 17-05-03   | 05   | 4    | OBS-04            | T-17-04          | Line-1 file probe asserts both entrypoint files start with the canonical telemetry import      | unit (file probe)        | `bun test apps/api/__tests__/telemetry-line1.test.ts`                                              | created in-task | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Sampling continuity check:** No 3 consecutive tasks lack automated verify. Tasks 17-05-01 and 17-05-02 are file-modification tasks whose verification is covered by the immediately-following task 17-05-03 in the same wave — within tolerance.

---

## Wave 0 Requirements

**No standalone Wave 0 work.** TDD pattern interleaves test creation with implementation in every task that ships a behavior:

- Workspace scaffolding (`packages/observability/{package.json,tsconfig.json,src/index.ts}`) is delivered by Plan 01 Task 17-01-00 (Wave 1) — the first task in the dependency graph. No earlier infrastructure is needed because tsconfig and bun test require nothing pre-existing in the new package.
- Test stub files are created in the same task as the code they exercise (per TDD rules in `references/tdd.md`).
- OTEL deps install lives in Plan 04 Task 17-04-00 (Wave 3), inside the package that owns those deps (`packages/observability/package.json`).

`wave_0_complete: true` reflects that the validation contract has no unmet pre-Wave-1 requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Operator boots API + worker locally with `bun dev` and confirms `otel-selftest: ok` on each stdout, no exporter errors, and zero outbound traffic in `Get-NetTCPConnection` / `lsof` | Phase Acceptance | Final operator-side acceptance gate. The subprocess test exercises the same path under `bun test`; a human spot-check is the gold-standard sign-off. | (1) `cp .env.example .env` (no DSN keys set), (2) `bun run apps/api/src/index.ts` in one terminal, `bun run apps/api/src/worker.ts` in another, (3) confirm both stdouts contain `otel-selftest: ok`, (4) on Windows: `Get-NetTCPConnection -State Established` — confirm no connections to OTEL/Sentry/GlitchTip endpoints. On macOS/Linux: `lsof -iTCP -sTCP:ESTABLISHED -P -n`. |

---

## Validation Sign-Off

- [x] All tasks have automated verify or are covered by a sibling task in the same wave (17-05-01/02 → 17-05-03)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 has no unmet pre-Wave-1 requirements (TDD interleave)
- [x] No watch-mode flags (every command is one-shot)
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-21 (re-aligned to PLAN.md frontmatter after planner revision iteration 1)
