# Phase 17: Observability Ports & OTEL Bootstrap - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 17-observability-ports-otel-bootstrap
**Areas discussed:** Factory shape, Bootstrap layout, Env validation scope, Smoke-test harness

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Factory shape | Three separate singletons vs aggregate factory | ✓ |
| Bootstrap layout | One shared telemetry.ts vs role-specific files | ✓ |
| Env validation scope | All future adapter shapes vs strictly per-selected | ✓ |
| Smoke-test harness | Package unit test vs entrypoint boot vs CI job | ✓ |

---

## Factory shape

### Q: How should the observability factory be shaped?

| Option | Description | Selected |
|--------|-------------|----------|
| Three singletons | `getTracer` / `getMetrics` / `getErrorTracker` — each with its own `reset/set` trio. Mirrors billing 1:1. | ✓ |
| Aggregate factory | Single `getObservability()` returning `{ tracer, metrics, errorTracker }`. | |
| Init-then-export | `initObservability(env)` assigns module-level exports. Faster but load-bearing init ordering. | |

**User's choice:** Three singletons (Recommended)

### Q: How should tests swap in fakes?

| Option | Description | Selected |
|--------|-------------|----------|
| setTracer/setMetrics/setErrorTracker | Matches `setPaymentProvider`. Per-port swap. | ✓ |
| Full aggregate setter | Single `setObservability({...})`. Chattier when only one port matters. | |
| Rely on env + reset only | Tests set env + `resetObservability()`. Realistic but slower. | |

**User's choice:** setTracer/setMetrics/setErrorTracker (Recommended)

### Q: What should `getErrorTracker()` return by default in Phase 17?

| Option | Description | Selected |
|--------|-------------|----------|
| Noop ErrorTracker | Trivial noop, Phase 18 swaps default to pino-sink when it lands. | ✓ |
| Minimal pino-sink now | Bare-bones adapter calling `logger.error(err)`. Three adapters from day one. | |
| No default — require explicit env | Fail fast if `ERROR_TRACKER` unset. Breaks zero-config success criterion. | |

**User's choice:** Noop ErrorTracker (Recommended)

---

## Bootstrap layout

### Q: How should the OTEL bootstrap file(s) be organized?

| Option | Description | Selected |
|--------|-------------|----------|
| Single shared telemetry.ts | `apps/api/src/telemetry.ts` reads `INSTANCE_ROLE`, branches api-vs-worker. One file, two imports. | ✓ |
| Two role-specific files | `telemetry-api.ts` + `telemetry-worker.ts` sharing helpers from `telemetry-shared.ts`. | |
| Package-level bootstrap | `packages/observability/bootstrap/startTelemetry({role})`. Most reusable, more indirection. | |

**User's choice:** Single shared telemetry.ts (Recommended)

### Q: What does the "startup self-test span" actually assert?

| Option | Description | Selected |
|--------|-------------|----------|
| Span creates + ends without throwing | `tracer.startSpan('otel-selftest').end()` and log `otel-selftest: ok`. Noop-safe. | ✓ |
| Roundtrip to exporter when non-noop | In OTEL mode, flush to collector with short timeout. Catches bad endpoint at boot. | |
| Full instrumentation probe | Also check each auto-instrumentation loaded from a registry. Strongest guarantee. | |

**User's choice:** Span creates + ends without throwing (Recommended)

### Q: Where does `INSTANCE_ROLE` come from at line-1?

| Option | Description | Selected |
|--------|-------------|----------|
| Read process.env directly | Avoid pulling `@baseworks/config` before `sdk.start()`. Inline `process.env.INSTANCE_ROLE`. | ✓ |
| Import @baseworks/config first | Consistent with rest of codebase, but transitive deps may load before instrumentation. | |
| Hybrid — tiny local env reader | `packages/observability/env-early.ts` — typed + Bun-safe, second env surface. | |

**User's choice:** Read process.env directly (Recommended)

---

## Env validation scope

### Q: Which env shape does `validateObservabilityEnv()` cover in Phase 17?

| Option | Description | Selected |
|--------|-------------|----------|
| Strictly per-selected adapter | Noop requires nothing. Sentry/OTLP land in Phases 18/21 with their adapters. | ✓ |
| All future adapter shapes now | Lock full env surface now (SENTRY_DSN, OTEL_*, etc.) all optional today. | |
| Selected + one-step-ahead | Strict validation + documented/linted comment block for Phase 18/21 keys. | |

**User's choice:** Strictly per-selected adapter (Recommended)

### Q: Where does the observability env schema live?

| Option | Description | Selected |
|--------|-------------|----------|
| Inside @baseworks/config | Extend `packages/config/src/env.ts`, mirror `validatePaymentProviderEnv`. | ✓ |
| New packages/observability/env.ts | Keep obs env isolated in the observability package. | |
| Split: schema in config, validator in observability | Middle ground. | |

**User's choice:** Inside @baseworks/config (Recommended)

### Q: What should validation failure do at startup?

| Option | Description | Selected |
|--------|-------------|----------|
| Crash hard | Match `validatePaymentProviderEnv`. Throw on first missing required key, exit non-zero. | ✓ |
| Log + fall back to noop | Warn and silently downgrade. Hides misconfigurations in prod. | |
| Crash in prod, warn in dev | Gate on `NODE_ENV`. Common pattern, adds branching. | |

**User's choice:** Crash hard (Recommended)

---

## Smoke-test harness

### Q: Where and how should the Bun smoke-test run?

| Option | Description | Selected |
|--------|-------------|----------|
| Entrypoint-boot integration test | `apps/api/__tests__/telemetry-boot.test.ts` — subprocess boot, asserts `otel-selftest: ok`, runs for both `INSTANCE_ROLE=api` and `worker`. | ✓ |
| Package-level unit test | `packages/observability/__tests__/bootstrap.test.ts` — imports `startTelemetry()`, asserts no throw. | |
| Dedicated GitHub Actions job | Separate workflow file running a `bun run` command. | |
| Integration + CI job | Subprocess test + `bun build --dry-run` for bundler safety. | |

**User's choice:** Entrypoint-boot integration test (Recommended)

### Q: Which auto-instrumentations does the smoke-test probe?

| Option | Description | Selected |
|--------|-------------|----------|
| HTTP, pino, ioredis only | Matches Phase 17 enabled set. BullMQ moves to Phase 20. | ✓ |
| Also probe BullMQ instrumentation | Install `@appsignal/opentelemetry-instrumentation-bullmq` now, resolve research flag. | |
| Only assert sdk.start() succeeds | Minimum viable, misses per-plugin load failures. | |

**User's choice:** HTTP, pino, ioredis only (Recommended)

### Q: Should the test assert disabled instrumentations are NOT loaded?

| Option | Description | Selected |
|--------|-------------|----------|
| Both directions | Positive on HTTP/pino/ioredis AND negative on fs/dns/net. Prevents silent regressions. | ✓ |
| Positive only | Simpler; relies on code review. | |

**User's choice:** Both directions (Recommended)

---

## Claude's Discretion

- Internal directory layout of `packages/observability/` beyond port / adapter / factory files
- Exact `service.name` / `service.version` attribute set beyond the two canonical names
- Precise wording of log messages other than `otel-selftest: ok`
- Whether the smoke-test is `bun test` or a dedicated script — as long as it runs in CI with the subprocess invocation
- Parent-based sampler default ratio (Noop ignores it; research suggests 10% — can be wired in Phase 17 or deferred to Phase 21)

## Deferred Ideas

- pino-sink ErrorTracker adapter — Phase 18
- Sentry / GlitchTip env keys — Phase 18
- OTLP exporter endpoint env keys — Phase 21
- BullMQ instrumentation package + Bun smoke-test — Phase 20
- Exporter-roundtrip self-test variant — Phase 21
- Full instrumentation-registry probe — revisit if bugs surface
