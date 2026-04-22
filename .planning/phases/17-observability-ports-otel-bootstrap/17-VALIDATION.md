---
phase: 17
slug: observability-ports-otel-bootstrap
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> See `17-RESEARCH.md` § "Validation Architecture" for the source mapping.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (built-in, Bun 1.1+) |
| **Config file** | none — `bun test` discovers `**/__tests__/**/*.test.ts` automatically |
| **Quick run command** | `bun test packages/observability` |
| **Full suite command** | `bun test packages/observability apps/api/__tests__/telemetry-boot.test.ts apps/api/__tests__/telemetry-instrumentations.test.ts` |
| **Estimated runtime** | ~15 seconds (subprocess boot test ≤10 s, in-process tests ≤5 s) |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/observability` (port + factory unit tests, ~3 s)
- **After every plan wave:** Run the full suite command above
- **Before `/gsd-verify-work`:** Full suite must be green AND `bun run check` (typecheck) must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

> Filled by the planner during PLAN.md generation. Skeleton below seeds the structure;
> each task ID gets a row when its plan is written.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 17-01-01 | 01 | 1 | OBS-01 | — | Tracer port type-checks; Noop adapter implements every method | unit | `bun test packages/observability/src/ports/__tests__/tracer.test.ts` | ❌ W0 | ⬜ pending |
| 17-01-02 | 01 | 1 | OBS-01 | — | MetricsProvider port type-checks; Noop adapter implements every method | unit | `bun test packages/observability/src/ports/__tests__/metrics.test.ts` | ❌ W0 | ⬜ pending |
| 17-01-03 | 01 | 1 | OBS-01 | — | ErrorTracker port type-checks; Noop adapter implements every method | unit | `bun test packages/observability/src/ports/__tests__/error-tracker.test.ts` | ❌ W0 | ⬜ pending |
| 17-02-01 | 02 | 2 | OBS-02 | — | `getTracer/setTracer/resetTracer` lazy singleton + override behavior | unit | `bun test packages/observability/src/factory/__tests__/tracer-factory.test.ts` | ❌ W0 | ⬜ pending |
| 17-02-02 | 02 | 2 | OBS-02 | — | `getMetrics/setMetrics/resetMetrics` lazy singleton + override behavior | unit | `bun test packages/observability/src/factory/__tests__/metrics-factory.test.ts` | ❌ W0 | ⬜ pending |
| 17-02-03 | 02 | 2 | OBS-02 | — | `getErrorTracker/setErrorTracker/resetErrorTracker` lazy singleton + Noop default | unit | `bun test packages/observability/src/factory/__tests__/error-tracker-factory.test.ts` | ❌ W0 | ⬜ pending |
| 17-03-01 | 03 | 2 | OBS-03 | T-17-01 (env-typo silent fallback) | `validateObservabilityEnv()` crashes on unknown adapter values | unit | `bun test packages/config/src/__tests__/validate-observability-env.test.ts` | ❌ W0 | ⬜ pending |
| 17-04-01 | 04 | 3 | OBS-04 | T-17-02 (instrumentation drift) | `telemetry.ts` boots with `INSTANCE_ROLE=api`, exits 0, prints `otel-selftest: ok` | integration (subprocess) | `bun test apps/api/__tests__/telemetry-boot.test.ts -t "api role"` | ❌ W0 | ⬜ pending |
| 17-04-02 | 04 | 3 | OBS-04 | T-17-02 | `telemetry.ts` boots with `INSTANCE_ROLE=worker`, exits 0, prints `otel-selftest: ok` | integration (subprocess) | `bun test apps/api/__tests__/telemetry-boot.test.ts -t "worker role"` | ❌ W0 | ⬜ pending |
| 17-04-03 | 04 | 3 | OBS-04 | T-17-02 | Enabled instrumentations (HTTP/api-only, pino, ioredis) present by `instrumentationName` | unit (in-process) | `bun test apps/api/__tests__/telemetry-instrumentations.test.ts -t "enabled"` | ❌ W0 | ⬜ pending |
| 17-04-04 | 04 | 3 | OBS-04 | T-17-02 | Disabled instrumentations (fs, dns, net) absent from registered list | unit (in-process) | `bun test apps/api/__tests__/telemetry-instrumentations.test.ts -t "disabled"` | ❌ W0 | ⬜ pending |
| 17-04-05 | 04 | 3 | OBS-04 | T-17-03 (egress on noop) | Subprocess stderr is clean (no exporter connect errors); zero outbound network when all ports = noop | integration (subprocess) | `bun test apps/api/__tests__/telemetry-boot.test.ts -t "noop egress"` | ❌ W0 | ⬜ pending |
| 17-05-01 | 05 | 3 | OBS-04 | — | `apps/api/src/index.ts` line 1 is `import "./telemetry";` (line-1 ordering discipline) | unit (file probe) | `bun test apps/api/__tests__/telemetry-line1.test.ts` | ❌ W0 | ⬜ pending |
| 17-05-02 | 05 | 3 | OBS-04 | — | `apps/api/src/worker.ts` line 1 is `import "./telemetry";` | unit (file probe) | `bun test apps/api/__tests__/telemetry-line1.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*The planner MUST replace `❌ W0` with `✅` for any test file the plan creates.*

---

## Wave 0 Requirements

- [ ] `packages/observability/package.json` — workspace package manifest with `@baseworks/observability` name
- [ ] `packages/observability/tsconfig.json` — extends repo base, includes `src/**/*` and `__tests__/**/*`
- [ ] `packages/observability/src/ports/__tests__/{tracer,metrics,error-tracker}.test.ts` — port-shape stubs for OBS-01
- [ ] `packages/observability/src/factory/__tests__/{tracer,metrics,error-tracker}-factory.test.ts` — factory stubs for OBS-02
- [ ] `packages/config/src/__tests__/validate-observability-env.test.ts` — env validator stub for OBS-03
- [ ] `apps/api/__tests__/telemetry-boot.test.ts` — subprocess smoke-test stub for OBS-04 (D-10)
- [ ] `apps/api/__tests__/telemetry-instrumentations.test.ts` — in-process probe stub for D-11 (positive HTTP/pino/ioredis, negative fs/dns/net)
- [ ] `apps/api/__tests__/telemetry-line1.test.ts` — line-1 ordering probe stub
- [ ] OTEL package installs: `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/api`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions` at versions verified by RESEARCH.md (NOT the STACK.md baseline — see RESEARCH.md "Versions diverge" finding)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Operator boots API + worker locally with `bun dev` and confirms `otel-selftest: ok` on each stdout, no exporter errors, no outbound traffic in `lsof -i` / `netstat` | Phase Acceptance | Final operator-side acceptance gate; subprocess test exercises the same path but a human spot-check is the gold-standard sign-off | (1) `cp .env.example .env` (no DSN keys set), (2) `bun run apps/api/src/index.ts` in one terminal, `bun run apps/api/src/worker.ts` in another, (3) confirm both stdouts contain `otel-selftest: ok`, (4) run `lsof -iTCP -sTCP:ESTABLISHED -P -n` (or `Get-NetTCPConnection` on Windows) and confirm no connections to OTEL/Sentry/GlitchTip endpoints |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (8 stub files + workspace scaffolding)
- [ ] No watch-mode flags (every command is one-shot)
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter (after planner verifies the per-task map is complete)

**Approval:** pending
