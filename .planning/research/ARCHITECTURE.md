# Architecture Research

**Domain:** Observability & Operations layer for an existing modular SaaS starter (Baseworks v1.3)
**Researched:** 2026-04-21
**Confidence:** HIGH for integration points with existing code (read directly); MEDIUM for OTEL+Bun runtime specifics; MEDIUM for bull-board mount pattern (official `@bull-board/elysia` adapter exists, v7.0.0 confirmed).

---

## 1. Core Design Principle

v1.3 observability is **additive to the existing architecture**, not a replacement. Three guiding rules:

1. **Mirror the PaymentProvider port/adapter pattern exactly.** It lives in `packages/modules/billing/src/ports/` + `adapters/*/`, is selected at startup by a factory reading env (`getPaymentProvider()` in `provider-factory.ts`), and supports a test-injection escape hatch (`setPaymentProvider`). v1.3 ports follow this template byte-for-byte.
2. **Pino stays the log surface.** `ErrorTracker` is a *sink* that tees from pino hooks, not a replacement. Every existing `logger.info/error` call keeps working. Trace IDs get *mixed in* via pino mixin, not via a new logger.
3. **Noop adapters ship with every port.** Fork users must be able to run Baseworks with no observability vendors configured. `METRICS_PROVIDER=noop`, `TRACER=noop`, `ERROR_TRACKER=pino` (default) all produce a working system with zero external dependencies.

---

## 2. System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        HTTP (Elysia app chain)                       │
│                                                                       │
│  errorMiddleware → requestTraceMiddleware → observabilityMiddleware   │
│                      │                          │                     │
│                      │ (adds requestId)         │ (opens root span,   │
│                      │                          │  seeds ALS context) │
│                      ▼                          ▼                     │
├──────────────────────────────────────────────────────────────────────┤
│                AsyncLocalStorage context carrier                      │
│        { requestId, traceId, spanId, tenantId, userId }              │
├──────────────────────────────────────────────────────────────────────┤
│                         Application Layer                             │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────────┐ │
│  │   CqrsBus    │──▶│ TypedEventBus│──▶│ BullMQ enqueue (Queue)   │ │
│  │ (tracer wrap)│   │ (tracer wrap)│   │ (inject carrier in data) │ │
│  └──────┬───────┘   └──────────────┘   └──────────┬───────────────┘ │
│         │                                          │                 │
│         ▼                                          │                 │
│  ┌──────────────┐                                  │                 │
│  │   ScopedDb   │                                  │                 │
│  │ (Drizzle,    │                                  │                 │
│  │  query span) │                                  │                 │
│  └──────────────┘                                  │                 │
├─────────────────────────────────────────────────────┼────────────────┤
│                       Worker entrypoint              │                │
│  ┌───────────────────────────────────────────────────▼────────────┐ │
│  │  createWorker → on(job) → extract carrier → ALS.run(ctx)       │ │
│  │                         → tracer.startSpan("worker.process")    │ │
│  │                         → jobDef.handler(data)                  │ │
│  └──────────────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────────┤
│                   Observability Backends (pluggable)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │  Tracer port │  │ Metrics port │  │ErrorTracker  │  │ Pino     │ │
│  │  - otel      │  │  - otel      │  │  - sentry    │  │ (always) │ │
│  │  - noop      │  │  - noop      │  │  - glitchtip │  │          │ │
│  │              │  │              │  │  - pino      │  │          │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────────┘ │
│         │                 │                 │                        │
│         ▼                 ▼                 ▼                        │
│   OTLP → Tempo        OTLP → Prom       Sentry/GlitchTip/stdout     │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | New or Modified |
|-----------|----------------|-----------------|
| `Tracer` port | Create spans; open/close; set attributes; extract/inject carriers | **New** |
| `MetricsProvider` port | Counters, histograms, gauges; pre-built bundles (HTTP, DB, queue) | **New** |
| `ErrorTracker` port | `captureException`, `captureMessage`, scoped user/tenant tags | **New** |
| `observability-context` (ALS wrapper) | Single AsyncLocalStorage keyed by `{requestId, traceId, spanId, tenantId, userId}` | **New** |
| `observabilityMiddleware` | Opens root span per request, seeds ALS, sets tenant/user tags on span | **New** |
| `requestTraceMiddleware` | Already emits `requestId`; now *also* reads ALS for trace correlation | **Modified** (minor: add trace fields to log output) |
| `CqrsBus.execute/query` | Wrap handler invocation in `tracer.startSpan("cqrs.{name}")`; record success/fail as span status | **Modified** (external wrapper, not core file change) |
| `TypedEventBus.emit` | Open span `"event.{name}"` spanning all listeners; listeners inherit context | **Modified** (external wrapper) |
| `createQueue`/`createWorker` | Queue wraps `add()` to serialize trace carrier into `job.data._otel`; Worker extracts carrier, runs handler inside `ALS.run` + span | **Modified** |
| `ScopedDb`/`createDb` | Wrap `db.execute` / query entry points with `"db.query"` span; capture SQL text (redacted), rows, duration | **Modified** |
| `logger` (pino) | Add `mixin` that injects `traceId`/`spanId` from ALS into every log line | **Modified** (one-line pino config change) |
| `errorMiddleware` | Calls `errorTracker.captureException()` in the default (500) branch before returning | **Modified** |
| Admin bull-board mount | Elysia sub-app gated by `requireRole("owner")`, iframe-embedded in admin SPA | **New** |
| Admin health dashboard aggregator | `GET /api/admin/observability/health` aggregates module contributions | **New** |

---

## 3. Recommended Project Structure

Two homes for observability code, mirroring the existing split between *infrastructure* (core) and *feature modules*:

```
apps/api/src/
├── core/
│   ├── observability/                    # [NEW] Core infra, wired at startup
│   │   ├── context.ts                    # AsyncLocalStorage<ObsContext>
│   │   ├── middleware.ts                 # observabilityMiddleware (Elysia)
│   │   ├── cqrs-wrapper.ts               # wrapCqrsBus(bus, tracer, metrics)
│   │   ├── event-bus-wrapper.ts          # wrapEventBus(bus, tracer)
│   │   ├── queue-instrumentation.ts      # injectCarrier / extractCarrier / wrapQueue
│   │   ├── db-instrumentation.ts         # wrapDb(rawDb, tracer)
│   │   ├── pino-mixin.ts                 # trace-ID pino mixin
│   │   └── bull-board.ts                 # createBullBoardPlugin(queues, auth)
│   ├── cqrs.ts                           # [unchanged — wrapping is external]
│   ├── event-bus.ts                      # [unchanged]
│   └── registry.ts                       # [modified — see §5]
│
├── lib/
│   └── logger.ts                         # [modified — add mixin]
│
└── index.ts                              # [modified — wire observability first]

packages/
├── observability/                        # [NEW] Ports + adapters package
│   ├── package.json
│   └── src/
│       ├── index.ts
│       ├── ports/
│       │   ├── tracer.ts                 # interface Tracer
│       │   ├── metrics.ts                # interface MetricsProvider
│       │   ├── error-tracker.ts          # interface ErrorTracker
│       │   └── types.ts                  # Span, Carrier, Attributes, ...
│       ├── adapters/
│       │   ├── otel/
│       │   │   ├── otel-tracer.ts
│       │   │   ├── otel-metrics.ts
│       │   │   └── otel-sdk.ts           # programmatic SDK init (Bun-safe)
│       │   ├── sentry/
│       │   │   └── sentry-error-tracker.ts
│       │   ├── glitchtip/
│       │   │   └── glitchtip-error-tracker.ts
│       │   ├── pino/
│       │   │   └── pino-error-tracker.ts # tees to existing pino
│       │   └── noop/
│       │       ├── noop-tracer.ts
│       │       ├── noop-metrics.ts
│       │       └── noop-error-tracker.ts
│       ├── factory.ts                    # getTracer() / getMetrics() / getErrorTracker()
│       └── metrics/
│           ├── http-metrics.ts           # pre-built histograms + counters
│           ├── db-metrics.ts
│           ├── queue-metrics.ts
│           └── cqrs-metrics.ts
│
└── modules/
    └── observability/                    # [NEW] Thin module
        ├── package.json
        └── src/
            ├── index.ts                  # ModuleDefinition (admin queries only)
            ├── queries/
            │   ├── get-system-health.ts  # aggregates module contributions
            │   ├── get-queue-stats.ts
            │   └── get-recent-errors.ts
            └── health/
                └── contributor-registry.ts

apps/admin/src/routes/system/
├── job-monitor.tsx                       # iframe-embeds /admin/bull-board
├── health.tsx                            # [exists] extend to consume new queries
└── traces.tsx                            # [NEW] recent error/span list

docs/
├── runbooks/                             # [NEW]
│   ├── stripe-webhook-failure.md
│   ├── worker-stuck.md
│   ├── db-lag.md
│   └── index.md
└── observability/                        # [NEW]
    ├── architecture.md
    ├── grafana-alerts.yaml
    ├── sentry-alerts.json
    └── local-stack.md

docker-compose.observability.yml          # [NEW] Prometheus + Tempo + Loki + Grafana
```

### Structure Rationale

- **`packages/observability/` (new package)**: Holds ports + adapters. Must not depend on `apps/api`, `packages/modules/*`, or `@baseworks/db` — those depend *on it*. This matches how `packages/modules/billing/src/ports/` contains the `PaymentProvider` interface with no back-references. Splitting into its own package (vs nesting under a module) is the right call because *every* module needs tracing/metrics; it is infrastructure, not a feature.
- **`apps/api/src/core/observability/` (wrappers + wiring)**: Holds the *wrappers* around CqrsBus, EventBus, queue, DB. These are app-layer concerns: they know about Elysia, AsyncLocalStorage, and the specific shape of `HandlerContext`. They import from `packages/observability` but not vice versa.
- **`packages/modules/observability/` (admin queries)**: A thin CQRS module exposing *queries only* for the admin dashboard (`observability:get-system-health`, `observability:get-queue-stats`, `observability:get-recent-errors`). No commands — observability produces read-only telemetry from the operator's perspective. This keeps the admin UI's data access uniform with every other admin screen (all go through CQRS).
- **`docs/runbooks/` and `docs/observability/`**: Runbook content is durable, version-controlled, and links from alert payloads (`runbook_url: https://github.com/.../docs/runbooks/stripe-webhook-failure.md`). Alert templates (YAML/JSON) are copy-paste starting points, not a runtime feature.

---

## 4. Port Signatures (Concrete TypeScript)

**File: `packages/observability/src/ports/types.ts`**
```typescript
export type Attributes = Record<string, string | number | boolean | undefined>;

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
  traceparent: string;      // "00-<traceid>-<spanid>-<flags>"
  tracestate?: string;
  requestId: string;
  tenantId?: string;
  userId?: string;
}

export interface SpanOptions {
  kind?: "internal" | "server" | "client" | "producer" | "consumer";
  attributes?: Attributes;
  /** Resume a parent span from an incoming carrier (e.g., BullMQ job). */
  parent?: TraceCarrier;
}
```

**File: `packages/observability/src/ports/tracer.ts`**
```typescript
import type { Span, SpanOptions, TraceCarrier } from "./types";

export interface Tracer {
  readonly name: string;
  /** Start a span synchronously. Caller is responsible for calling span.end(). */
  startSpan(name: string, opts?: SpanOptions): Span;
  /** Run a function inside a span; auto-ends on return/throw. */
  withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T> | T,
    opts?: SpanOptions,
  ): Promise<T>;
  /** Serialize the current span (from ALS) into a carrier. Null if no active span. */
  currentCarrier(): TraceCarrier | null;
}
```

**File: `packages/observability/src/ports/metrics.ts`**
```typescript
import type { Attributes } from "./types";

export interface Counter { inc(value?: number, attrs?: Attributes): void; }
export interface Histogram { observe(value: number, attrs?: Attributes): void; }
export interface Gauge { set(value: number, attrs?: Attributes): void; }

export interface MetricsProvider {
  readonly name: string;
  counter(name: string, description?: string, unit?: string): Counter;
  histogram(name: string, description?: string, unit?: string): Histogram;
  gauge(name: string, description?: string, unit?: string): Gauge;
}
```

**File: `packages/observability/src/ports/error-tracker.ts`**
```typescript
import type { Attributes } from "./types";

export interface ErrorTrackerScope {
  setUser(user: { id: string; email?: string }): void;
  setTenant(tenantId: string): void;
  setTag(key: string, value: string): void;
  setExtra(key: string, value: unknown): void;
}

export interface ErrorTracker {
  readonly name: string;
  captureException(err: unknown, scope?: (s: ErrorTrackerScope) => void): string;
  captureMessage(
    msg: string,
    level: "info" | "warning" | "error",
    scope?: (s: ErrorTrackerScope) => void,
  ): string;
  /** Flush pending events; called during graceful shutdown. */
  flush(timeoutMs: number): Promise<boolean>;
}
```

**File: `packages/observability/src/factory.ts`** (env-based selection, matches `provider-factory.ts`)
```typescript
import { env } from "@baseworks/config";
import type { Tracer, MetricsProvider, ErrorTracker } from "./ports";

let tracerInstance: Tracer | null = null;

export function getTracer(): Tracer {
  if (tracerInstance) return tracerInstance;
  switch (env.TRACER ?? "noop") {
    case "otel": {
      const { OtelTracer } = require("./adapters/otel/otel-tracer");
      tracerInstance = new OtelTracer({
        endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT!,
        serviceName: env.OTEL_SERVICE_NAME ?? "baseworks-api",
      });
      break;
    }
    case "noop":
    default: {
      const { NoopTracer } = require("./adapters/noop/noop-tracer");
      tracerInstance = new NoopTracer();
    }
  }
  return tracerInstance;
}

// Identical pattern for getMetrics() and getErrorTracker()
// getErrorTracker switches: "sentry" | "glitchtip" | "pino" (default)

export function resetObservability(): void {
  tracerInstance = null;
}
```

The factory pattern, singleton, reset-for-tests, and env-driven switch are an exact mirror of `provider-factory.ts` lines 19–95.

---

## 5. Answers to the 10 Integration Questions

### Q1 — Where do the ports live?

**Both, with distinct roles:**

- `packages/observability/` (new root-level package) → ports + adapters. Zero dependencies on modules or apps. Analogous to how `packages/db` is infrastructure.
- `apps/api/src/core/observability/` → wrappers that bind ports to concrete core primitives (CqrsBus, EventBus, BullMQ, Drizzle, Elysia middleware). App-layer concerns only.
- `packages/modules/observability/` (new module) → thin CQRS module exposing admin-facing queries (`get-system-health`, `get-queue-stats`, `get-recent-errors`). No commands.

Why not put ports under `packages/modules/observability/src/ports/` like billing does? Because billing is a self-contained feature — only billing code imports `PaymentProvider`. Observability is cross-cutting — every module needs to emit metrics and spans. Putting the port in a module creates a circular dependency risk (every module would depend on the observability module).

### Q2 — How are adapters selected?

**Env-based startup wiring via singleton factory, identical to `getPaymentProvider()`.**

Env vars, added to `packages/config/src/env.ts`:
```
TRACER=otel|noop                            (default: noop)
METRICS_PROVIDER=otel|noop                  (default: noop)
ERROR_TRACKER=sentry|glitchtip|pino|noop    (default: pino)
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=baseworks-api
SENTRY_DSN=...
GLITCHTIP_DSN=...
```

Startup validation (in `packages/config/src/env.ts`, analogous to `validatePaymentProviderEnv`):
```typescript
export function validateObservabilityEnv(): void {
  if (env.TRACER === "otel" && !env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    throw new Error("OTEL_EXPORTER_OTLP_ENDPOINT required when TRACER=otel");
  }
  if (env.ERROR_TRACKER === "sentry" && !env.SENTRY_DSN) {
    throw new Error("SENTRY_DSN required when ERROR_TRACKER=sentry");
  }
  // ...
}
```

Called from `apps/api/src/index.ts` and `apps/api/src/worker.ts` right next to `validatePaymentProviderEnv()` (lines 23 and 15 respectively).

**Not injected via `ctx`.** Injecting tracer/metrics into every `HandlerContext` adds boilerplate to every handler and couples all business code to observability. The ALS-based approach (§Q4) gets the same effect with zero handler changes.

### Q3 — Where are spans/metrics created automatically?

Five explicit instrumentation points, all external wrappers (zero changes to business logic in handlers):

| Point | File | What it does |
|-------|------|--------------|
| **HTTP request** | `apps/api/src/core/observability/middleware.ts` | `onRequest`: start `"http.request"` span (kind=server), seed ALS with `{requestId, traceId, spanId, tenantId?, userId?}`. `onAfterResponse`: set attrs (status, duration), end span. Metrics: `http_requests_total{method,route,status}` counter, `http_request_duration_seconds{route,status}` histogram. |
| **CqrsBus dispatch** | `core/observability/cqrs-wrapper.ts` exports `wrapCqrsBus(bus, tracer, metrics)`. `execute/query` wrap handler invocation in `tracer.withSpan("cqrs.command.{name}" / "cqrs.query.{name}")`. `Result.success=false` sets span status=error. Metrics: `cqrs_handler_duration_seconds`, `cqrs_handler_errors_total`. Registry is modified to call `this.cqrs = wrapCqrsBus(new CqrsBus(), ...)` in constructor (or left bare for Noop default). |
| **EventBus emit** | `core/observability/event-bus-wrapper.ts` wraps `emit` in `"event.{name}"` span. Each listener runs under that parent span so listener work is visible in trace tree. `TypedEventBus.on` already isolates errors — that stays; wrapper adds tracing only. |
| **BullMQ enqueue** | `core/observability/queue-instrumentation.ts` — `wrapQueue(queue, tracer)` overrides `queue.add(name, data, opts)` to call `tracer.currentCarrier()` and merge into `data._otel`. Span `"queue.enqueue"` (kind=producer). `createQueue` in `packages/queue/src/index.ts` can optionally auto-wrap if an injected tracer is passed. |
| **BullMQ worker process** | Modified `apps/api/src/worker.ts` — inside the `createWorker` processor, extract `job.data._otel` carrier, call `ALS.run(ctx, () => tracer.withSpan("worker.process", { parent: carrier }, () => jobDef.handler(...)))`. `_requestId` propagation (already exists at line 39 in `worker.ts`) is subsumed by the ALS context. |
| **Drizzle query** | `core/observability/db-instrumentation.ts` — `wrapDb(rawDb, tracer)` returns a Proxy around the Drizzle instance. Intercepts terminal methods (`execute`, `.then` on query builders) to open `"db.query"` span with attrs `{db.statement, db.tenant_id, db.rows_affected}`. Applied *once* to the raw `db` in `apps/api/src/index.ts` line 19 (`createDb`) and `apps/api/src/worker.ts` line 18. `scopedDb(db, tenantId)` wraps the instrumented db, so tenant filtering and tracing compose. No per-query code changes. |

**Not using `@opentelemetry/instrumentation-pg`.** Auto-instrumentation requires the `--require` flag at Node startup, which is awkward under Bun. Hand-rolled Proxy wrapper around Drizzle gives deterministic, Bun-safe tracing with a 30-line implementation.

### Q4 — How does correlation ID flow end-to-end?

Single `AsyncLocalStorage<ObservabilityContext>` instance, exported from `core/observability/context.ts`:

```typescript
export interface ObservabilityContext {
  requestId: string;
  traceId?: string;
  spanId?: string;
  tenantId?: string;
  userId?: string;
}

export const obsContext = new AsyncLocalStorage<ObservabilityContext>();
export const getObsContext = (): ObservabilityContext | undefined => obsContext.getStore();
```

**End-to-end path (HTTP → DB → BullMQ → Worker → Email):**

```
1. Client sends POST /api/billing/checkout
   Headers: X-Request-Id: abc-123 (or not; middleware generates)
                      (no traceparent from client; starts new trace)
                          │
   ┌──────────────────────▼──────────────────────────┐
   │ requestTraceMiddleware.derive                    │
   │   requestId = headers["x-request-id"] ?? uuid()  │
   │   log = logger.child({ requestId })              │
   └──────────────────────┬──────────────────────────┘
                          │
   ┌──────────────────────▼──────────────────────────┐
   │ observabilityMiddleware.derive                   │
   │   span = tracer.startSpan("http.request",        │
   │            { kind: "server" })                   │
   │   carrier = span.carrier()                       │
   │   obsContext.enterWith({                         │
   │     requestId, traceId: carrier.traceId,         │
   │     spanId: carrier.spanId, tenantId?, userId?   │
   │   })                                              │
   └──────────────────────┬──────────────────────────┘
                          │
   ┌──────────────────────▼──────────────────────────┐
   │ tenantMiddleware.derive                          │
   │   session = auth.api.getSession(...)             │
   │   tenantId = session.session.activeOrganizationId│
   │   // Enrich ALS with tenant/user                 │
   │   obsContext.enterWith({ ...prev, tenantId,      │
   │                          userId })                │
   │   span.setAttributes({ "tenant.id": tenantId,    │
   │                        "user.id": userId })      │
   └──────────────────────┬──────────────────────────┘
                          │
   ┌──────────────────────▼──────────────────────────┐
   │ route handler calls cqrsBus.execute(             │
   │   "billing:create-checkout-session", input, ctx) │
   │                                                   │
   │ wrapped CqrsBus opens span "cqrs.command.billing:│
   │ create-checkout-session" (child of http.request) │
   │                                                   │
   │ handler runs; calls ctx.db.select(...)           │
   │   → wrapped Drizzle opens "db.query" child span  │
   │   pino log: { requestId, traceId, spanId,        │
   │               tenantId } (via mixin reading ALS) │
   │                                                   │
   │ handler enqueues BullMQ job:                     │
   │   queue.add("email:send",                        │
   │     { to, ..., _requestId: ctx.requestId })      │
   │   wrapped queue.add:                             │
   │     carrier = tracer.currentCarrier()            │
   │     data._otel = carrier                         │
   │     span: queue.enqueue (kind=producer)          │
   └──────────────────────┬──────────────────────────┘
                          │
                  HTTP response 200 ──────┐
                          │               │
                  span.end()              │
                                          │
                                          ▼
                                (Redis: job payload now contains
                                 { _requestId: "abc-123",
                                   _otel: { traceparent: "00-...-...-01",
                                             requestId: "abc-123",
                                             tenantId: "t-...",
                                             userId: "u-..." } })

2. Worker picks up job
   ┌──────────────────────────────────────────────────┐
   │ In worker.ts processor:                           │
   │   carrier = job.data._otel                        │
   │   obsContext.run({ requestId: carrier.requestId,  │
   │                    traceId, spanId,               │
   │                    tenantId, userId }, async () =>│
   │     tracer.withSpan("worker.process",             │
   │       { kind: "consumer", parent: carrier },      │
   │       async () => jobDef.handler(job.data))       │
   │   )                                                │
   │                                                    │
   │   pino logs now emit:                             │
   │     { requestId: "abc-123", traceId: "...",       │
   │       spanId: "...", jobId, queue }               │
   │     (existing child-logger logic at lines 40-42   │
   │      still works; mixin adds traceId/spanId)       │
   └──────────────────────────────────────────────────┘
```

**Key property:** The distributed trace appears as a single tree in Tempo/Grafana: `http.request → cqrs.command.billing:create-checkout-session → db.query + queue.enqueue → worker.process → email send`. A developer investigating a failed email can click from the Sentry error up to the originating HTTP request without grep.

### Q5 — How does admin dashboard integrate bull-board?

**Mount pattern:** Official `@bull-board/elysia` adapter v7.0.0 exists; mount at `/admin/bull-board` as an Elysia sub-app.

File: `apps/api/src/core/observability/bull-board.ts`:
```typescript
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ElysiaAdapter } from "@bull-board/elysia";
import { requireRole } from "@baseworks/module-auth";
import type { Queue } from "bullmq";

export function createBullBoardPlugin(queues: Queue[]) {
  const serverAdapter = new ElysiaAdapter("/admin/bull-board");
  createBullBoard({
    queues: queues.map((q) => new BullMQAdapter(q)),
    serverAdapter,
  });
  return new Elysia({ name: "bull-board" })
    .use(requireRole("owner"))
    .use(serverAdapter.registerPlugin());
}
```

**Wiring (`apps/api/src/index.ts`):**
```typescript
const queues = registry.getAllQueues(); // → Queue[] reconstructed from jobDefs
app.use(createBullBoardPlugin(queues));
```

To expose queues cleanly, `ModuleRegistry.getAllQueues()` is added: it iterates `loaded.values()`, for each `def.jobs[*].queue` calls `createQueue(name, redisUrl)` (deduped by name) and returns the array.

**Auth:** `requireRole("owner")` is already the existing admin auth gate (`apps/api/src/routes/admin.ts` line 39). Bull-board inherits session cookies; bull-board's UI assets (`/admin/bull-board/static/*`) must also pass the role check — Elysia `.use(requireRole("owner"))` *before* the adapter plugin covers this.

**Admin SPA embed:** Iframe at `apps/admin/src/routes/system/job-monitor.tsx`:
```tsx
<iframe
  src={`${API_URL}/admin/bull-board`}
  title="BullMQ Job Monitor"
  style={{ width: "100%", height: "calc(100vh - 120px)", border: 0 }}
/>
```

**Why iframe over native mount:** Bull-board ships its own React SPA with its own bundle, routing, Tailwind classes. Rewriting it would take weeks and lose upstream bug fixes. The iframe trades bundle efficiency for integration cost — correct trade for an ops-only tool.

### Q6 — How does the health dashboard get its data?

**HealthContributor registry + central aggregator query.**

Each module optionally declares a `health` function in its `ModuleDefinition`. This is a tiny extension to the existing module contract in `packages/shared/src/types/module.ts`:

```typescript
export interface HealthContribution {
  module: string;
  status: "up" | "degraded" | "down";
  checks: Record<string, { status: "up" | "down"; latency_ms?: number; error?: string }>;
  metrics?: Record<string, number | string>;
}

export interface ModuleDefinition {
  name: string;
  routes?: ...;
  commands?: ...;
  queries?: ...;
  jobs?: ...;
  events?: ...;
  health?: (ctx: { db: DbInstance; redis: Redis }) => Promise<HealthContribution>;
}
```

**Aggregator query** lives in `packages/modules/observability/src/queries/get-system-health.ts`:
```typescript
export const getSystemHealth: QueryHandler<{}, SystemHealthView> =
  async (_input, ctx) => {
    const registry: ModuleRegistry = ctx.deps.registry;
    const contributions = await Promise.all(
      [...registry.getLoaded().values()]
        .filter((def) => def.health)
        .map((def) => def.health!({ db: ctx.db.raw, redis: ctx.deps.redis })),
    );
    const queueStats = await gatherQueueStats(registry);  // BullMQ .getJobCounts
    const recentErrors = await errorTracker.getRecent?.(20); // Sentry/GlitchTip API

    return ok({ modules: contributions, queues: queueStats, errors: recentErrors });
  };
```

Existing `/health` route (lines 65–98 of `index.ts`) stays as Docker/load-balancer probe: fast, binary up/down. The new `/api/admin/observability/health` is the rich operator dashboard view.

**Per-module health examples:**
- `billing.health`: last Stripe webhook age, webhook-events table lag, failed-jobs count in `billing:process-webhook` queue.
- `auth.health`: active-session count, recent sign-in-failure rate from a rolling counter, better-auth DB connectivity ping.
- `example.health`: trivially `{ status: "up", checks: {} }`.

### Q7 — Integration with existing pino logger

**Pino stays primary. ErrorTracker is a tee.** Three changes to `apps/api/src/lib/logger.ts`:

1. **Add trace-ID mixin** (reads ALS):
   ```typescript
   import { getObsContext } from "../core/observability/context";

   export const logger = pino({
     level,
     mixin: () => {
       const ctx = getObsContext();
       if (!ctx) return {};
       return {
         traceId: ctx.traceId,
         spanId: ctx.spanId,
         requestId: ctx.requestId,
         tenantId: ctx.tenantId,
       };
     },
     ...(isDev ? devTransport : {}),
   });
   ```
   Every `logger.info/error` call, existing and future, now includes trace fields automatically when ALS is populated. Zero call-site changes.

2. **PinoErrorTracker adapter** lives at `packages/observability/src/adapters/pino/pino-error-tracker.ts`. It does exactly what today's error middleware does: logs at error level. Default when `ERROR_TRACKER=pino` (no external service configured). Ship-ready out of the box.

3. **Sentry/GlitchTip adapters tee, don't replace.** Inside `SentryErrorTracker.captureException`, first call local `logger.error(...)` so stdout stays canonical, then `Sentry.captureException(err)`. Operators reading journalctl never lose information when vendor breaks.

**Log-to-trace correlation in Grafana Loki + Tempo:** Loki uses the `traceId` JSON field (from the mixin) to build the "View trace" link. No `pino-opentelemetry-transport` needed — the mixin is simpler, Bun-compatible, and deterministic.

### Q8 — Build order (phase suggestions for roadmapper)

Dependency graph (later phases assume earlier phases shipped):

```
Phase A: Ports + Noop adapters + factory + env
    │
    ├─▶ Phase B: ALS context + observability middleware + pino mixin
    │       │
    │       ├─▶ Phase C: CqrsBus/EventBus wrapping
    │       │       │
    │       │       └─▶ Phase D: DB instrumentation
    │       │
    │       └─▶ Phase E: BullMQ enqueue + worker extraction
    │               │
    │               └─▶ Phase F: bull-board mount + admin iframe
    │
    ├─▶ Phase G: OTEL adapters (Tracer + Metrics)
    │       │
    │       └─▶ Phase H: docker-compose.observability.yml + Grafana stack
    │
    ├─▶ Phase I: ErrorTracker adapters (Sentry, GlitchTip) + error middleware tee
    │
    ├─▶ Phase J: HealthContributor registry + aggregator query + admin dashboard UI
    │
    └─▶ Phase K: Runbooks + alert template YAML + docs
```

**Rationale for the order:**

- **A before everything:** Port contracts must solidify before adapters or wrappers can be written. Noop adapters ship in A so every downstream phase has a working default.
- **B before C/D/E:** ALS is the plumbing. CqrsBus/EventBus/DB/BullMQ wrappers all read from and write to it. Trying to build a CqrsBus wrapper before ALS exists forces re-work.
- **C before D and E (loosely):** CqrsBus is the busiest instrumentation point (every command + query). Getting it right exposes issues in the ALS + Tracer API before DB and queue layers replicate the pattern.
- **E before F:** bull-board only shows queues; it doesn't need the trace context work. But if phase E is broken, the UI shows wrong data.
- **G parallelizable with B–F:** OTEL adapter development doesn't block the wrapping work — all wrappers target the port interface. Can be merged any time after A.
- **I parallelizable with B–F:** Same reasoning. Error tracking only depends on the port + factory.
- **J last among functional phases:** Needs B/C/E to populate data; needs G for metrics to aggregate.
- **K (docs/runbooks) last:** Runbooks reference concrete alert names, metric names, and dashboards that only exist after G and J.

**Minimum shippable increment (Phase A + B + C + Noop + pino mixin):** A system where tenant/request/user IDs appear in every log line, CQRS commands show up as spans (even if no-op), and no external backend is required. This alone is enough to improve debuggability.

### Q9 — Module boundaries

**Decision: ports + wrappers live outside any feature module; a thin `observability` module exists only for admin queries.**

- Observability is cross-cutting infrastructure (auth needs it, billing needs it, every future module will need it). Cross-cutting concerns belong in `packages/observability/` (port contracts) and `apps/api/src/core/observability/` (wiring), not in a feature module.
- The admin-facing surface (health aggregator, queue stats) *is* a module — it has queries, composes with the existing module registry. Keeping it as a module makes it loadable/unloadable via config, same as billing/example.
- Existing modules (auth, billing, example) are *enriched* with optional `health` contributions. They do not gain observability-specific commands/queries. They do not import from `packages/modules/observability/`.

**One important refinement:** `wrapCqrsBus` does not live in `packages/modules/observability/` because it imports `apps/api/src/core/cqrs.ts`'s `CqrsBus`, which would create an apps→packages→apps cycle. Keep it in `apps/api/src/core/observability/`.

### Q10 — Data flow diagram (trace context propagation)

Already rendered in §Q4. Reproduced here condensed with focus on *context mutation points*:

```
                                        Trace
              Request           │       Context         │        Worker
           ─────────────        │     ─────────         │     ───────────
  [Client HTTP POST]            │                       │
    │                           │                       │
    ▼                           │                       │
  [Elysia: requestTrace]        │                       │
    requestId generated/parsed  │                       │
    │                           │                       │
    ▼                           │                       │
  [Elysia: observability]       │                       │
    tracer.startSpan            │                       │
    obsContext.enterWith({req,  │                       │
       trace, span})            │                       │
    │                           │                       │
    ▼                           │                       │
  [Elysia: tenant middleware]   │                       │
    session lookup              │                       │
    obsContext.enterWith({req,  │                       │
       trace, span, tenant,     │                       │
       user})                   │                       │
    │                           │                       │
    ▼                           │                       │
  [route handler]               │                       │
    cqrsBus.execute(...)        │                       │
      ├─▶ [wrapCqrsBus]         │ span child:           │
      │     start cqrs span     │  cqrs.command.X       │
      │     pino logs inherit   │                       │
      │     via mixin           │                       │
      │                         │                       │
      ├─▶ [scopedDb.insert]     │ span child: db.query  │
      │     SQL runs            │                       │
      │                         │                       │
      └─▶ [queue.add] ──────────┼────(serialize)───────▶ Redis payload:
            _otel = carrier()   │                       │    { _otel: {tp, rid, tid, uid} }
            span: queue.enqueue │                       │                 │
                                │                       │                 │
  [response 200]                │                       │                 │
  span.end()                    │                       │                 ▼
                                │                       │          [BullMQ Worker]
                                │                       │            extract _otel
                                │                       │            obsContext.run(ctx,
                                │                       │              tracer.withSpan(
                                │                       │                "worker.process",
                                │                       │                {parent: carrier},
                                │                       │                handler))
                                │                       │            logs inherit trace
                                │                       │                 │
                                │                       │                 ▼
                                │                       │          [handler: sendEmail]
                                │                       │            Resend API call
                                │                       │            span: http.client
```

The trace is visible in Grafana Tempo as a single tree spanning both processes. The `requestId` serves as the human-readable correlation key in pino logs; the `traceId` serves as the machine correlation across the OTEL stack. Both coexist by design — pino's existing `requestId` stays for operators grepping journalctl in an incident.

---

## Architectural Patterns

### Pattern 1: Port / Adapter with Env-Selected Singleton

**What:** Interface in `ports/`, concrete implementations in `adapters/*/`, lazy singleton factory selects by env var, exposes reset + set for tests.

**When to use:** Every observability back-end (tracer, metrics, error tracker). Pattern is already canonical in the codebase (billing `PaymentProvider`).

**Trade-offs:** Adds one indirection level. But it is the *only* way to ship adapter choice as a fork-time decision without rewiring code. Zero marginal cost — pattern already exists.

```typescript
// Mirrors packages/modules/billing/src/provider-factory.ts exactly
export function getTracer(): Tracer {
  if (instance) return instance;
  switch (env.TRACER ?? "noop") { ... }
  return instance;
}
export function resetTracer(): void { instance = null; }
export function setTracer(t: Tracer): void { instance = t; }
```

### Pattern 2: External Wrapping over Internal Instrumentation

**What:** Do not modify `CqrsBus`, `TypedEventBus`, Drizzle's `drizzle()`, or BullMQ's `Queue` to emit spans internally. Wrap them externally with Proxy/decorator.

**When to use:** All core primitives. Benefits: core primitives stay pure and unit-testable without a Tracer dependency; wrappers compose with Noop default; wrappers can be disabled in tests.

**Trade-offs:** Wrapper code runs on every call (tiny overhead). Solution: Noop adapter makes the wrapper a no-op check + direct call.

```typescript
export function wrapCqrsBus(bus: CqrsBus, tracer: Tracer, metrics: MetricsProvider): CqrsBus {
  const originalExecute = bus.execute.bind(bus);
  bus.execute = async (cmd, input, ctx) => {
    return tracer.withSpan(`cqrs.command.${cmd}`, async (span) => {
      const start = performance.now();
      const result = await originalExecute(cmd, input, ctx);
      const duration = performance.now() - start;
      metrics.histogram("cqrs_handler_duration_seconds").observe(duration / 1000, {
        handler: cmd, success: String(result.success),
      });
      if (!result.success) span.setStatus("error", result.error);
      return result;
    });
  };
  return bus;
}
```

### Pattern 3: AsyncLocalStorage as Single Context Carrier

**What:** One `AsyncLocalStorage<ObservabilityContext>` owns all request-scoped identifiers. Pino reads from it via mixin; tracer reads from it to seed carriers; workers re-enter it on job pickup.

**When to use:** Everywhere cross-process correlation is needed. Deliberately *not* using multiple ALS stores (one for trace, one for tenant, etc.) — a single merged context is simpler and composes correctly.

**Trade-offs:** AsyncLocalStorage on Bun uses async_hooks, which has a measurable (<5% at typical throughputs) overhead. Acceptable for the correlation value delivered.

### Pattern 4: Pino as the Canonical Log Sink

**What:** Every log still goes to pino. ErrorTracker adapters tee to Sentry/GlitchTip *in addition to* logging. Never *instead of*.

**When to use:** All error paths. Never remove a pino call when adding Sentry/GlitchTip.

**Trade-offs:** Writes happen twice (stdout + vendor). Storage cost on vendor side. Solution: sample low-signal logs (not errors) before they reach the vendor.

---

## Data Flow

### Request Flow (HTTP to Response with Observability Overlay)

```
Client
  │  POST /api/billing/checkout
  ▼
Elysia → errorMiddleware (no-op unless error)
  ▼
requestTraceMiddleware  [emits requestId, creates pino child]
  ▼
observabilityMiddleware [opens http.request span, seeds ALS]
  ▼
localeMiddleware
  ▼
tenantMiddleware        [enriches ALS with tenant/user]
  ▼
route handler           [derives handlerCtx: { tenantId, userId, db: scopedDb, emit }]
  ▼
cqrsBus.execute(...)    [wrapped: opens cqrs.command span]
  ▼
command handler         [reads ctx; pino mixin injects traceId]
  ▼
ctx.db.select/insert    [wrapped Drizzle: opens db.query span]
  ▼
registry.eventBus.emit  [wrapped: opens event span, listeners run under it]
  ▼
listeners               [e.g., enqueue email job]
  ▼
queue.add(...)          [wrapped: injects _otel carrier into job.data, span: queue.enqueue]
  ▼
return Result
  ▼
onAfterResponse         [log completion + metrics.histogram observe, span.end]
  ▼
Client receives response
```

### Key Data Flows

1. **HTTP → worker correlation:** carrier serialized into `job.data._otel`, extracted on pickup, fed to `ALS.run` + `tracer.withSpan({ parent: carrier })`. Trace tree spans processes.
2. **Error capture:** `errorMiddleware.onError` calls `errorTracker.captureException(err, s => { s.setUser({id: userId}); s.setTenant(tenantId); s.setTag("requestId", requestId); })`. Existing pino `.error` call kept — ErrorTracker additively tees.
3. **Health aggregation:** `GET /api/admin/observability/health` → CQRS `observability:get-system-health` → Promise.all over `def.health()` across modules + queue `.getJobCounts()` + ErrorTracker recent-errors API → aggregated view model. Admin SPA displays via React Query + shadcn cards.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0–1k req/min | Self-hosted Tempo + Prometheus on the same Docker host as the API. Head-based sampling 100%. Noop adapters fine for freelance projects. |
| 1k–100k req/min | Tail-based sampling at the OTEL collector (keep all errors, sample 10% of successes). Move Tempo/Loki/Prometheus to dedicated observability VM. Add batching on the OTLP exporter (default in otel-sdk-node). |
| 100k+ req/min | Kafka or NATS between OTEL collector and storage. Consider Grafana Cloud / Honeycomb for managed ingestion. Separate metrics path (Prometheus remote-write) from traces (OTLP). Use `@opentelemetry/sdk-metrics` histogram exemplars to link metrics ↔ traces at high volume. |

### Scaling Priorities

1. **First bottleneck:** pino stdout volume on a high-traffic instance (containers can block on log ingestion). Mitigation: `pino.transport({ target: 'pino-roll' })` or ship directly to Loki with `pino-loki` transport.
2. **Second bottleneck:** OTLP exporter queue saturation at ~10k spans/sec. Mitigation: tail-based sampling in the OTEL collector; never sample at the SDK layer (loses context).
3. **Third bottleneck:** AsyncLocalStorage overhead measurable above 50k req/s. Mitigation: not fixable without abandoning correlation; scale horizontally before this matters.

---

## Anti-Patterns

### Anti-Pattern 1: Injecting Tracer into Every HandlerContext

**What people do:** Add `tracer: Tracer` to `HandlerContext`, thread it through every CQRS handler.

**Why it's wrong:** Couples every business handler to observability. Forces test fakes everywhere. Makes HandlerContext heavier. Doubles the surface area to mock in the 22 existing CQRS handler tests.

**Do this instead:** AsyncLocalStorage + external wrappers. Business handlers stay unaware. Observability evolves without touching handlers.

### Anti-Pattern 2: Replacing Pino with an OpenTelemetry Logger

**What people do:** Introduce `@opentelemetry/api-logs` as the new log API; deprecate pino.

**Why it's wrong:** OTEL logs API is still evolving (per OTel JS 2026 docs), has worse performance than pino, loses all existing child-logger context from `apps/api/src/worker.ts:40-42`, breaks the established JSDoc-documented logger contract.

**Do this instead:** Keep pino. Use a mixin to inject traceId/spanId. Ship logs to Loki; let Grafana's Loki↔Tempo links do correlation.

### Anti-Pattern 3: Using `@opentelemetry/auto-instrumentations-node` under Bun

**What people do:** `bun --require ./otel-setup.ts run api` hoping auto-instrumentation "just works".

**Why it's wrong:** Bun's `--require` flag semantics differ from Node's. Auto-instrumentation patches modules at import time; many patches fail silently under Bun. The STATE-tracked constraint — "must remain Bun-compatible (OTEL SDK for Node must work under Bun)" — is explicitly *not* satisfied by auto-instrumentation.

**Do this instead:** Programmatic SDK init in `adapters/otel/otel-sdk.ts`, explicit hand-rolled wrappers for Elysia, Drizzle, BullMQ. Deterministic, testable, Bun-safe.

### Anti-Pattern 4: Surfacing Bull-Board to Non-Owners

**What people do:** Mount bull-board at `/admin/bull-board` without auth, behind "only admins know the URL".

**Why it's wrong:** Bull-board shows job payloads. Job payloads contain tenant IDs, user IDs, email addresses, internal state. Any non-owner discovering the URL sees cross-tenant data.

**Do this instead:** `new Elysia({ name: "bull-board" }).use(requireRole("owner")).use(serverAdapter.registerPlugin())`. RBAC check on every HTTP request under the mount path, including static asset requests.

### Anti-Pattern 5: Trace Retention ≠ BullMQ Job Retention

**What people do:** Keep existing queue defaults (`removeOnComplete: 3 days`, `removeOnFail: 7 days`, defined in `packages/queue/src/index.ts` lines 21–22) but retain traces for 30 days in Tempo.

**Why it's wrong:** A trace references a BullMQ job that no longer exists. Investigation of an old incident hits dead ends.

**Do this instead:** Align Tempo retention with `removeOnFail` age (7 days default), or bump both to 30 days with explicit operator decision. Document in `docs/observability/architecture.md`.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| OTLP collector (Tempo, Prometheus, Loki) | HTTP POST to `OTEL_EXPORTER_OTLP_ENDPOINT` via `@opentelemetry/exporter-trace-otlp-http` | Must work under Bun — tested via Elysia's OTEL plugin pattern. Programmatic SDK init, not `--require`. |
| Sentry | `@sentry/node` SDK, `Sentry.init({ dsn: env.SENTRY_DSN })` at startup | Must call `Sentry.flush(2000)` in `process.on("SIGTERM")` handlers in `apps/api/src/index.ts` and `worker.ts`. |
| GlitchTip | Sentry-compatible API; use `@sentry/node` with `dsn: env.GLITCHTIP_DSN` | Self-hosted Sentry alternative. Drop-in replacement. |
| Grafana (local dev) | Docker Compose service, ports 3000 (Grafana) + 4318 (OTLP HTTP) + 3100 (Loki) | `docker-compose.observability.yml` new file. Grafana provisioned with Tempo/Prom/Loki datasources. |
| Resend | Existing integration; now emits `http.client` span for the outbound API call | Instrument at the `fetch` boundary in `email:send` job. |
| Stripe / Pagar.me | Existing integration; outbound webhook verify + API calls emit `http.client` spans | Same pattern: wrap `fetch` call. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `packages/observability` ↔ `apps/api/core/observability` | apps/api imports packages/observability; never the reverse | Prevents the cycle risk. |
| `packages/observability` ↔ `packages/modules/*` | Modules do *not* import observability package directly (ALS is transparent). Only `ModuleDefinition.health` optionally returns typed contributions. | Keeps modules portable. |
| `apps/api` (API role) ↔ `apps/api` (worker role) | Trace context via `job.data._otel` carrier through Redis. Request ID via `job.data._requestId` (already exists, line 39 `worker.ts`). | No new cross-process mechanism; leverages BullMQ payload. |
| `apps/admin` ↔ bull-board | Iframe at `${API_URL}/admin/bull-board`; cookies + session shared (same origin via CORS config) | Relies on existing CORS `credentials: true` at `apps/api/src/index.ts` line 58. |
| `apps/admin` ↔ observability module queries | Eden Treaty calls `admin.observability.*`; module registered via `ModuleRegistry` with `requireRole("owner")` gating at the route layer | Same pattern as existing `adminRoutes`. |

---

## Build Order Summary (for Roadmapper)

Suggested phase grouping for Roadmapper to consume (dependency-respecting):

1. **Ports + Noop + factory + env wiring** — unblocks everything
2. **ALS context + middleware + pino mixin** — observability visible in logs immediately
3. **CqrsBus + EventBus wrapping** — trace tree begins to form
4. **DB instrumentation** — slow-query diagnosis becomes possible
5. **BullMQ enqueue + worker extraction + carrier propagation** — cross-process correlation works
6. **bull-board mount + admin iframe** — ops-visible job queue
7. **OTEL adapters + docker-compose.observability.yml + Grafana provisioning** (parallel-safe with 3–6)
8. **ErrorTracker adapters (Sentry + GlitchTip + pino tee) + error middleware integration** (parallel-safe with 3–6)
9. **HealthContributor registry + aggregator query + admin health dashboard UI**
10. **Runbooks + Grafana alert YAML + Sentry alert templates + docs/observability**

Phases 7 and 8 can be scheduled in parallel with 3–6 because they depend only on phase 1 (ports). Phase 9 must follow 3–8 (needs data to aggregate). Phase 10 must be last (references concrete alert names from 9 and metric names from 3–7).

---

## Sources

- Read directly from repo: `apps/api/src/index.ts`, `apps/api/src/worker.ts`, `apps/api/src/core/{cqrs.ts,event-bus.ts,registry.ts}`, `apps/api/src/core/middleware/{request-trace.ts,tenant.ts,error.ts}`, `apps/api/src/lib/logger.ts`, `apps/api/src/routes/admin.ts`, `packages/modules/billing/src/{ports/payment-provider.ts,provider-factory.ts,index.ts,jobs/process-webhook.ts}`, `packages/queue/src/index.ts`, `packages/db/src/{connection.ts,helpers/scoped-db.ts}`, `packages/shared/src/types/{context.ts,module.ts}` — HIGH confidence.
- [Elysia OpenTelemetry Plugin](https://elysiajs.com/patterns/opentelemetry) — official OTEL integration pattern for Elysia.
- [Configure OpenTelemetry in Bun Without --require Flag](https://oneuptime.com/blog/post/2026-02-06-opentelemetry-bun-without-nodejs-require-flag/view) — programmatic SDK init pattern.
- [Instrument Bun and ElysiaJS with OpenTelemetry](https://oneuptime.com/blog/post/2026-02-06-instrument-bun-elysiajs-opentelemetry/view) — concrete 2026 Bun+OTEL guide.
- [@bull-board/elysia on npm](https://www.npmjs.com/package/@bull-board/elysia) — official Elysia adapter v7.0.0.
- [bull-board on GitHub](https://github.com/felixmosh/bull-board) — framework adapter list confirms Elysia support.
- [How to Monitor BullMQ with Bull Board](https://oneuptime.com/blog/post/2026-01-21-bullmq-bull-board/view) — mount patterns reference.
- [OpenTelemetry Context docs](https://opentelemetry.io/docs/languages/js/context/) — AsyncLocalStorage as default context manager confirmation.

---

*Architecture research for: Baseworks v1.3 Observability & Operations*
*Researched: 2026-04-21*
