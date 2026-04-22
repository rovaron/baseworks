# Phase 17: Observability Ports & OTEL Bootstrap - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship typed `Tracer` / `MetricsProvider` / `ErrorTracker` port interfaces, Noop adapters for all three, an env-selected factory mirroring the billing `PaymentProvider` pattern, and a Bun-safe OTEL SDK bootstrap (`apps/api/src/telemetry.ts`) that loads as line-1 of both the API and worker entrypoints. Acceptance: operator starts API + worker with default env (no DSNs, all ports noop) and sees `otel-selftest: ok`, zero external traffic, and a Bun smoke-test in CI asserting the enabled auto-instrumentations load and the disabled ones do not.

Real-backend adapters (Sentry, GlitchTip, Pino-sink, OTEL) ship in Phases 18 and 21. Context/logging/wrappers ship in Phase 19. BullMQ propagation ships in Phase 20. bull-board + health dashboard in Phase 22.

</domain>

<decisions>
## Implementation Decisions

### Factory Shape
- **D-01:** Three separate lazy-singleton factories — `getTracer()`, `getMetrics()`, `getErrorTracker()` — mirroring `getPaymentProvider()` in `packages/modules/billing/src/provider-factory.ts` 1:1. Matches the per-port env vars (`TRACER=`, `METRICS_PROVIDER=`, `ERROR_TRACKER=`); consumers import only what they need; tree-shakes cleanly.
- **D-02:** Each factory ships a `set*` + `reset*` trio for tests (`setTracer`/`resetTracer`, etc.), matching `setPaymentProvider`/`resetPaymentProvider`. Tests swap only the ports they care about without env monkeypatching.
- **D-03:** In Phase 17, `getErrorTracker()` defaults to a Noop ErrorTracker when unset. Phase 18 changes the default to the pino-sink adapter when that adapter lands. Keeps Phase 17 self-contained and honors the "zero external dependencies with defaults" criterion.

### Bootstrap Layout
- **D-04:** Single shared `apps/api/src/telemetry.ts` parameterized by `INSTANCE_ROLE`. Api role enables the HTTP auto-instrumentation and sets `service.name=baseworks-api`; worker role skips HTTP and sets `service.name=baseworks-worker`. Both entrypoints import this file as line 1. Shared resource/sampler/exporter setup lives here.
- **D-05:** The "startup self-test span" creates + ends a span named `otel-selftest` with attribute `ok=true` and logs `otel-selftest: ok`. Under Noop defaults this is a no-op; no network calls, no dependency on the collector being reachable. Exporter-roundtrip variants are explicitly deferred to the OTEL-adapter phase (Phase 21) where a real backend exists to flush to.
- **D-06:** `telemetry.ts` reads `INSTANCE_ROLE` and the handful of `OBS_*` / `TRACER` / `METRICS_PROVIDER` / `ERROR_TRACKER` keys directly from `process.env` inline. It does NOT import `@baseworks/config` before `sdk.start()` — avoids pulling the full validated env chain (and its transitive deps) through the import graph before instrumentation is attached. Full `validateObservabilityEnv()` runs on the next line after `sdk.start()`.

### Env Validation Scope
- **D-07:** `validateObservabilityEnv()` in Phase 17 is strictly per-selected-adapter. With all three ports defaulting to noop, nothing is required. Sentry/GlitchTip env keys are added in Phase 18; OTLP endpoint keys in Phase 21. Env schema grows with the adapter code, not before it.
- **D-08:** The observability env schema lives inside `packages/config/src/env.ts`, alongside `validatePaymentProviderEnv()`. `validateObservabilityEnv()` is exported from `@baseworks/config` (consistent with the billing precedent: single env source of truth for the whole monorepo).
- **D-09:** On validation failure the process crashes hard — throw on first missing required key, log the offending key, exit non-zero. Mirrors `validatePaymentProviderEnv()`. No dev-vs-prod branching, no silent downgrade to noop.

### Smoke-Test Harness
- **D-10:** The Phase 17 CI smoke-test is an entrypoint-boot integration test at `apps/api/__tests__/telemetry-boot.test.ts`. It spawns `bun run apps/api/src/telemetry.ts` (or an equivalent that drives `telemetry.ts` at line-1 under a real `bun` invocation) as a subprocess once with `INSTANCE_ROLE=api` and once with `INSTANCE_ROLE=worker`, asserts exit code 0 and `otel-selftest: ok` on stdout. Catches line-1 ordering bugs that package-level tests cannot.
- **D-11:** The smoke-test probes the three Phase-17-enabled auto-instrumentations (HTTP, pino, ioredis) — positive assertion they loaded — AND asserts the disabled set (fs, dns, net) is NOT loaded. Bidirectional check prevents silent regressions where someone re-enables the disabled instrumentations.
- **D-12:** BullMQ instrumentation (`@appsignal/opentelemetry-instrumentation-bullmq`) is NOT installed in Phase 17. The research "Phase 1 smoke-test" flag is carried into Phase 20 with the rest of BullMQ propagation work. Keeps Phase 17 aligned with its Success Criteria #4 instrumentation list.

### Claude's Discretion
- Exact `service.name` / `service.version` attribute set beyond the two canonical names above.
- Internal file layout of `packages/observability/` (adapter subdirectory naming, barrel vs subpath exports) — planner to align with existing `packages/modules/billing/src/adapters/` conventions.
- Precise wording of log messages other than `otel-selftest: ok` (which is an acceptance-criterion string).
- Whether the smoke-test is `bun test` or a dedicated script — as long as it runs in CI and exercises the subprocess invocation.
- Parent-based sampler default ratio for Phase 17 (Noop means it does not matter; research says parent-based 10% target, can be wired now or deferred to Phase 21).

### Folded Todos
None — no todos were surfaced against Phase 17 at discussion time.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone & requirements
- `.planning/milestones/v1.3-ROADMAP.md` §"Phase 17: Observability Ports & OTEL Bootstrap" — Goal, dependencies, requirements (OBS-01..OBS-04), and the 5 Success Criteria. Every Phase 17 plan must trace back to those criteria.
- `.planning/REQUIREMENTS.md` — OBS-01, OBS-02, OBS-03, OBS-04 (observability port requirements).
- `.planning/PROJECT.md` — Project vision, module/monorepo constraints (Bun-only, Medusa-style modular backend).

### Research & architecture
- `.planning/research/SUMMARY.md` — v1.3 research summary: stack additions, adapter matrix, Bun-specific pitfalls, build order. Phase 17 corresponds to the research's "Phase 1: Ports + Noop Adapters + Factory + OTEL Bootstrap".
- `.planning/research/STACK.md` — Pinned package versions (@opentelemetry/sdk-node ^0.215.0, @sentry/bun ^10.32+, etc.).
- `.planning/research/ARCHITECTURE.md` — Port/adapter layering, wrapping strategy, ALS context flow.
- `.planning/research/PITFALLS.md` — Bun OTEL init ordering, enterWith ban, postgres.js mismatch, PII leak vectors, cardinality.
- `.planning/research/FEATURES.md` — Table-stakes vs differentiators vs anti-features for v1.3.

### Existing patterns to mirror (byte-for-byte where applicable)
- `packages/modules/billing/src/provider-factory.ts` — Lazy singleton + `get/reset/set` trio is the factory shape Phase 17 copies for each observability port.
- `packages/modules/billing/src/ports/payment-provider.ts` — Port interface style (readonly `name`, JSDoc on every method) is the template for `Tracer` / `MetricsProvider` / `ErrorTracker`.
- `packages/config/src/env.ts` — `validatePaymentProviderEnv()` is the crash-hard startup validator pattern `validateObservabilityEnv()` must mirror.
- `apps/api/src/index.ts` and `apps/api/src/worker.ts` — Entrypoints that must gain `import "./telemetry";` at line 1.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/modules/billing/src/provider-factory.ts` — lazy singleton factory with `get/reset/set` trio. Direct template for the three observability factories.
- `packages/modules/billing/src/ports/payment-provider.ts` — port interface style (`readonly name`, JSDoc on every method) — template for `Tracer` / `MetricsProvider` / `ErrorTracker`.
- `packages/config/src/env.ts` — `validatePaymentProviderEnv()` — crash-hard pattern for `validateObservabilityEnv()`.
- `apps/api/src/lib/logger.ts` — pino logger that Phase 19 will attach an ALS mixin to; Phase 17 does not touch it.
- `apps/api/src/worker.ts` — already reads `env.INSTANCE_ROLE` and calls `assertRedisUrl(env.INSTANCE_ROLE, env.REDIS_URL)` — Phase 17's `telemetry.ts` reads the same env var inline for role branching.

### Established Patterns
- **Port/adapter with env-selected factory** — billing pattern is the law of the land. Observability mirrors it.
- **Runtime env guards** — billing throws on missing required keys at call time; Phase 17 moves the guard to startup via `validateObservabilityEnv()` (same spirit, earlier failure).
- **Workspace package imports** — `@baseworks/<name>` — new `packages/observability/` will export `@baseworks/observability` consumable from `apps/api` and `apps/admin`.
- **INSTANCE_ROLE branching** — api vs worker code paths already distinguished by this env var; `telemetry.ts` extends that pattern to auto-instrumentation selection.

### Integration Points
- `apps/api/src/index.ts` line 1 → `import "./telemetry";` (triggers OTEL bootstrap + noop factories).
- `apps/api/src/worker.ts` line 1 → same import.
- `packages/config/src/env.ts` → add (initially empty-required) observability env keys and `validateObservabilityEnv()` export.
- `packages/config/src/index.ts` → re-export `validateObservabilityEnv`.
- No changes to `apps/api/src/core/cqrs.ts`, `apps/api/src/core/event-bus.ts`, or any handler file in Phase 17 — those touch Phase 19.
- CI workflow gains an observability-smoke test job (or an existing `bun test` job picks up `apps/api/__tests__/telemetry-boot.test.ts`).

</code_context>

<specifics>
## Specific Ideas

- **Mirror billing exactly.** The user repeatedly aligned with the "matches the billing precedent" option across factory shape, env validation location, and failure mode. Downstream agents should treat billing's structure as the design template, not as loose inspiration.
- **Noop-first, aggressively.** Phase 17 ships with noop defaults across all three ports (including ErrorTracker) so the system runs with zero external dependencies. Pino-sink default for ErrorTracker waits for Phase 18.
- **Line-1 import is load-bearing.** The smoke test explicitly validates this discipline via subprocess boot — not just a package-level unit test — because Bun ignores `NODE_OPTIONS=--require` and any instrumented import before `sdk.start()` silently disables that instrumentation forever.
- **Phase 17 does not carry Phase 20's research burden.** BullMQ instrumentation package install + smoke-test deliberately belong to Phase 20, not now.

</specifics>

<deferred>
## Deferred Ideas

- **pino-sink ErrorTracker adapter** — Phase 18 (ERR-02). Phase 17 defaults to noop instead.
- **Sentry / GlitchTip env keys in the schema** — Phase 18 adds `SENTRY_DSN`, `GLITCHTIP_DSN`, and their validator branches.
- **OTLP exporter endpoint env keys** — Phase 21 adds `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, sampler ratio, etc.
- **BullMQ instrumentation package** (`@appsignal/opentelemetry-instrumentation-bullmq`) — install + Bun smoke-test belong to Phase 20 with the rest of trace propagation work.
- **Exporter-roundtrip self-test** — a stronger `otel-selftest` variant that flushes synchronously to the collector makes sense only once a real backend is wired; revisit in Phase 21.
- **Full instrumentation-registry probe** (asserting every loaded plugin by name) — Phase 17 sticks with positive-on-enabled + negative-on-disabled; deeper introspection can land later if bugs surface.

### Reviewed Todos (not folded)
None — no todo matches were surfaced for Phase 17.

</deferred>

---

*Phase: 17-observability-ports-otel-bootstrap*
*Context gathered: 2026-04-21*
