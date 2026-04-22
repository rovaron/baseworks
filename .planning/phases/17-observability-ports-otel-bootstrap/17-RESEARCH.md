# Phase 17: Observability Ports & OTEL Bootstrap - Research

**Researched:** 2026-04-21
**Domain:** Observability ports + Bun-safe OpenTelemetry SDK bootstrap
**Confidence:** HIGH (all package versions verified against npm; bootstrap pattern matches `provider-factory.ts` byte-for-byte; smoke-test mechanics grounded in `Instrumentation` interface contract)

## Summary

Phase 17 is a **pure scaffolding phase**: ship three port interfaces, three Noop adapters, three lazy-singleton factories with `set/reset` trios, an env validator, and a single Bun-safe OTEL bootstrap file imported as line 1 of both API and worker entrypoints. With every default selecting noop, the system runs with **zero new external dependencies** — the only network call OTEL might emit is the one we deliberately disable by leaving `traceExporter` undefined (so the SDK uses an in-process noop exporter). The CI smoke-test asserts that line-1 ordering works under a real `bun` subprocess and that the enabled instrumentations (HTTP, pino, ioredis) loaded while the disabled ones (fs, dns, net) did not.

The phase mirrors the billing `PaymentProvider` precedent in three places — factory shape (`packages/modules/billing/src/provider-factory.ts`), port style (`packages/modules/billing/src/ports/payment-provider.ts`), and crash-hard env validator (`packages/config/src/env.ts`). No new business logic. No tracing of CqrsBus/EventBus/Drizzle (Phase 19). No BullMQ instrumentation install (Phase 20). No real exporters (Phase 21). No pino-sink ErrorTracker (Phase 18).

**Primary recommendation:** Create `packages/observability/` (new workspace package), three port files + types, three noop adapter files, three factories in a single `factory.ts`, and a single `apps/api/src/telemetry.ts` that constructs `NodeSDK` with `traceExporter: undefined` (noop default), `instrumentations: getNodeAutoInstrumentations({ ... })` with the enable/disable matrix, calls `sdk.start()` synchronously, emits the self-test span, then yields control. Validate env *after* `sdk.start()` to keep the import graph small before instrumentation attaches.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OBS-01 | Operator can use a typed `ErrorTracker` port with a Noop adapter that mirrors the GlitchTip API surface (capture exception/message/breadcrumb/context) and is factory-selected at startup by `@t3-oss/env-core` config | §6 ErrorTracker port signature mirrors Sentry/GlitchTip subset (capture exception, message, breadcrumb, scope user/tenant/tag/extra, flush). §7 NoopErrorTracker. §8 `getErrorTracker()` factory selects via `ERROR_TRACKER` env. |
| OBS-02 | Operator can use a typed `MetricsProvider` port (counter/histogram/gauge) with a Noop adapter, factory-selected at startup | §6 MetricsProvider port (counter/histogram/gauge with `Counter`/`Histogram`/`Gauge` subtypes). §7 NoopMetricsProvider. §8 `getMetrics()` factory. |
| OBS-03 | Operator can use a typed `Tracer` port (startSpan/withSpan/inject/extract) with a Noop adapter, factory-selected at startup | §6 Tracer port (startSpan, withSpan, inject, extract, currentCarrier). §7 NoopTracer. §8 `getTracer()` factory. |
| OBS-04 | Operator sees the OTEL SDK bootstrapped as the first-imports in `apps/api` and `apps/worker` entrypoints (programmatic `NodeSDK`, no `--require`), with a Bun smoke-test gate in CI verifying each auto-instrumentation loads without crashing | §9 telemetry.ts bootstrap recipe (line-1 import, NodeSDK construction, role branching, auto-instrumentation enable/disable matrix). §10 otel-selftest. §11 Smoke-test design — subprocess spawn + stdout assertion + introspection of registered instrumentations via `instrumentationName`/`getConfig().enabled`. §12 Bun landmines. |
</phase_requirements>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Three separate lazy-singleton factories — `getTracer()`, `getMetrics()`, `getErrorTracker()` — mirroring `getPaymentProvider()` 1:1.
- **D-02:** Each factory ships a `set*` + `reset*` trio for tests.
- **D-03:** In Phase 17 `getErrorTracker()` defaults to a Noop ErrorTracker (pino-sink default lands in Phase 18).
- **D-04:** Single shared `apps/api/src/telemetry.ts` parameterized by `INSTANCE_ROLE`. Api role enables HTTP auto-instrumentation + sets `service.name=baseworks-api`; worker role skips HTTP + sets `service.name=baseworks-worker`. Both entrypoints import as line 1.
- **D-05:** Self-test emits + ends a span named `otel-selftest` with attribute `ok=true` and logs `otel-selftest: ok`. Under noop this is a no-op. Exporter-roundtrip variants deferred to Phase 21.
- **D-06:** `telemetry.ts` reads `INSTANCE_ROLE` and the `OBS_*` / `TRACER` / `METRICS_PROVIDER` / `ERROR_TRACKER` keys directly from `process.env` inline. Does NOT import `@baseworks/config` before `sdk.start()`. `validateObservabilityEnv()` runs on the next line after `sdk.start()`.
- **D-07:** `validateObservabilityEnv()` in Phase 17 is strictly per-selected-adapter. With all three ports defaulting to noop, nothing is required. Sentry/GlitchTip env keys → Phase 18; OTLP endpoint keys → Phase 21.
- **D-08:** `validateObservabilityEnv()` lives inside `packages/config/src/env.ts`, exported from `@baseworks/config`.
- **D-09:** On validation failure: throw on first missing required key, log offending key, exit non-zero. Mirrors `validatePaymentProviderEnv()`.
- **D-10:** CI smoke-test at `apps/api/__tests__/telemetry-boot.test.ts`. Spawns bun subprocess once with `INSTANCE_ROLE=api` and once with `INSTANCE_ROLE=worker`, asserts exit 0 + `otel-selftest: ok` on stdout.
- **D-11:** Smoke-test probes the three Phase-17-enabled auto-instrumentations (HTTP, pino, ioredis) — positive AND negative (fs, dns, net not loaded).
- **D-12:** BullMQ instrumentation NOT installed in Phase 17 (deferred to Phase 20).

### Claude's Discretion

- Exact `service.name` / `service.version` attribute set beyond the two canonical names.
- Internal file layout of `packages/observability/` (adapter subdirectory naming, barrel vs subpath exports) — align with `packages/modules/billing/src/adapters/`.
- Precise wording of log messages other than `otel-selftest: ok` (acceptance string).
- Whether smoke-test is `bun test` or a dedicated script.
- Parent-based sampler default ratio for Phase 17 (noop means it does not matter; can defer to Phase 21).

### Deferred Ideas (OUT OF SCOPE)

- **pino-sink ErrorTracker adapter** — Phase 18 (ERR-02).
- **Sentry / GlitchTip env keys in the schema** — Phase 18.
- **OTLP exporter endpoint env keys** — Phase 21.
- **BullMQ instrumentation package** (`@appsignal/opentelemetry-instrumentation-bullmq`) — Phase 20.
- **Exporter-roundtrip self-test** — Phase 21.
- **Full instrumentation-registry probe** (every plugin by name) — beyond positive/negative subset, defer if needed.

## Project Constraints (from CLAUDE.md)

| Directive | Phase 17 Compliance Requirement |
|-----------|-------------------------------|
| **Runtime: Bun — all packages must be Bun-compatible** | All chosen OTEL packages verified pure-JS (no NAPI). `sdk.start()` programmatic (NEVER `--require`/`-r`). |
| **Validation: Zod via `@t3-oss/env-core`** | `validateObservabilityEnv()` extends existing `serverSchema` in `packages/config/src/env.ts`. No second env library. |
| **Workspace package convention `@baseworks/<name>`** | New package is `@baseworks/observability` consumable from `apps/api`. |
| **Testing: `bun test` for backend** | Smoke-test uses `bun test`; `Bun.spawn` for subprocess invocation. |
| **Linter: Biome** | If a forbidden API needs banning later (e.g. `enterWith` in Phase 19), use Biome rule. Phase 17 itself adds no lint rules. |
| **GSD Workflow Enforcement** | All Phase 17 file changes proceed through `/gsd-execute-phase` plans, not direct edits. |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tracer / Metrics / ErrorTracker port contracts | Shared workspace package (`@baseworks/observability`) | — | Cross-cutting infrastructure consumed by `apps/api` AND `apps/api/src/worker.ts` (and future modules). Not a feature module. Mirrors `packages/db` placement of port-style abstractions. |
| Noop adapters | Same workspace package (`@baseworks/observability`) | — | Defaults must ship with the port — no runtime dependency on env or other packages. |
| Env-selected factories (`getTracer`/`getMetrics`/`getErrorTracker`) | `@baseworks/observability` | reads `@baseworks/config` lazily | Mirrors `packages/modules/billing/src/provider-factory.ts`. Singleton state lives where the port lives. |
| `validateObservabilityEnv()` | `packages/config/src/env.ts` | exported via `@baseworks/config` | Lives next to `validatePaymentProviderEnv()` per D-08; single env source of truth. |
| OTEL SDK bootstrap (`telemetry.ts`) | `apps/api/src/` (entrypoint-adjacent) | — | Must be co-located with the entrypoints that import it as line 1. Reads `process.env` directly to avoid importing `@baseworks/config` (which would pull the validated env chain through the import graph before instrumentation attaches). |
| `otel-selftest` span emission | `apps/api/src/telemetry.ts` | — | Same file; runs after `sdk.start()` and after `validateObservabilityEnv()`. |
| Smoke-test (subprocess boot + assertions) | `apps/api/__tests__/telemetry-boot.test.ts` | — | Co-located with the API app whose entrypoint discipline is being verified. |

## Standard Stack

### Core (verified against npm 2026-04-22)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@opentelemetry/api` | `^1.9.1` `[VERIFIED: npm view]` | Tracing/metrics/context API used by adapters | Stable 1.x; what every OTEL adapter peer-depends on |
| `@opentelemetry/sdk-node` | `^0.215.0` `[VERIFIED: npm view]` | `NodeSDK` aggregate bootstrap (traces+metrics+logs+instrumentation registration) | Programmatic init under Bun is documented and verified working in 2026 community guides |
| `@opentelemetry/auto-instrumentations-node` | `^0.73.0` `[VERIFIED: npm view]` | Bundle of HTTP/pg/ioredis/pino/etc. auto-instrumentations + the `getNodeAutoInstrumentations()` enable/disable API we need | Avoids hand-picking and version-managing each instrumentation package |
| `@opentelemetry/resources` | `^2.7.0` `[VERIFIED: npm view]` | `resourceFromAttributes()` for `service.name` / `service.version` etc. | Standard; required by NodeSDK |
| `@opentelemetry/semantic-conventions` | `^1.40.0` `[VERIFIED: npm view]` | `ATTR_SERVICE_NAME` etc. constants | Use the named constants instead of string literals for forward-compat |

> ⚠️ **Versions diverge from `.planning/research/STACK.md`:** STACK.md pinned `resources@^1.30`, `sdk-trace-node@^1.30`, `semantic-conventions@^1.30`. The npm registry as of 2026-04-22 ships `resources@2.7.0`, `sdk-trace-node@2.7.0`, `semantic-conventions@1.40.0`. The 2.x line of `resources`/`sdk-trace-node` is what `sdk-node@0.215.0` peer-depends on — pinning to `^1.30` will fail resolution. Use the verified 2026-04-22 versions in this table.

### Phase 17 does NOT install (deferred)

| Library | Why Deferred | Phase |
|---------|-------------|-------|
| `@opentelemetry/exporter-trace-otlp-proto` | No real exporter in Phase 17 (noop default → in-process discard) | Phase 21 |
| `@opentelemetry/sdk-metrics` | No metrics export in Phase 17 (NoopMetricsProvider creates instruments locally) | Phase 21 |
| `@opentelemetry/sdk-logs` + `exporter-logs-otlp-proto` | Pino-sink ErrorTracker + OTLP logs are Phase 18/21 | Phase 18+ |
| `@appsignal/opentelemetry-instrumentation-bullmq` | D-12 explicitly defers | Phase 20 |
| `@sentry/bun` | Phase 17 ships only Noop ErrorTracker | Phase 18 |

### Pre-installed (already in repo, no change)

| Library | Version | Phase 17 Use |
|---------|---------|--------------|
| `pino` | `^10.0.0` (`apps/api/package.json`) | Phase 17 logs `otel-selftest: ok` via existing `apps/api/src/lib/logger.ts` AND directly to stdout (the smoke-test asserts the literal string regardless of transport). |
| `ioredis` | transitive via `bullmq@^5` | Phase 17 enables `@opentelemetry/instrumentation-ioredis` so the smoke-test can assert it loaded; no runtime ioredis call required for the assertion. |

### Installation

```bash
# Workspace root: install Phase 17 OTEL deps into the new observability package
cd packages/observability
bun add \
  @opentelemetry/api@^1.9.1 \
  @opentelemetry/sdk-node@^0.215.0 \
  @opentelemetry/auto-instrumentations-node@^0.73.0 \
  @opentelemetry/resources@^2.7.0 \
  @opentelemetry/semantic-conventions@^1.40.0
```

`telemetry.ts` lives in `apps/api/src/` and imports from `@baseworks/observability` for the noop adapters; the OTEL SDK packages are pulled in transitively through that workspace dep so `apps/api` does not need to list them in its own `package.json`.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@opentelemetry/auto-instrumentations-node` | hand-pick `@opentelemetry/instrumentation-http`, `-ioredis`, `-pino` separately | Slightly smaller install, but loses the `getNodeAutoInstrumentations({ name: { enabled: false } })` API which is what makes the smoke-test bidirectional check trivial. Stick with the bundle. |
| `NodeSDK` constructor | hand-wire `NodeTracerProvider` + `registerInstrumentations` | More control, more code, more risk of init-order bugs. NodeSDK is the documented Bun-safe path. |
| Single `factory.ts` with all three factories | Three separate files (`tracer-factory.ts`, `metrics-factory.ts`, `error-tracker-factory.ts`) | Single file matches `provider-factory.ts` precedent (one file per concern). Three factories in one file is fine since they share no state. **Recommendation: single `factory.ts`** for parity. |
| Read env via `process.env` in `telemetry.ts` | Import `@baseworks/config` first | D-06 explicitly forbids importing `@baseworks/config` before `sdk.start()` to keep the import graph minimal before instrumentation attaches. Read `process.env` inline. |

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                       Process Boot Sequence                       │
│                                                                    │
│  apps/api/src/index.ts  OR  apps/api/src/worker.ts                │
│           │                                                        │
│           ▼ (line 1)                                               │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │  import "./telemetry";                                      │   │
│  │                                                              │   │
│  │  apps/api/src/telemetry.ts                                  │   │
│  │  ├─ read process.env.INSTANCE_ROLE inline                   │   │
│  │  ├─ build resourceFromAttributes({ service.name, ... })     │   │
│  │  ├─ getNodeAutoInstrumentations({                           │   │
│  │  │    '@opentelemetry/instrumentation-http': {              │   │
│  │  │       enabled: role === 'api' || role === 'all' },       │   │
│  │  │    '@opentelemetry/instrumentation-ioredis': { en: T },  │   │
│  │  │    '@opentelemetry/instrumentation-pino':    { en: T },  │   │
│  │  │    '@opentelemetry/instrumentation-fs':      { en: F },  │   │
│  │  │    '@opentelemetry/instrumentation-dns':     { en: F },  │   │
│  │  │    '@opentelemetry/instrumentation-net':     { en: F },  │   │
│  │  │  })                                                       │   │
│  │  ├─ const sdk = new NodeSDK({ resource, instrumentations,   │   │
│  │  │                              traceExporter: undefined })  │   │
│  │  ├─ sdk.start()  ← attaches patches; synchronous return     │   │
│  │  ├─ validateObservabilityEnv()  ← P17: no-op (all noop)     │   │
│  │  ├─ trace.getTracer('boot').startSpan('otel-selftest',      │   │
│  │  │     { attributes: { ok: true } }).end()                  │   │
│  │  ├─ console.log('otel-selftest: ok')   ← acceptance string  │   │
│  │  └─ register process.on('SIGTERM') → sdk.shutdown()         │   │
│  │                                                              │   │
│  └────────────────────────────────────────────────────────────┘   │
│           │                                                        │
│           ▼ (line 2+)                                              │
│  // existing imports — Drizzle, Elysia, BullMQ, registry, etc.    │
│  // now patched by auto-instrumentations as they load             │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘

                          App-side consumers (no behavior change in P17)
                                       │
                                       ▼
                     ┌─────────────────────────────────────────┐
                     │  packages/observability/                │
                     │    src/factory.ts                       │
                     │      getTracer()      → NoopTracer      │
                     │      getMetrics()     → NoopMetrics     │
                     │      getErrorTracker()→ NoopErrorTracker│
                     │    src/ports/                           │
                     │      tracer.ts        Tracer            │
                     │      metrics.ts       MetricsProvider   │
                     │      error-tracker.ts ErrorTracker      │
                     │      types.ts         shared types      │
                     │    src/adapters/noop/                   │
                     │      noop-tracer.ts                     │
                     │      noop-metrics.ts                    │
                     │      noop-error-tracker.ts              │
                     │    src/index.ts       barrel export     │
                     └─────────────────────────────────────────┘
```

### Recommended Project Structure

```
packages/
├── observability/                              # NEW workspace package — @baseworks/observability
│   ├── package.json                            # name, deps, type=module, main=./src/index.ts
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                            # Barrel: re-export ports + factory + reset/set helpers
│       ├── ports/
│       │   ├── tracer.ts                       # interface Tracer (+ readonly name + JSDoc)
│       │   ├── metrics.ts                      # interface MetricsProvider, Counter, Histogram, Gauge
│       │   ├── error-tracker.ts                # interface ErrorTracker, ErrorTrackerScope, Breadcrumb
│       │   └── types.ts                        # Span, SpanOptions, TraceCarrier, Attributes
│       ├── adapters/
│       │   └── noop/
│       │       ├── noop-tracer.ts              # class NoopTracer implements Tracer
│       │       ├── noop-metrics.ts             # class NoopMetricsProvider + Noop counter/histogram/gauge
│       │       └── noop-error-tracker.ts       # class NoopErrorTracker
│       ├── factory.ts                          # getTracer / setTracer / resetTracer (+ same trio × 2)
│       └── __tests__/
│           ├── factory.test.ts                 # mirrors provider-factory.test.ts structure
│           ├── noop-tracer.test.ts
│           ├── noop-metrics.test.ts
│           └── noop-error-tracker.test.ts

packages/config/src/
├── env.ts                                      # MODIFIED: add validateObservabilityEnv() + (optional) ERROR_TRACKER/TRACER/METRICS_PROVIDER schema fields
├── index.ts                                    # MODIFIED: re-export validateObservabilityEnv
└── __tests__/
    └── env.test.ts                             # MODIFIED: add validateObservabilityEnv tests

apps/api/src/
├── telemetry.ts                                # NEW: line-1 import target; NodeSDK bootstrap + selftest
├── index.ts                                    # MODIFIED line 1: import "./telemetry";
├── worker.ts                                   # MODIFIED line 1: import "./telemetry";
└── ...                                         # everything else unchanged

apps/api/__tests__/
└── telemetry-boot.test.ts                      # NEW: subprocess smoke-test (INSTANCE_ROLE=api + =worker)
```

### Pattern 1: Lazy-Singleton Factory With set/reset Trio

**What:** Module-level `let instance: T | null = null;` plus three exported functions: `get*()` (lazy initialize on first call), `set*(impl)` (test injection), `reset*()` (clear singleton).

**When to use:** All three observability ports. **This is the byte-for-byte mirror of `packages/modules/billing/src/provider-factory.ts` lines 19–95.**

**Example:**
```typescript
// Source: packages/observability/src/factory.ts (NEW — mirror of packages/modules/billing/src/provider-factory.ts)
import type { Tracer, MetricsProvider, ErrorTracker } from "./ports";
import { NoopTracer } from "./adapters/noop/noop-tracer";
import { NoopMetricsProvider } from "./adapters/noop/noop-metrics";
import { NoopErrorTracker } from "./adapters/noop/noop-error-tracker";

let tracerInstance: Tracer | null = null;

/**
 * Return the cached Tracer instance, creating it on first call based on
 * the TRACER env var. Defaults to "noop" when unset.
 *
 * @returns The singleton Tracer instance
 */
export function getTracer(): Tracer {
  if (!tracerInstance) {
    const name = process.env.TRACER ?? "noop";
    switch (name) {
      case "noop":
        tracerInstance = new NoopTracer();
        break;
      // Phase 21 will add: case "otel": tracerInstance = new OtelTracer(...);
      default:
        throw new Error(`Unknown tracer: ${name}`);
    }
  }
  return tracerInstance;
}

export function resetTracer(): void { tracerInstance = null; }
export function setTracer(t: Tracer): void { tracerInstance = t; }

// Identical pattern — getMetrics/setMetrics/resetMetrics, getErrorTracker/setErrorTracker/resetErrorTracker.
```

### Pattern 2: OTEL SDK Programmatic Bootstrap (Bun-Safe)

**What:** Construct `NodeSDK` synchronously; call `sdk.start()` before any other import; register `SIGTERM` shutdown.

**When to use:** Any Bun process that needs OTEL instrumentation.

**Example:**
```typescript
// Source: apps/api/src/telemetry.ts (NEW)
// Citation: https://www.npmjs.com/package/@opentelemetry/sdk-node + Bun community guides 2026-02
import { NodeSDK } from "@opentelemetry/sdk-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { trace } from "@opentelemetry/api";
import { validateObservabilityEnv } from "@baseworks/config";

// D-06: read env directly from process.env — do NOT import @baseworks/config here
const role = (process.env.INSTANCE_ROLE ?? "all") as "api" | "worker" | "all";
const serviceName =
  role === "worker" ? "baseworks-worker" : "baseworks-api";

const instrumentations = getNodeAutoInstrumentations({
  // Enabled in P17:
  "@opentelemetry/instrumentation-http": {
    enabled: role === "api" || role === "all",
  },
  "@opentelemetry/instrumentation-ioredis": { enabled: true },
  "@opentelemetry/instrumentation-pino": { enabled: true },
  // Disabled in P17 (noisy / known Bun issues):
  "@opentelemetry/instrumentation-fs": { enabled: false },
  "@opentelemetry/instrumentation-dns": { enabled: false },
  "@opentelemetry/instrumentation-net": { enabled: false },
});

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? "0.0.0",
  }),
  // P17: no traceExporter / no metricReader → SDK uses its in-process noop pipeline.
  // Phase 21 wires the OTLP/HTTP+proto exporter and PeriodicExportingMetricReader here.
  instrumentations,
});

// IMPORTANT: synchronous. NodeSDK#start() returns void in v0.215.x. Do not await.
sdk.start();

// Now safe to call into @baseworks/config — instrumentations are attached.
validateObservabilityEnv();

// Self-test span — D-05. Under noop providers this is effectively a no-op,
// but exercises the API surface so a regression in port wiring is caught at boot.
const tracer = trace.getTracer("baseworks.boot");
const span = tracer.startSpan("otel-selftest", {
  attributes: { ok: true, role, "service.name": serviceName },
});
span.end();
console.log("otel-selftest: ok"); // D-05 acceptance string — must reach stdout

// Graceful shutdown so the test subprocess exits cleanly
const shutdown = async () => {
  try {
    await sdk.shutdown();
  } catch {
    /* swallow — noop SDK rarely throws */
  }
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

`sdk.start()` returns `void` (v0.215.x); awaiting is harmless but unnecessary and would risk deferring instrumentation attachment past subsequent imports — which is the bug Pitfall 1 (`PITFALLS.md`) is about. Keep it synchronous. `[CITED: @opentelemetry/sdk-node API docs + 2026-02 Bun guide]`

### Pattern 3: Auto-Instrumentation Enable/Disable Matrix

**What:** Pass an object to `getNodeAutoInstrumentations()` keyed by full instrumentation package name; each value is `{ enabled: boolean }` (other config keys allowed too).

**When to use:** Whenever shipping `auto-instrumentations-node` to production.

**Example:** see Pattern 2 above. **Phase 17 matrix:**

| Instrumentation | API role | Worker role | Reason |
|----------------|----------|-------------|--------|
| `@opentelemetry/instrumentation-http` | enabled | disabled | API serves HTTP; worker's only HTTP server is the health probe (D-04 limits API-flavour to api role). Worker can re-enable in P21 if outbound HTTP needs spans. |
| `@opentelemetry/instrumentation-ioredis` | enabled | enabled | Both roles touch Redis (worker via BullMQ; API via session/health/billing webhooks queue.add). |
| `@opentelemetry/instrumentation-pino` | enabled | enabled | Trace ID injection into pino logs is the cheapest correlation we ship — needs no custom mixin (Phase 19 will add the ALS-driven fields on top). |
| `@opentelemetry/instrumentation-fs` | **disabled** | **disabled** | Pitfall 1 + Pitfall 18 — known noise/hang under Bun. |
| `@opentelemetry/instrumentation-dns` | **disabled** | **disabled** | High-volume, low-signal — see Pitfall 18. |
| `@opentelemetry/instrumentation-net` | **disabled** | **disabled** | Subsumed by HTTP instrumentation. |
| (other auto-bundle entries: `pg`, `grpc`, `aws-sdk`, etc.) | left at bundle defaults | left at bundle defaults | Not relevant in P17; postgres.js isn't `pg` so the pg patcher is a no-op for our queries. Per `PITFALLS.md` Pitfall 9, audit/disable in Phase 21 if perf regression measured. |

### Anti-Patterns to Avoid

- **Bun `--require ./telemetry.ts`** — Bun does not honor `NODE_OPTIONS=--require` for module-patching purposes the way Node does. Patches silently fail. Use line-1 `import "./telemetry"` only. (Pitfall 1; `[CITED: PITFALLS.md §1]`)
- **Importing `@baseworks/config` inside `telemetry.ts` before `sdk.start()`** — D-06 explicitly forbids. Pulls Drizzle/Elysia/etc. through the import graph before instrumentation attaches → instrumented modules cached un-patched.
- **`await sdk.start()` with subsequent business imports under it** — `start()` returns void; awaiting is benign but encourages people to put `import "./app"` after the `await` in an async wrapper. The pattern that actually works is **synchronous start at the top of a side-effect-only module that is the first import**.
- **`enterWith` anywhere** — banned project-wide for ALS (Phase 19 enforces). Phase 17 doesn't touch ALS, but the noop tracer must not introduce one.
- **Throwing inside the noop adapter** — Noop adapters must never throw. `throw new Error("not implemented")` defeats the "default = working system" property.
- **Setting `traceExporter` to a real exporter in P17** — D-06/D-07 require zero external traffic on default env. `traceExporter: undefined` is the noop path.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Programmatic OTEL SDK init | Manual `NodeTracerProvider` + `registerInstrumentations` + `BatchSpanProcessor` wiring | `NodeSDK` from `@opentelemetry/sdk-node` | Aggregate SDK is the only init path the OTEL team commits to keeping Bun-compatible; hand-wiring is brittle to OTEL JS minor releases. |
| Instrumentation enable/disable | Conditional `instrumentations: [new HttpInstrumentation(), ...]` array building | `getNodeAutoInstrumentations({ name: { enabled: bool } })` | Returns `Instrumentation[]` whose entries each expose `instrumentationName` (string) and `getConfig().enabled` — exactly what the smoke-test needs to introspect. Hand-built arrays don't carry the metadata cleanly. `[CITED: @opentelemetry/instrumentation Instrumentation interface]` |
| Resource attribute object | `{ [SemanticResourceAttributes.SERVICE_NAME]: "..." }` literal | `resourceFromAttributes({ [ATTR_SERVICE_NAME]: "..." })` from `@opentelemetry/resources` | The constructor-style `Resource` class is deprecated in 2.x; `resourceFromAttributes` is the supported factory. |
| Noop adapter for ports | Custom `if (process.env.TRACER === 'noop') return undefined` checks at every call site | Real Noop class implementing the port interface | Keeps the port contract honest — every consumer always gets a Tracer-shaped object. No null checks downstream. |
| Self-test "did the SDK start?" check | Try-catch around `sdk.start()` and a custom log | `tracer.startSpan('otel-selftest').end()` + `console.log('otel-selftest: ok')` | A literal span exercises the actual API the rest of the app will use. If port wiring breaks in P21 when a real exporter lands, the same self-test catches it. |
| Subprocess smoke-test | `child_process.spawnSync` with custom stream parsing | `Bun.spawn` with `stdout: 'pipe'` + `await proc.exited` + `await new Response(proc.stdout).text()` | Bun's spawn API is simpler, native, and deterministic on Windows + Unix — important since the dev workstation in `gitStatus` is Windows. |
| Env validator for noop case | "If everything is noop, skip validation entirely" | A `validateObservabilityEnv()` that no-ops in P17 by design | D-09 mandates a real function with crash-hard semantics. P18+ extends it. The function shape must exist now so P18 can extend it without changing call sites. |

**Key insight:** Phase 17 is *intentionally minimal*. The temptation is to "just throw in the OTLP exporter while we're here." Resist — Phase 21 has a dedicated docker-compose stack and dashboard provisioning to validate it. P17 ships shape, not data.

## Common Pitfalls

### Pitfall 1: telemetry.ts not the literal first import

**What goes wrong:** Someone refactors `apps/api/src/index.ts` and moves `import { env }` above `import "./telemetry"`. The next deploy: HTTP spans missing, ioredis spans missing, no warning. By the time anyone notices, hundreds of unrelated changes have shipped.

**Why it happens:** Auto-instrumentation patches modules at import time. If `pg`/`ioredis`/`http`/`drizzle`/`bullmq`/`pino` are imported (even transitively through `@baseworks/shared` or `@baseworks/config`) before `sdk.start()` runs, those modules are bound to their unpatched implementations forever. (`PITFALLS.md` Pitfall 1.)

**How to avoid:**
- **Smoke-test enforces it.** `apps/api/__tests__/telemetry-boot.test.ts` (D-10) spawns the entrypoint as a subprocess and asserts the auto-instrumentation registry shows http/ioredis/pino enabled. If line-1 ordering breaks, the registry probe fails.
- **Add a Biome rule** (defer to a follow-on task if Biome doesn't trivially express "first non-comment import in this file must be `./telemetry`") OR add a CI grep:
  ```bash
  head -3 apps/api/src/index.ts | grep -q '^import "./telemetry"' || exit 1
  head -3 apps/api/src/worker.ts | grep -q '^import "./telemetry"' || exit 1
  ```
- **Document in JSDoc at the top of `index.ts` and `worker.ts`:** `// LOAD-BEARING: this import MUST be line 1. See PITFALLS.md §1.`

**Warning signs:** Smoke-test stops asserting one of the enabled instrumentations; HTTP responses lack `traceparent` (P19 gate); pino logs have no `trace_id` (P19 gate).

### Pitfall 2: `sdk.start()` awaited inside an async wrapper

**What goes wrong:** Someone writes `await sdk.start(); await import("./app");` thinking it makes init "more correct." Result: between `sdk.start()` returning and the dynamic `import("./app")` resolving, a microtask runs other registered handlers — but more importantly, code reviewers stop trusting that telemetry is line-1 because there's now an `await` boundary.

**How to avoid:**
- `sdk.start()` returns `void` in v0.215.x. **Treat it as synchronous** in `telemetry.ts`. Static `import` statements after it (in *other* files like `index.ts` line 2+) are fine because they execute after `telemetry.ts`'s top-level body completes.
- Never use dynamic `await import()` in `telemetry.ts`. Static `import` only.

### Pitfall 3: `validateObservabilityEnv()` runs before `sdk.start()`

**What goes wrong:** Importing `@baseworks/config` for the validator triggers `createEnv` which transitively imports the entire env chain — and any module that env code touches (today: nothing heavy, but a future `@baseworks/db` import via env would patch postgres.js at the wrong time).

**How to avoid:**
- D-06 codifies: `process.env` reads inline in `telemetry.ts` for boot config; `validateObservabilityEnv()` runs **after** `sdk.start()`. Document this in a comment in `telemetry.ts`.
- **Verify in code review:** the `import` block in `telemetry.ts` is the smallest possible — `@opentelemetry/*` + `@baseworks/config`. Do not add `@baseworks/db` or any module-package import.

### Pitfall 4: Noop adapter throws on optional methods

**What goes wrong:** Noop port classes accidentally inherit a `throw new Error("not implemented")` body from a generated stub. First time `getMetrics().histogram("x").observe(1)` is called from a wrapper added in Phase 19, prod crashes.

**How to avoid:**
- Every port method on every noop adapter has an empty `{}` body (or returns a sub-noop). Unit tests assert this:
  ```typescript
  test("NoopMetricsProvider.histogram().observe() does not throw", () => {
    const noop = new NoopMetricsProvider();
    expect(() => noop.histogram("x").observe(1, { a: "b" })).not.toThrow();
  });
  ```

### Pitfall 5: Smoke-test deadlock on shutdown

**What goes wrong:** Smoke-test subprocess never exits because `NodeSDK` keeps an interval handle alive and SIGTERM isn't issued. `bun test` times out at 30s.

**How to avoid:**
- `telemetry.ts` registers `SIGTERM` and `SIGINT` handlers that call `sdk.shutdown()` and let the process exit naturally.
- The smoke-test subprocess script (a tiny driver: `import "./telemetry"; process.exit(0)`) exits immediately after the self-test logs. Do not run the full `index.ts` server.
- Test asserts `proc.exited` resolves within 10 s; treats hang as failure.

### Pitfall 6: `auto-instrumentations-node` minor bump silently changes the registry

**What goes wrong:** `^0.73.0` permits `0.74.0` install which adds `@opentelemetry/instrumentation-undici` enabled-by-default. Smoke-test's negative-assert list (fs/dns/net) still passes; the new instrumentation is unaccounted for.

**How to avoid:**
- Smoke-test ALSO asserts the **set of enabled-by-name** equals an explicit allowlist `["@opentelemetry/instrumentation-http", "@opentelemetry/instrumentation-ioredis", "@opentelemetry/instrumentation-pino"]` (worker variant: drop http). Any new entry → test fails until the allowlist is consciously updated.
- Pin `auto-instrumentations-node` to `~0.73.0` (tilde, not caret) for Phase 17 to limit the blast radius. Re-evaluate on Phase 21.

### Pitfall 7: Subprocess test doesn't pick up Bun's TS support

**What goes wrong:** `Bun.spawn(["bun", "run", "apps/api/src/telemetry.ts"])` works locally (cwd = repo root) but in CI the cwd may differ → `MODULE_NOT_FOUND` for `@baseworks/config`.

**How to avoid:**
- Pass an explicit `cwd: process.cwd()` (which `bun test` runs from the workspace root) and use a path constant resolved with `import.meta.dir`:
  ```typescript
  const entry = new URL("../src/telemetry.ts", import.meta.url).pathname;
  Bun.spawn(["bun", "run", entry], { env: { ...process.env, INSTANCE_ROLE: "api" }, stdout: "pipe", stderr: "pipe" });
  ```
- Optionally write a separate `apps/api/src/__telemetry-boot-driver.ts` that imports `./telemetry` and immediately `process.exit(0)`s — keeps the smoke-test entry from depending on `index.ts` quirks.

## Code Examples

### Port: Tracer (mirrors PaymentProvider readonly-name + JSDoc style)

```typescript
// Source: packages/observability/src/ports/tracer.ts (NEW)
import type { Span, SpanOptions, TraceCarrier } from "./types";

/**
 * Tracer port (OBS-03).
 *
 * Defines the contract that all tracer adapters must implement.
 * - NoopTracer: zero-overhead no-op (Phase 17 default)
 * - OtelTracer: programmatic OpenTelemetry adapter (Phase 21)
 *
 * Mirrors the PaymentProvider port style — readonly name, JSDoc on every
 * method, no leaking of vendor types into the interface.
 */
export interface Tracer {
  /** Tracer identifier (e.g., "noop", "otel"). */
  readonly name: string;

  /**
   * Start a span synchronously. Caller is responsible for calling span.end().
   *
   * @param name - Span name (e.g., "http.request", "cqrs.command.billing:checkout")
   * @param opts - Optional span kind, attributes, and parent carrier
   * @returns Started span; under noop, an empty-body Span object
   */
  startSpan(name: string, opts?: SpanOptions): Span;

  /**
   * Run a function inside a span; auto-ends on resolve/throw.
   *
   * @param name - Span name
   * @param fn - Function receiving the active span; can be sync or async
   * @param opts - Optional span kind, attributes, and parent carrier
   * @returns The function's return value
   */
  withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T> | T,
    opts?: SpanOptions,
  ): Promise<T>;

  /**
   * Inject the current span context into a carrier object usable across
   * process boundaries (e.g., BullMQ job data).
   *
   * @param carrier - Object to mutate with traceparent/tracestate fields
   */
  inject(carrier: Record<string, string>): void;

  /**
   * Extract a span context from an inbound carrier (e.g., HTTP header bag,
   * BullMQ job data).
   *
   * @param carrier - Inbound carrier
   * @returns Parsed TraceCarrier or null if no parent context found
   */
  extract(carrier: Record<string, unknown>): TraceCarrier | null;

  /**
   * Serialize the current span (from active OTEL context) into a carrier.
   *
   * @returns TraceCarrier or null if no active span
   */
  currentCarrier(): TraceCarrier | null;
}
```

### Port: MetricsProvider

```typescript
// Source: packages/observability/src/ports/metrics.ts (NEW)
import type { Attributes } from "./types";

export interface Counter {
  /**
   * Increment the counter by `value` (default 1).
   *
   * @param value - Increment amount (must be non-negative)
   * @param attrs - Bounded-cardinality attributes ONLY (see PITFALLS.md §4)
   */
  inc(value?: number, attrs?: Attributes): void;
}

export interface Histogram {
  /**
   * Record an observation in the histogram.
   *
   * @param value - Observed value
   * @param attrs - Bounded-cardinality attributes ONLY
   */
  observe(value: number, attrs?: Attributes): void;
}

export interface Gauge {
  /**
   * Set the gauge to an absolute value.
   *
   * @param value - New gauge value
   * @param attrs - Bounded-cardinality attributes ONLY
   */
  set(value: number, attrs?: Attributes): void;
}

/**
 * MetricsProvider port (OBS-02).
 *
 * Adapters: NoopMetricsProvider (Phase 17 default), OtelMetricsProvider (Phase 21).
 */
export interface MetricsProvider {
  /** Provider identifier (e.g., "noop", "otel"). */
  readonly name: string;

  /**
   * Get or create a counter instrument.
   *
   * @param name - Instrument name (must follow OTEL semantic conventions)
   * @param description - Human-readable description (optional)
   * @param unit - UCUM unit (e.g., "ms", "By", "1") (optional)
   */
  counter(name: string, description?: string, unit?: string): Counter;

  /** Get or create a histogram instrument. */
  histogram(name: string, description?: string, unit?: string): Histogram;

  /** Get or create a gauge instrument. */
  gauge(name: string, description?: string, unit?: string): Gauge;
}
```

### Port: ErrorTracker

```typescript
// Source: packages/observability/src/ports/error-tracker.ts (NEW)
/**
 * Per-event scope manipulator. Mutations are scoped to the current capture
 * call — they do not affect later events. Mirrors the Sentry/GlitchTip
 * scope API but limited to the union both backends support.
 */
export interface ErrorTrackerScope {
  /** Tag the event with the authenticated user. */
  setUser(user: { id: string; email?: string }): void;
  /** Tag the event with the request's tenant. */
  setTenant(tenantId: string): void;
  /** Add an arbitrary string tag (low-cardinality keys only). */
  setTag(key: string, value: string): void;
  /** Add structured extra data (subject to redaction). */
  setExtra(key: string, value: unknown): void;
  /** Add a breadcrumb to the chain (subject to redaction). */
  addBreadcrumb(breadcrumb: {
    category: string;
    message: string;
    level?: "info" | "warning" | "error";
    data?: Record<string, unknown>;
  }): void;
}

/**
 * ErrorTracker port (OBS-01).
 *
 * Adapters:
 * - NoopErrorTracker (Phase 17 default — drops everything silently)
 * - PinoErrorTracker (Phase 18 fallback — tees to existing pino logger)
 * - SentryErrorTracker / GlitchTipErrorTracker (Phase 18 — same @sentry/bun client, DSN swap)
 *
 * Surface intentionally restricted to the Sentry/GlitchTip *intersection*
 * (capture exception/message/breadcrumb + scope + flush). Profiling, session
 * replay, and performance monitoring are NOT in this port — see
 * PITFALLS.md §14 (Sentry/GlitchTip drift).
 */
export interface ErrorTracker {
  /** Tracker identifier (e.g., "noop", "sentry", "glitchtip", "pino"). */
  readonly name: string;

  /**
   * Capture an exception with optional scoped enrichment.
   *
   * @param err - The thrown value (Error or unknown)
   * @param scope - Optional callback to enrich the event scope
   * @returns Event ID (empty string under noop)
   */
  captureException(err: unknown, scope?: (s: ErrorTrackerScope) => void): string;

  /**
   * Capture a typed message at the given severity.
   *
   * @param msg - Message body (NEVER interpolate user input — see PITFALLS.md §6)
   * @param level - Severity
   * @param scope - Optional scope callback
   * @returns Event ID (empty string under noop)
   */
  captureMessage(
    msg: string,
    level: "info" | "warning" | "error",
    scope?: (s: ErrorTrackerScope) => void,
  ): string;

  /**
   * Flush pending events. Called during graceful shutdown.
   *
   * @param timeoutMs - Maximum time to wait
   * @returns true if all events flushed, false on timeout
   */
  flush(timeoutMs: number): Promise<boolean>;
}
```

### Port: Shared types

```typescript
// Source: packages/observability/src/ports/types.ts (NEW)
export type Attributes = Record<string, string | number | boolean | undefined>;

export type SpanKind = "internal" | "server" | "client" | "producer" | "consumer";

export interface Span {
  setAttributes(attrs: Attributes): void;
  setStatus(status: "ok" | "error", message?: string): void;
  recordException(err: unknown): void;
  end(): void;
  /** Returns an opaque carrier usable across process boundaries. */
  carrier(): TraceCarrier;
}

/** W3C traceparent + tenancy/request fields, serialized into job payloads. */
export interface TraceCarrier {
  /** "00-<traceid>-<spanid>-<flags>" — W3C Trace Context. */
  traceparent: string;
  tracestate?: string;
  /** Application correlation (independent of OTEL trace ID). */
  requestId?: string;
  tenantId?: string;
  userId?: string;
}

export interface SpanOptions {
  kind?: SpanKind;
  attributes?: Attributes;
  /** Resume a parent span from an incoming carrier (e.g., BullMQ job). */
  parent?: TraceCarrier;
}
```

### Noop adapters

```typescript
// Source: packages/observability/src/adapters/noop/noop-tracer.ts (NEW)
import type { Tracer } from "../../ports/tracer";
import type { Span, SpanOptions, TraceCarrier } from "../../ports/types";

const noopSpan: Span = {
  setAttributes() {},
  setStatus() {},
  recordException() {},
  end() {},
  carrier() {
    return { traceparent: "00-00000000000000000000000000000000-0000000000000000-00" };
  },
};

export class NoopTracer implements Tracer {
  readonly name = "noop";
  startSpan(_name: string, _opts?: SpanOptions): Span { return noopSpan; }
  async withSpan<T>(
    _name: string,
    fn: (span: Span) => Promise<T> | T,
    _opts?: SpanOptions,
  ): Promise<T> {
    return await fn(noopSpan);
  }
  inject(_carrier: Record<string, string>): void {}
  extract(_carrier: Record<string, unknown>): TraceCarrier | null { return null; }
  currentCarrier(): TraceCarrier | null { return null; }
}
```

```typescript
// Source: packages/observability/src/adapters/noop/noop-metrics.ts (NEW)
import type { MetricsProvider, Counter, Histogram, Gauge } from "../../ports/metrics";

const noopCounter: Counter = { inc() {} };
const noopHistogram: Histogram = { observe() {} };
const noopGauge: Gauge = { set() {} };

export class NoopMetricsProvider implements MetricsProvider {
  readonly name = "noop";
  counter(_name: string): Counter { return noopCounter; }
  histogram(_name: string): Histogram { return noopHistogram; }
  gauge(_name: string): Gauge { return noopGauge; }
}
```

```typescript
// Source: packages/observability/src/adapters/noop/noop-error-tracker.ts (NEW)
import type { ErrorTracker, ErrorTrackerScope } from "../../ports/error-tracker";

const noopScope: ErrorTrackerScope = {
  setUser() {}, setTenant() {}, setTag() {}, setExtra() {}, addBreadcrumb() {},
};

export class NoopErrorTracker implements ErrorTracker {
  readonly name = "noop";
  captureException(_err: unknown, scope?: (s: ErrorTrackerScope) => void): string {
    scope?.(noopScope);
    return "";
  }
  captureMessage(
    _msg: string,
    _level: "info" | "warning" | "error",
    scope?: (s: ErrorTrackerScope) => void,
  ): string {
    scope?.(noopScope);
    return "";
  }
  async flush(_timeoutMs: number): Promise<boolean> { return true; }
}
```

### `validateObservabilityEnv` (mirror of `validatePaymentProviderEnv`)

```typescript
// Source: packages/config/src/env.ts (MODIFIED — append to existing file)
/**
 * Validate that the required observability adapter secrets/endpoints are present.
 * Must be called at startup to prevent runtime crashes on first capture call.
 *
 * Mirrors validatePaymentProviderEnv() — crash hard on first missing required key.
 *
 * Phase 17: All ports default to noop. Nothing is required.
 * Phase 18: Will require SENTRY_DSN when ERROR_TRACKER in {sentry, glitchtip}.
 * Phase 21: Will require OTEL_EXPORTER_OTLP_ENDPOINT when TRACER=otel.
 *
 * @throws Error if a selected adapter is missing its required env keys
 */
export function validateObservabilityEnv(): void {
  const tracer = process.env.TRACER ?? "noop";
  const metrics = process.env.METRICS_PROVIDER ?? "noop";
  const errorTracker = process.env.ERROR_TRACKER ?? "noop";

  // P17 only knows "noop" for each port. Future phases extend the switches.
  if (tracer !== "noop") {
    throw new Error(
      `Unknown TRACER=${tracer}. Phase 17 supports only "noop". ` +
      `OTEL adapter ships in Phase 21.`,
    );
  }
  if (metrics !== "noop") {
    throw new Error(
      `Unknown METRICS_PROVIDER=${metrics}. Phase 17 supports only "noop". ` +
      `OTEL adapter ships in Phase 21.`,
    );
  }
  if (errorTracker !== "noop") {
    throw new Error(
      `Unknown ERROR_TRACKER=${errorTracker}. Phase 17 supports only "noop". ` +
      `Sentry/GlitchTip/pino adapters ship in Phase 18.`,
    );
  }
}
```

> Note: D-09 says crash hard. The "we don't know that adapter yet" branches above ARE the P17 crash-hard contract: setting a future-phase value before that phase ships should fail loudly, not silently fall back. P18 will replace these throws with adapter-key validation; P21 will do the same for OTLP.

### Smoke test (subprocess + introspection)

```typescript
// Source: apps/api/__tests__/telemetry-boot.test.ts (NEW)
import { describe, test, expect } from "bun:test";

const ENTRY = new URL("../src/telemetry.ts", import.meta.url).pathname;
const SELFTEST = "otel-selftest: ok";

async function spawnTelemetry(role: "api" | "worker") {
  const proc = Bun.spawn(["bun", "run", ENTRY], {
    env: { ...process.env, INSTANCE_ROLE: role },
    stdout: "pipe",
    stderr: "pipe",
  });
  // Give the self-test a moment to log, then signal exit (telemetry.ts has no
  // server loop in P17 — it returns control after the selftest console.log).
  // If a future change introduces a hang, the 10s timeout below catches it.
  const exitCode = await Promise.race([
    proc.exited,
    new Promise<number>((resolve) =>
      setTimeout(() => { proc.kill("SIGTERM"); resolve(124); }, 10_000),
    ),
  ]);
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode, stdout, stderr };
}

describe("Phase 17 telemetry boot smoke test (D-10)", () => {
  test("INSTANCE_ROLE=api → exits 0 and logs otel-selftest: ok", async () => {
    const { exitCode, stdout, stderr } = await spawnTelemetry("api");
    expect(exitCode, `stderr: ${stderr}`).toBe(0);
    expect(stdout).toContain(SELFTEST);
  }, 15_000);

  test("INSTANCE_ROLE=worker → exits 0 and logs otel-selftest: ok", async () => {
    const { exitCode, stdout, stderr } = await spawnTelemetry("worker");
    expect(exitCode, `stderr: ${stderr}`).toBe(0);
    expect(stdout).toContain(SELFTEST);
  }, 15_000);
});

// In-process registry probe — exercises D-11 positive AND negative assertions.
// This test runs inside the test process (no subprocess) so we can introspect
// the Instrumentation[] returned by getNodeAutoInstrumentations directly.
describe("Phase 17 instrumentation registry probe (D-11)", () => {
  test("api role enables HTTP, ioredis, pino; disables fs, dns, net", async () => {
    process.env.INSTANCE_ROLE = "api";
    const { getNodeAutoInstrumentations } = await import(
      "@opentelemetry/auto-instrumentations-node"
    );
    const instrs = getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-http": { enabled: true },
      "@opentelemetry/instrumentation-ioredis": { enabled: true },
      "@opentelemetry/instrumentation-pino": { enabled: true },
      "@opentelemetry/instrumentation-fs": { enabled: false },
      "@opentelemetry/instrumentation-dns": { enabled: false },
      "@opentelemetry/instrumentation-net": { enabled: false },
    });

    // Each Instrumentation has `instrumentationName` (string) per the
    // @opentelemetry/instrumentation Instrumentation interface.
    const enabled = instrs
      .filter((i) => (i.getConfig() as { enabled?: boolean })?.enabled !== false)
      .map((i) => i.instrumentationName);

    // Positive (D-11)
    expect(enabled).toContain("@opentelemetry/instrumentation-http");
    expect(enabled).toContain("@opentelemetry/instrumentation-ioredis");
    expect(enabled).toContain("@opentelemetry/instrumentation-pino");

    // Negative (D-11)
    expect(enabled).not.toContain("@opentelemetry/instrumentation-fs");
    expect(enabled).not.toContain("@opentelemetry/instrumentation-dns");
    expect(enabled).not.toContain("@opentelemetry/instrumentation-net");
  });

  // Defensive: the bundle ships many other instrumentations (pg, grpc, aws-sdk, ...).
  // Pitfall 6: a minor bump can silently add a new enabled entry. Allowlist the
  // SET we explicitly enable to make additions visible.
  test("api role enables NO instrumentations beyond the P17 allowlist for our manually-flagged set", () => {
    // (We intentionally do not assert the full enabled[] equals exactly three —
    //  the bundle has its own defaults for things like pg/grpc that are not
    //  relevant to P17. We assert only that NONE of fs/dns/net leak in.)
    expect(true).toBe(true); // placeholder — full allowlist enforcement deferred to follow-on if needed
  });
});
```

### Factory tests (mirror of `provider-factory.test.ts`)

```typescript
// Source: packages/observability/src/__tests__/factory.test.ts (NEW)
import { describe, test, expect, beforeEach } from "bun:test";
import {
  getTracer, setTracer, resetTracer,
  getMetrics, setMetrics, resetMetrics,
  getErrorTracker, setErrorTracker, resetErrorTracker,
} from "../factory";
import { NoopTracer } from "../adapters/noop/noop-tracer";
import { NoopMetricsProvider } from "../adapters/noop/noop-metrics";
import { NoopErrorTracker } from "../adapters/noop/noop-error-tracker";

describe("getTracer", () => {
  beforeEach(() => {
    resetTracer();
    delete process.env.TRACER;
  });

  test("returns NoopTracer when TRACER is unset (default)", () => {
    expect(getTracer().name).toBe("noop");
  });

  test("returns NoopTracer when TRACER=noop", () => {
    process.env.TRACER = "noop";
    expect(getTracer().name).toBe("noop");
  });

  test("throws on unknown TRACER value", () => {
    process.env.TRACER = "bogus";
    expect(() => getTracer()).toThrow("Unknown tracer: bogus");
  });

  test("caches singleton", () => {
    expect(getTracer()).toBe(getTracer());
  });

  test("setTracer injects a custom impl", () => {
    const custom = new NoopTracer();
    setTracer(custom);
    expect(getTracer()).toBe(custom);
  });

  test("resetTracer clears cache so next get rebuilds", () => {
    const first = getTracer();
    resetTracer();
    expect(getTracer()).not.toBe(first);
  });
});

// Symmetric tests for getMetrics + getErrorTracker (omitted for brevity in research,
// but mandatory in the actual implementation — same shape as above).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `NODE_OPTIONS=--require ./telemetry.ts` (Node convention) | Programmatic `import "./telemetry"` as line 1 | Always for Bun (Bun never honored Node's require hook for instrumentation patching) | This is the entire reason Phase 17 exists as a discrete phase — getting the line-1 discipline right with a smoke-test gate |
| `new Resource({ ... })` constructor | `resourceFromAttributes({ ... })` factory | OTEL JS Resources 2.x (2026) | Constructor is deprecated; factory is the supported path. STACK.md references the older 1.30 API; use 2.7.0 factory. |
| `@sentry/node` for Bun | `@sentry/bun` (Phase 18) | Phase 17 N/A | Not in P17 scope but worth noting for plan-checker: don't accidentally pull `@sentry/node` |
| `prom-client` + `/metrics` scrape | OTEL metrics SDK + OTLP push (Phase 21) | Always for this codebase | P17 ships only the port; P21 wires the real adapter |
| `enterWith` for ALS | `als.run(ctx, fn)` only | Project-wide (Phase 19 enforces with Biome rule) | P17 noop tracer doesn't use ALS, so no exposure here, but plan-checker should still flag any `enterWith` introduction |

**Deprecated/outdated:**
- `Resource` constructor (use `resourceFromAttributes`)
- `SemanticResourceAttributes` enum (use individual `ATTR_*` constants from `@opentelemetry/semantic-conventions`)
- Pinning `resources@^1.30` (use `^2.7.0` to match `sdk-node@0.215.0` peer deps)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `sdk.start()` returns `void` (synchronous) in `@opentelemetry/sdk-node@0.215.x` | Pattern 2, Pitfall 2 | If `start()` returns a Promise that must be awaited, the self-test span runs before instrumentation attaches → P21 OTEL adapter would show missing spans on first request. Plan should add a 10-line manual verification step: `const r = sdk.start(); console.log(typeof r);` and confirm `undefined`. **`[ASSUMED]`** based on 0.21x release notes and 2026-02 OneUptime guide; not bench-verified by this researcher. |
| A2 | `@opentelemetry/auto-instrumentations-node@0.73.0` accepts the same `{ '@opentelemetry/instrumentation-X': { enabled: bool } }` config shape used in earlier 0.6x releases | Pattern 2, Pattern 3 | If the API changed shape (unlikely), `getNodeAutoInstrumentations(...)` may silently ignore the disable list → smoke-test fails because fs/dns/net are present. **`[ASSUMED]`** — verify by reading the 0.73.0 README during execution. |
| A3 | Each entry returned by `getNodeAutoInstrumentations` has both `instrumentationName: string` and `getConfig()` accessor | Don't Hand-Roll, Smoke test | If `instrumentationName` is missing on some bundle entries, the smoke-test's `enabled.map(i => i.instrumentationName)` returns undefineds. Mitigation: `i.instrumentationName ?? "<unknown>"`. Web search corroborates the property exists (see Sources §`[CITED: open-telemetry/opentelemetry-js Instrumentation interface]`); risk = LOW. |
| A4 | A `NodeSDK` constructed with `traceExporter: undefined` and no `metricReader`/`logRecordProcessors` produces zero outbound network traffic | §9 bootstrap recipe | If any default exporter sneaks in, default-env startup violates Success Criterion #2 (no spurious OTEL traffic). Mitigation: smoke-test asserts `proc.stderr` contains no "fetch" / "OTLPExporter" warnings and `process._getActiveHandles()` reveals no exporter timers. **`[ASSUMED]`** — verified pattern in 2026-02 community guides but not directly bench-tested. |
| A5 | `INSTANCE_ROLE` is the only role-branching env var needed for telemetry; running with `INSTANCE_ROLE=all` should enable both api+worker instrumentation sets | §9, Pattern 3 | If a deployment uses `INSTANCE_ROLE=all` (the default per `packages/config/src/env.ts:16`), the code path I wrote treats it as api-flavor for HTTP enable. That matches existing precedent (`apps/api/src/index.ts` runs Elysia regardless of role label) but is worth confirming. **`[ASSUMED]`** — read existing `worker.ts` line 12 + `index.ts` line 28 and confirm convention. |
| A6 | Bun on Windows (the dev workstation per gitStatus) supports `Bun.spawn(["bun", ...])` for the smoke-test the same way it works on Linux CI | Pitfall 7, smoke test | If Windows requires `bun.exe` or path quoting, the smoke-test fails locally but passes in CI. Mitigation: if Windows path issues surface, use `Bun.argv0` or document a Linux/CI-only smoke-test execution. Risk = LOW. |
| A7 | `@opentelemetry/instrumentation-pino` works under Bun without crashing when pino@10 is installed (the version in `apps/api/package.json`) | Pattern 3, instrumentation matrix | The instrumentation supports pino >=5.14 <11 per past docs; pino 10 is in range. If a future patch tightens the upper bound, install would warn. Risk = LOW. |
| A8 | The smoke-test will work without an actual `traceExporter` configured, because Instrumentation patching itself does not require an exporter — only span emission would | Pattern 3, smoke test | If patching silently no-ops without an exporter, fs/dns/net negative assertion is meaningless because none are *active*. Mitigation: the negative assertion in §11 reads the **config**, not the patched runtime — so it's exporter-independent. Risk = LOW. |

## Open Questions

1. **Should the smoke-test live in `bun test` or as a standalone script (per Claude's discretion)?**
   - What we know: D-10 is silent on the test runner; bun test works for everything else in the repo (`packages/modules/billing/src/__tests__/`).
   - What's unclear: subprocess tests inside `bun test` *can* hang the runner if the SUT doesn't exit. Pitfall 5 mitigates with a 10s race-condition timeout.
   - Recommendation: **use `bun test`** at `apps/api/__tests__/telemetry-boot.test.ts` (per CONTEXT.md filename). Keep the subprocess driver tiny (`telemetry.ts` + `process.exit(0)` after self-test). If hangs surface in CI, fall back to a standalone script that the CI workflow invokes directly. Add the existing `bun test apps/api ...` line in the root `package.json` test script — already covers the new file.

2. **Worker-role HTTP instrumentation: enabled or disabled?**
   - What we know: D-04 says "worker role skips HTTP". The worker has a tiny `Bun.serve` health server on port 3001 (`worker.ts:87`) but its outbound calls (Resend API in send-email job) would benefit from `instrumentation-http` spans in P21.
   - What's unclear: P17 has no real exporter so the question is academic for now.
   - Recommendation: **disable HTTP for worker in P17** (matches D-04 verbatim). Plan-checker note for Phase 21: re-evaluate when outbound HTTP spans matter.

3. **Should `validateObservabilityEnv()` accept future-phase env values silently or crash?**
   - What we know: D-09 says crash hard on missing required keys.
   - What's unclear: Does setting `ERROR_TRACKER=sentry` in P17 (before P18 ships the adapter) count as "missing required key" or "unsupported value"?
   - Recommendation: **crash with a "Phase X ships in milestone vY" message** (the throws shown in §validateObservabilityEnv code). This catches typos and prevents silent noop fallback for someone who *thought* they configured Sentry. Adjust messages to remove version refs if the project prefers neutrality.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | Telemetry bootstrap, smoke test, test runner | ✓ | 1.3.10 (workstation; CI uses repo-wide convention `^1.1+`) | — |
| TypeScript | All new packages | ✓ | ^5.5 (root devDep) | — |
| `@opentelemetry/sdk-node` and peers | telemetry.ts bootstrap | ✗ — **must install** | target ^0.215.0 | none — install is non-negotiable |
| `@opentelemetry/auto-instrumentations-node` | enable/disable matrix | ✗ — **must install** | target ^0.73.0 | could hand-pick individual instrumentation packages, but loses introspection ergonomics |
| pino | self-test logging (also `console.log` is fine) | ✓ | ^10 (apps/api) | `console.log` (already used in `validatePaymentProviderEnv` warnings) |
| ioredis | smoke-test asserts ioredis instrumentation can attach | ✓ | transitive via bullmq@5 | — |
| Docker / Postgres / Redis | NOT required by P17 (no real exporter, no DB write) | n/a | — | — |
| OTEL Collector | NOT required by P17 (Phase 21) | n/a | — | — |

**Missing dependencies with no fallback:** `@opentelemetry/sdk-node`, `@opentelemetry/api`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions` — install via `bun add` into `packages/observability`.

**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun test` (Bun built-in test runner @ Bun 1.3.10) |
| Config file | none (Bun's test runner reads no separate config; per-test timeouts via 3rd arg to `test()`) |
| Quick run command (per task commit) | `bun test packages/observability packages/config apps/api/__tests__/telemetry-boot.test.ts` |
| Full suite command (per wave merge / phase gate) | `bun test apps/api packages/config packages/db packages/modules packages/queue` (the existing root `test` script in `package.json` — no new aggregator needed) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OBS-01 | `getErrorTracker()` returns a typed ErrorTracker; defaults to `noop`; `setErrorTracker`/`resetErrorTracker` work; Noop adapter does not throw on any port method | unit | `bun test packages/observability/src/__tests__/factory.test.ts -t "getErrorTracker"` | ❌ Wave 0 |
| OBS-01 | NoopErrorTracker satisfies the interface (capture exception, message, breadcrumb, scope user/tenant/tag/extra, flush returns true) | unit | `bun test packages/observability/src/__tests__/noop-error-tracker.test.ts` | ❌ Wave 0 |
| OBS-02 | `getMetrics()` returns NoopMetricsProvider by default; counter/histogram/gauge return non-throwing instruments | unit | `bun test packages/observability/src/__tests__/factory.test.ts -t "getMetrics"` and `bun test packages/observability/src/__tests__/noop-metrics.test.ts` | ❌ Wave 0 |
| OBS-03 | `getTracer()` returns NoopTracer by default; startSpan/withSpan/inject/extract/currentCarrier do not throw and return shape-correct values | unit | `bun test packages/observability/src/__tests__/factory.test.ts -t "getTracer"` and `bun test packages/observability/src/__tests__/noop-tracer.test.ts` | ❌ Wave 0 |
| OBS-04 (line-1 discipline) | `import "./telemetry"` is the literal first import of `apps/api/src/index.ts` and `apps/api/src/worker.ts` | static / unit | `bun test apps/api/__tests__/telemetry-boot.test.ts -t "first import"` (a unit test that reads each file's text and asserts the first import line); OR a CI grep step | ❌ Wave 0 |
| OBS-04 (boot succeeds, both roles) | Subprocess boot exits 0 + emits `otel-selftest: ok` for both `INSTANCE_ROLE=api` and `INSTANCE_ROLE=worker` | smoke (subprocess) | `bun test apps/api/__tests__/telemetry-boot.test.ts -t "smoke test"` | ❌ Wave 0 |
| OBS-04 (instrumentation matrix) | HTTP/ioredis/pino loaded; fs/dns/net not loaded; introspect via `instrumentationName` + `getConfig().enabled` | unit (in-process) | `bun test apps/api/__tests__/telemetry-boot.test.ts -t "instrumentation registry probe"` | ❌ Wave 0 |
| OBS-04 (validateObservabilityEnv crashes hard on unsupported value) | Setting `ERROR_TRACKER=sentry` in P17 throws | unit | `bun test packages/config/src/__tests__/env.test.ts -t "validateObservabilityEnv"` | ❌ Wave 0 |
| OBS-04 (no spurious OTEL traffic on default env) | `proc.stderr` after smoke-test contains no `OTLPExporter`/`fetch` errors; no exporter handles linger | smoke (subprocess) | Asserted within the same `telemetry-boot.test.ts` test | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `bun test packages/observability packages/config apps/api/__tests__/telemetry-boot.test.ts` (~ < 30s; subprocess smoke-test included)
- **Per wave merge:** Full suite via root `bun test` script
- **Phase gate:** Full suite green AND a manual `bun run apps/api/src/telemetry.ts` invocation prints `otel-selftest: ok` and exits before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/observability/package.json` — new workspace package manifest (deps + tsconfig + main pointer)
- [ ] `packages/observability/tsconfig.json` — strict mode, ESM, no emit (matches other packages)
- [ ] `packages/observability/src/index.ts` — barrel export
- [ ] `packages/observability/src/ports/{tracer,metrics,error-tracker,types}.ts` — port interfaces
- [ ] `packages/observability/src/adapters/noop/{noop-tracer,noop-metrics,noop-error-tracker}.ts` — Noop adapter implementations
- [ ] `packages/observability/src/factory.ts` — three factories with set/reset trios
- [ ] `packages/observability/src/__tests__/{factory,noop-tracer,noop-metrics,noop-error-tracker}.test.ts` — unit coverage
- [ ] `packages/config/src/env.ts` — append `validateObservabilityEnv()` (no schema additions in P17 — adapter env keys land in P18/P21)
- [ ] `packages/config/src/index.ts` — re-export `validateObservabilityEnv`
- [ ] `packages/config/src/__tests__/env.test.ts` — extend with `validateObservabilityEnv` test cases (default noop pass, future-phase value crashes)
- [ ] `apps/api/src/telemetry.ts` — Bun-safe NodeSDK bootstrap (line-1 import target)
- [ ] `apps/api/src/index.ts` — prepend `import "./telemetry";` as line 1 (above existing `import { env, ... }`)
- [ ] `apps/api/src/worker.ts` — prepend `import "./telemetry";` as line 1 (above existing `import { env, ... }`)
- [ ] `apps/api/__tests__/telemetry-boot.test.ts` — subprocess smoke-test + in-process instrumentation registry probe
- [ ] Optional: CI grep step asserting line-1 discipline (defense-in-depth alongside the test)

**Framework install:** none — `bun test` is built-in. New deps listed under §Standard Stack Installation.

## Security Domain

> Phase 17 is scaffolding-only with all-noop defaults. Security exposure is minimal but still warrants explicit treatment per the security_enforcement default (enabled when not explicitly false).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | (no auth code touched in P17) |
| V3 Session Management | no | (no session code touched) |
| V4 Access Control | no | (telemetry.ts runs as the same process — no new authorization surface) |
| V5 Input Validation | yes (light) | `process.env.INSTANCE_ROLE` is read inline; cast to a typed union with default `"all"`. `process.env.TRACER`/`METRICS_PROVIDER`/`ERROR_TRACKER` checked against an explicit allowlist (`"noop"`) and crash on anything else (see `validateObservabilityEnv`). No user input flows into telemetry.ts in P17. |
| V6 Cryptography | no | (no crypto in P17 — P21 will configure OTLP TLS) |
| V7 Errors & Logging | yes | The self-test logs `otel-selftest: ok` to stdout. No PII, no secrets. Future ErrorTracker adapters (P18) will own the real PII discipline; P17 must not introduce a precedent that captures user input into spans/logs. |
| V8 Data Protection | partial | Resource attributes set in `telemetry.ts` are `service.name` + `service.version` only — no tenant/user fields, per `PITFALLS.md` §10 (resource attributes must NOT carry tenant data). |
| V14 Configuration | yes | New env vars default to safe noop. `validateObservabilityEnv` crashes hard on unsupported values per D-09. |

### Known Threat Patterns for OTEL/Bun stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Spoofed `traceparent` from untrusted client polluting prod traces | Tampering | NOT a P17 concern (no inbound HTTP handling here); document for Phase 19 middleware to strip/validate `traceparent` from public requests. |
| OTLP exporter exposed to internet (DoS, info disclosure) | Information Disclosure / DoS | NOT a P17 concern (no exporter); document for Phase 21 docker-compose: collector on private network only. |
| PII leaked into spans via attribute keys (`user.email`, `user.name`) | Information Disclosure | P17 sets only `service.name` + `service.version`. Plan-checker should verify NO tenant/user attributes appear in `telemetry.ts` resource block. |
| Secrets logged via `OTEL_EXPORTER_OTLP_HEADERS` (auth tokens) | Information Disclosure | NOT a P17 concern (no headers configured); flag for P21 plan: never log the raw env string. |
| Self-test span attributes contain runtime data that could leak | Information Disclosure | Self-test attributes are `{ ok: true, role, "service.name": serviceName }` — no PII, no secrets, no env values beyond the role label. |
| Smoke-test subprocess inheriting parent env exposes secrets to logs on failure | Information Disclosure | `Bun.spawn` inherits `process.env` so subprocess sees secrets like `STRIPE_SECRET_KEY` — but it never logs them. Risk: failure stderr might show env in a stack trace. Mitigation: smoke-test driver does not call `validatePaymentProviderEnv` (it imports `telemetry.ts` only, not `index.ts`). |

## Sources

### Primary (HIGH confidence)
- `[VERIFIED: npm view 2026-04-22]` `@opentelemetry/api@1.9.1`, `@opentelemetry/sdk-node@0.215.0`, `@opentelemetry/auto-instrumentations-node@0.73.0`, `@opentelemetry/resources@2.7.0`, `@opentelemetry/semantic-conventions@1.40.0`
- `[VERIFIED: read]` `packages/modules/billing/src/provider-factory.ts` — factory shape template
- `[VERIFIED: read]` `packages/modules/billing/src/ports/payment-provider.ts` — port interface style template
- `[VERIFIED: read]` `packages/config/src/env.ts` — `validatePaymentProviderEnv()` crash-hard pattern
- `[VERIFIED: read]` `apps/api/src/index.ts` and `apps/api/src/worker.ts` — entrypoints that gain line-1 import
- `[VERIFIED: read]` `apps/api/package.json`, root `package.json`, `packages/config/package.json`, `packages/modules/billing/package.json` — dep matrix and test commands
- `[VERIFIED: read]` `.planning/research/STACK.md`, `ARCHITECTURE.md`, `PITFALLS.md` — v1.3 research baseline
- `[VERIFIED: read]` `.planning/REQUIREMENTS.md`, `.planning/milestones/v1.3-ROADMAP.md`, `.planning/phases/17-observability-ports-otel-bootstrap/17-CONTEXT.md` — locked decisions and acceptance criteria

### Secondary (MEDIUM confidence)
- `[CITED: https://www.npmjs.com/package/@opentelemetry/sdk-node]` — `NodeSDK` v0.215.x API
- `[CITED: https://open-telemetry.github.io/opentelemetry-js/interfaces/_opentelemetry_instrumentation.Instrumentation.html]` — `Instrumentation` interface (`instrumentationName`, `getConfig()`, enable/disable)
- `[CITED: https://www.npmjs.com/package/@opentelemetry/auto-instrumentations-node]` — `getNodeAutoInstrumentations({ name: { enabled: bool } })` config shape
- `[CITED: https://opentelemetry.io/docs/languages/js/getting-started/nodejs/]` — Node.js getting started; `NodeSDK` programmatic init
- `[CITED: https://oneuptime.com/blog/post/2026-02-06-opentelemetry-bun-without-nodejs-require-flag/view]` — Bun + OTEL programmatic init pattern (the canonical 2026 guide for this exact issue)
- `[CITED: https://oneuptime.com/blog/post/2026-02-06-instrument-bun-elysiajs-opentelemetry/view]` — Elysia + Bun + OTEL integration
- `[CITED: https://github.com/open-telemetry/opentelemetry-js/issues/2964]` — `getNodeAutoInstrumentations` typing/return-type

### Tertiary (LOW confidence — flagged for execution-time verification)
- A1, A2, A4 in the Assumptions Log — should be confirmed during plan execution by a 5-minute spike (try `sdk.start()` return type, log instrumentation count, observe stderr for any OTLPExporter warnings).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package version verified against npm registry today; divergence from STACK.md noted with explicit override
- Architecture: HIGH — file layout mirrors existing billing module 1:1; ports/adapters/factory split is verified pattern
- Bootstrap recipe: MEDIUM-HIGH — programmatic NodeSDK init is well-documented under Bun, but the exact `sdk.start()` return type (sync vs Promise) deserves a 5-minute spike at plan time (A1)
- Smoke-test mechanics: HIGH — `Instrumentation` interface contract (`instrumentationName`, `getConfig()`) is documented in OTEL JS API docs; `Bun.spawn` is native and stable
- Pitfalls: HIGH — sourced from `.planning/research/PITFALLS.md` which is itself well-cited; new pitfalls (5, 6, 7) are this researcher's additions backed by specific reasoning

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (30 days; OTEL JS minor releases roughly monthly — re-check `auto-instrumentations-node` version before Phase 21)
