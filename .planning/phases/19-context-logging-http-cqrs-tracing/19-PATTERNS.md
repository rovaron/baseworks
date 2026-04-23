# Phase 19: Context, Logging & HTTP/CQRS Tracing - Pattern Map

**Mapped:** 2026-04-23
**Files analyzed:** 19 (14 modified + 5 created)
**Analogs found:** 17 / 19

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/observability/src/context.ts` | ALS seed module (lazy singleton + get/set/reset trio) | request-response (per-request context carrier) | `packages/observability/src/factory.ts` (Tracer/Metrics/ErrorTracker trio); `packages/modules/auth/src/locale-context.ts` (AsyncLocalStorage instance + `getStore()?.field ?? default`) | exact (hybrid of two in-repo precedents) |
| `packages/observability/src/wrappers/wrap-event-bus.ts` | External wrapper (method interception) | event-driven (pub-sub) | `packages/observability/src/wrappers/wrap-cqrs-bus.ts` | exact (same wrapper discipline, different surface) |
| `packages/observability/src/wrappers/wrap-cqrs-bus.ts` (MODIFIED) | External wrapper extension | request-response | Self (extend, don't rewrite) | self |
| `packages/observability/src/index.ts` (MODIFIED) | Barrel export | — | Self (append-only) | self |
| `apps/api/src/core/middleware/observability.ts` | Elysia middleware plugin (derive + onRequest + onBeforeHandle + onError + onAfterResponse) | request-response (HTTP span lifecycle) | `apps/api/src/core/middleware/request-trace.ts`; `apps/api/src/core/middleware/error.ts` | exact (same plugin shape, adds more hooks) |
| `apps/api/src/core/middleware/request-trace.ts` (MODIFIED) | Elysia middleware plugin | request-response | Self (shrink — delete inline requestId gen + header writer) | self |
| `apps/api/src/core/middleware/tenant.ts` (MODIFIED) | Elysia middleware plugin | request-response | Self (single-line insert post-session-resolution) | self |
| `apps/api/src/lib/logger.ts` (MODIFIED) | pino instance wiring | transform (mixin) | Self (single-line insert into pino options bag) | self |
| `apps/api/src/index.ts` (MODIFIED) | API entrypoint | request-response | Self (replace `app.listen` with `Bun.serve`; add one wrapEventBus line; delete localeMiddleware mount) | self |
| `apps/api/src/worker.ts` (MODIFIED) | worker entrypoint | event-driven (job) | Self (wire wrapEventBus line; call createWorker variant with als.run) | self |
| `apps/api/src/lib/inbound-trace.ts` | Utility (trust decision + W3C parse) | transform | None (new domain) — nearest hand-rollable peer: `packages/modules/auth/src/locale-context.ts::parseNextLocaleCookie` | role-match (pure-function cookie/header parser) |
| `apps/api/src/lib/locale-cookie.ts` | Utility (cookie parse) | transform | `packages/modules/auth/src/locale-context.ts::parseNextLocaleCookie` (move+export verbatim) | exact (straight move) |
| `packages/modules/auth/src/locale-context.ts` (REWRITTEN) | utility / compat shim | request-response (read-only after rewrite) | Self — body shrinks to `obsContext.getStore()?.locale ?? defaultLocale` | self (surface preserved) |
| `packages/modules/auth/src/index.ts` (MODIFIED) | Barrel export | — | Self (drop `localeMiddleware` re-export) | self |
| `packages/queue/src/index.ts` (MODIFIED — per D-05 planner pick) | Infrastructure factory | event-driven (job) | Self (wrap user-provided `processor` in `obsContext.run(jobCtx, () => processor(job))`) | self |
| `packages/config/src/env.ts` (MODIFIED) | env schema + validator | config | Self (extend `serverSchema` + extend `validateObservabilityEnv`) — mirror the existing per-adapter switch shape | self |
| `biome.json` (MODIFIED) | Lint config | CI lint gate | Self (append `plugins` array) | self |
| `.biome/plugins/no-als-enter-with.grit` | GritQL lint rule | CI lint gate | None in repo — first GritQL plugin | no-analog |
| `scripts/lint-no-enterwith.sh` | CI lint gate (grep) | CI lint gate | None (repo has `scripts/validate-docs.ts` but different shape) | partial (bash script; first of its kind) |
| `package.json` (MODIFIED) | Script wiring | — | Self (append `lint:als` + chain into `lint`) | self |
| `apps/api/__tests__/observability-context-bleed.test.ts` | Integration + perf test | load test | `apps/api/__tests__/telemetry-boot.test.ts` (app-level bun:test in same dir); `packages/observability/src/wrappers/__tests__/wrap-cqrs-bus.test.ts` (recording-mock shape) | role-match (same dir, test framework, bun:test API) |
| `apps/api/__tests__/enterwith-ban.test.ts` | Integration test | CI lint gate | `apps/api/__tests__/telemetry-boot.test.ts` | role-match |
| `apps/api/__tests__/http-span-lifecycle.test.ts` | Integration test | request-response | `packages/observability/src/wrappers/__tests__/wrap-cqrs-bus.test.ts` (recording tracer pattern applies) | role-match |
| `apps/api/__tests__/core-files-untouched.test.ts` | Integration test (file-hash invariant) | CI lint gate | None in repo — new kind | no-analog |
| `packages/observability/src/__tests__/context.test.ts` | Unit test | — | `packages/observability/src/wrappers/__tests__/wrap-cqrs-bus.test.ts` | role-match |
| `packages/observability/src/wrappers/__tests__/wrap-event-bus.test.ts` | Unit test | — | `packages/observability/src/wrappers/__tests__/wrap-cqrs-bus.test.ts` | exact |
| `apps/api/src/core/middleware/__tests__/observability.test.ts` | Unit test | — | `packages/observability/src/wrappers/__tests__/wrap-cqrs-bus.test.ts` (recording tracer shape) | role-match |
| `apps/api/src/lib/__tests__/inbound-trace.test.ts` | Unit test | — | `packages/observability/src/wrappers/__tests__/wrap-cqrs-bus.test.ts` | role-match |
| `apps/api/src/lib/__tests__/logger-mixin.test.ts` | Unit test | — | `packages/observability/src/wrappers/__tests__/wrap-cqrs-bus.test.ts` | role-match |

## Pattern Assignments

---

### `packages/observability/src/context.ts` (NEW — ALS seed module, D-06)

**Analog A (primary):** `packages/observability/src/factory.ts` — lazy-singleton + get/set/reset trio discipline.
**Analog B (structural):** `packages/modules/auth/src/locale-context.ts` — AsyncLocalStorage instance pattern + `getStore()?.field ?? default` read.

**Imports pattern** (from `locale-context.ts` lines 1):
```typescript
import { AsyncLocalStorage } from "node:async_hooks";
import type { Locale } from "@baseworks/i18n";
```

**Core pattern — ALS instance + type + reader** (mirror `locale-context.ts` lines 21-36):
```typescript
// packages/observability/src/context.ts (NEW)
import { AsyncLocalStorage } from "node:async_hooks";
import type { Locale } from "@baseworks/i18n";

export interface ObservabilityContext {
  requestId: string;
  traceId: string;
  spanId: string;
  locale: Locale;
  tenantId: string | null;
  userId: string | null;
  // Optional — preserved from Bun.serve for .onRequest span Link attachment
  inboundCarrier?: Record<string, string>;
}

export const obsContext = new AsyncLocalStorage<ObservabilityContext>();

/** Read the current ALS store. Returns undefined outside a request frame. */
export function getObsContext(): ObservabilityContext | undefined {
  return obsContext.getStore();
}
```

**Mutator helpers** (D-03 — three named setters; mutate store in place, no new frame):
```typescript
/** Publish the session-derived tenant/user into ALS. Called once per request
 *  from tenantMiddleware.derive after auth.api.getSession() resolves. */
export function setTenantContext(input: {
  tenantId: string | null;
  userId: string | null;
}): void {
  const store = obsContext.getStore();
  if (store) {
    store.tenantId = input.tenantId;
    store.userId = input.userId;
  }
}

/** Publish the open-span IDs into ALS so downstream hooks/handlers can see them. */
export function setSpan(input: { traceId: string; spanId: string }): void {
  const store = obsContext.getStore();
  if (store) {
    store.traceId = input.traceId;
    store.spanId = input.spanId;
  }
}

/** Overwrite locale (rare — Phase 19 does not call this; reserved for i18n flows). */
export function setLocale(locale: Locale): void {
  const store = obsContext.getStore();
  if (store) {
    store.locale = locale;
  }
}
```

**Anti-pattern note (D-01, D-24):** NEVER export or use `.enterWith()`. The single `als.run(ctx, fn)` seed point lives in the Bun.serve fetch wrapper (apps/api/src/index.ts).

**Factory-style set/reset trio (optional, for tests — mirror `factory.ts` lines 65-78):** Not strictly required here because ALS is itself the carrier; tests drive via `obsContext.run(ctx, fn)`. Planner may add `resetObsContext()` only if a test helper needs it.

---

### `packages/observability/src/wrappers/wrap-event-bus.ts` (NEW — D-15, D-16)

**Analog:** `packages/observability/src/wrappers/wrap-cqrs-bus.ts` (byte-for-byte template).

**Imports pattern** (mirror `wrap-cqrs-bus.ts` lines 1-21):
```typescript
/**
 * External EventBus wrapper (TRC-02 / Phase 19 D-15/D-16).
 *
 * Wraps `bus.emit` and `bus.on` so every emit opens an `event.publish`
 * span (kind=producer) and every listener runs inside an `event.handle`
 * child span (kind=consumer). No edits to apps/api/src/core/event-bus.ts;
 * this wrapper attaches at registry boot time (apps/api/src/index.ts +
 * apps/api/src/worker.ts wire-up immediately after wrapCqrsBus).
 *
 * Design rules (mirror wrap-cqrs-bus.ts):
 * - EventBusLike type intentionally narrow (emit + on only) to avoid
 *   cross-package type cycles. TypedEventBus satisfies it structurally.
 * - Listener errors: span.recordException + setStatus('error') THEN rethrow.
 *   The existing try/catch-and-log at event-bus.ts:54-64 remains the single
 *   log/swallow site — the wrapper adds telemetry, not an alternate handler.
 * - NO tracker.captureException here — per CONTEXT.md D-15 discretion note,
 *   listener errors emit span status only (no Sentry noise for known-flaky subscribers).
 */
import { obsContext } from "../context";
import type { Tracer } from "../ports/tracer";

export interface EventBusLike {
  emit(event: string, data: unknown): void;
  on(event: string, handler: (data: any) => void | Promise<void>): void;
}
```

**Core wrapper body** (mirror `wrap-cqrs-bus.ts` lines 43-83 shape — `origX = bus.X.bind(bus); (bus as Like).X = ...`):
```typescript
export function wrapEventBus<B extends EventBusLike>(bus: B, tracer: Tracer): B {
  const origEmit = bus.emit.bind(bus);
  const origOn = bus.on.bind(bus);

  (bus as EventBusLike).emit = (event: string, data: unknown) => {
    const store = obsContext.getStore();
    // fire-and-forget: EventEmitter.emit is sync, so withSpan's Promise is awaited inline
    void tracer.withSpan(
      "event.publish",
      () => {
        origEmit(event, data);
      },
      {
        kind: "producer",
        attributes: {
          "event.name": event,
          "tenant.id": store?.tenantId ?? "",
          "request.id": store?.requestId ?? "",
        },
      },
    );
  };

  let listenerIndex = 0;
  (bus as EventBusLike).on = (event: string, handler: (data: any) => void | Promise<void>) => {
    const idx = listenerIndex++;
    const wrapped = async (data: any) => {
      const store = obsContext.getStore();
      await tracer.withSpan(
        "event.handle",
        async (span) => {
          try {
            await handler(data);
          } catch (err) {
            span.recordException(err);
            span.setStatus({ code: "error" });
            throw err; // existing event-bus.ts try/catch swallows + logs
          }
        },
        {
          kind: "consumer",
          attributes: {
            "event.name": event,
            "event.listener.index": idx,
            "tenant.id": store?.tenantId ?? "",
            "request.id": store?.requestId ?? "",
          },
        },
      );
    };
    origOn(event, wrapped);
  };

  return bus;
}
```

**Type cycle avoidance** (mirror wrap-cqrs-bus.ts comment at lines 22-28): `EventBusLike` is structural — `TypedEventBus` at `apps/api/src/core/event-bus.ts` satisfies it without a cross-package import.

---

### `packages/observability/src/wrappers/wrap-cqrs-bus.ts` (MODIFIED — D-17)

**Analog:** Self — extend internals; signature and BusLike type LOCKED.

**Constraint:** Export signature MUST stay `wrapCqrsBus<B extends BusLike>(bus: B, tracker: ErrorTracker): B`. No new parameters. Consumers at `apps/api/src/index.ts:46` and `apps/api/src/worker.ts:41` remain untouched (D-18).

**Internal additions — imports** (add these to existing import block at lines 1-21):
```typescript
import { obsContext } from "../context";
import { getTracer } from "../factory";
```

**Internal additions — body** (wrap the existing try/catch at lines 55-63 inside `tracer.withSpan`):
```typescript
// Replace lines 47-64 (execute wrapper) with this shape:
const tracer = getTracer();
const origExecute = bus.execute.bind(bus);

(bus as BusLike).execute = async (
  command: string,
  input: unknown,
  ctx: unknown,
) => {
  const store = obsContext.getStore();
  return tracer.withSpan(
    "cqrs.command",
    async (span) => {
      try {
        return await origExecute(command, input, ctx);
      } catch (err) {
        // Span telemetry BEFORE existing tracker.captureException (order matters
        // for Sentry trace-link enrichment — Phase 18 D-01 contract).
        span.recordException(err);
        span.setStatus({ code: "error" });
        tracker.captureException(err, {
          extra: {
            commandName: command,
            requestId: store?.requestId,
            traceId: store?.traceId,
          },
          // ALS is source of truth; falls back to ctx only when outside a request frame
          tenantId:
            store?.tenantId ??
            (ctx as { tenantId?: string | null })?.tenantId,
        });
        throw err;
      }
    },
    {
      attributes: {
        "cqrs.name": command,
        "tenant.id": store?.tenantId ?? "",
        "user.id": store?.userId ?? "",
        "request.id": store?.requestId ?? "",
      },
    },
  );
};
```

**Symmetric `query` block:** Same shape with `"cqrs.query"` span name and `{ extra: { queryName: command, requestId, traceId } }`.

**Test coverage:** The existing test file at `packages/observability/src/wrappers/__tests__/wrap-cqrs-bus.test.ts` gets extended — add tests for (a) span.recordException called on throw, (b) ALS tenantId overrides ctx.tenantId when both are set, (c) span open/end even on success. Use the `makeRecordingTracker()` helper at lines 9-27 as a template for a `makeRecordingTracer()` helper.

---

### `apps/api/src/core/middleware/observability.ts` (NEW — D-21)

**Analog:** `apps/api/src/core/middleware/request-trace.ts` (structural — `new Elysia({ name }).derive(...).onAfterResponse(...)`).
**Analog B:** `apps/api/src/core/middleware/error.ts` (structural — `.onError({ as: "global" }, ...)` hook pattern).

**Imports pattern** (mirror `request-trace.ts` lines 1-2 + `error.ts` line 1-3):
```typescript
import { Elysia } from "elysia";
import {
  getObsContext,
  getTracer,
  setSpan,
  type Span,
} from "@baseworks/observability";
```

**Core plugin shape** (structural mirror of `request-trace.ts` lines 17-44, expanded with extra hooks):
```typescript
/**
 * HTTP span lifecycle middleware (Phase 19 / D-21 / TRC-01 / CTX-02).
 *
 * Hooks:
 *  - .derive (scoped) — open the HTTP span with provisional name `{method} unknown`,
 *    publish span IDs into ALS via setSpan({traceId, spanId}).
 *  - .onBeforeHandle — rename span to `{method} {context.route}` once route
 *    template is resolved (A1/A8 TDD gate).
 *  - .onError — span.recordException + setStatus('error'). Do NOT end here
 *    (onAfterResponse runs after onError and ends the span).
 *  - .onAfterResponse — set http.status_code + tenant.id + user.id attrs,
 *    call span.end(), write outbound traceparent + x-request-id headers.
 *
 * Mounted BEFORE requestTraceMiddleware in apps/api/src/index.ts (D-22).
 * Single writer for x-request-id (D-23 deletes the duplicate writer in request-trace.ts).
 */
export const observabilityMiddleware = new Elysia({ name: "observability" })
  .derive({ as: "global" }, ({ request }) => {
    const tracer = getTracer();
    const store = getObsContext();
    // store is non-null — Bun.serve fetch wrapper seeded ALS before app.handle(req)
    const span: Span = tracer.startSpan(`${request.method} unknown`, {
      kind: "server",
      attributes: { "request.id": store?.requestId ?? "" },
    });
    setSpan({ traceId: store!.traceId, spanId: store!.spanId });
    return { _obsSpan: span };
  })
  .onBeforeHandle({ as: "global" }, ({ request, route, _obsSpan }: any) => {
    (_obsSpan as Span).setAttribute("http.route", route);
    (_obsSpan as Span).setAttribute("http.method", request.method);
    // Note: Span rename deferred until port-widening or Phase 21 updateName();
    // attributes carry the truth under Noop tracer.
  })
  .onError({ as: "global" }, ({ error, _obsSpan }: any) => {
    (_obsSpan as Span).recordException(error);
    (_obsSpan as Span).setStatus({ code: "error" });
  })
  .onAfterResponse({ as: "global" }, ({ set, _obsSpan }: any) => {
    const store = getObsContext();
    const status = (set as any).status ?? 200;
    (_obsSpan as Span).setAttribute("http.status_code", status);
    if (store?.tenantId) (_obsSpan as Span).setAttribute("tenant.id", store.tenantId);
    if (store?.userId) (_obsSpan as Span).setAttribute("user.id", store.userId);
    (_obsSpan as Span).end();

    // Single writer for x-request-id + outbound traceparent (D-09, D-23)
    if (set && typeof set === "object" && "headers" in set) {
      (set.headers as Record<string, string>)["x-request-id"] = store!.requestId;
      (set.headers as Record<string, string>)["traceparent"] =
        `00-${store!.traceId}-${store!.spanId}-01`;
    }
  });
```

**Hook-order invariants to preserve** (from `request-trace.ts` line 17 — `new Elysia({ name: "..." })`): each middleware gets a distinct `name` (used by Elysia for idempotent mounting); use `as: "global"` so the hooks cover all routes regardless of plugin scope.

---

### `apps/api/src/core/middleware/request-trace.ts` (MODIFIED — D-23)

**Analog:** Self — shrink to ALS reader only.

**Changes from current file (lines 1-45):**
1. Import `getObsContext` from `@baseworks/observability`.
2. Replace line 20 (`const requestId = headers["x-request-id"] || crypto.randomUUID();`) with `const requestId = getObsContext()?.requestId ?? "unknown";`.
3. DELETE lines 40-43 (the `set.headers["x-request-id"] = ...` block) — single-writer invariant moves that to `observabilityMiddleware.onAfterResponse`.
4. Everything else (the `log = createRequestLogger(requestId)`, `startTime`, `onAfterResponse` completion log line) stays — pino mixin will automatically enrich the completion log line via D-19.

**Resulting file shape** (after edit):
```typescript
import { Elysia } from "elysia";
import { getObsContext } from "@baseworks/observability";
import { createRequestLogger } from "../../lib/logger";

export const requestTraceMiddleware = new Elysia({ name: "request-trace" })
  .derive({ as: "global" }, () => {
    // requestId comes from ALS, seeded by Bun.serve fetch wrapper (D-01).
    const requestId = getObsContext()?.requestId ?? "unknown";
    const log = createRequestLogger(requestId);
    const startTime = performance.now();
    return { requestId, log, startTime };
  })
  .onAfterResponse({ as: "global" }, ({ request, set, log, startTime }) => {
    const duration = Math.round(performance.now() - (startTime as number));
    const url = new URL(request.url);
    (log as any).info(
      {
        method: request.method,
        path: url.pathname,
        status: (set as any).status || 200,
        duration_ms: duration,
      },
      "request completed",
    );
    // x-request-id header writer DELETED (D-23 — single writer in observabilityMiddleware).
  });
```

---

### `apps/api/src/core/middleware/tenant.ts` (MODIFIED — D-04)

**Analog:** Self — one-line insert.

**Insert location:** After line 67 (`if (!tenantId) { throw new Error("No active tenant"); }`) and BEFORE the `return { tenantId, userId, ... }` at line 69.

**Add:**
```typescript
import { setTenantContext } from "@baseworks/observability";
// ... existing code ...

    if (!tenantId) {
      throw new Error("No active tenant");
    }

    // Phase 19 D-04 — publish session-derived tenant/user into ALS so logs,
    // spans, and wrapCqrsBus error capture see a single source of truth.
    setTenantContext({ tenantId, userId: session.user.id });

    return {
      tenantId,
      userId: session.user.id,
      user: session.user,
      session: session.session,
    };
```

---

### `apps/api/src/lib/logger.ts` (MODIFIED — D-19, D-20)

**Analog:** Self — one-line insert into pino options bag.

**Imports pattern add** (to line 1):
```typescript
import pino from "pino";
import { obsContext } from "@baseworks/observability";
```

**Core change** (line 6-16 — add `mixin` option):
```typescript
export const logger = pino({
  level,
  // Phase 19 D-19 — per-call mixin injects ALS fields into every log line
  // (requestId, traceId, spanId, tenantId, userId, locale). Defensive ?? {}
  // so calls outside a request frame (startup logs, shutdown) don't crash.
  mixin: () => obsContext.getStore() ?? {},
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }
    : {}),
});
```

The `createRequestLogger(requestId)` helper at lines 18-21 stays untouched — `logger.child({ requestId })` composes cleanly with mixin output.

---

### `apps/api/src/index.ts` (MODIFIED — D-01, D-12, D-16, D-22)

**Analog:** Self — multi-point surgery.

**Change 1 — imports** (modify line 9, add line after existing observability import):
```typescript
// Remove `localeMiddleware` from the module-auth import (line 9):
import { requireRole } from "@baseworks/module-auth";
//       ^^^^^^^^^^^  — was: { requireRole, localeMiddleware }

// Extend observability barrel import (line 18-22):
import {
  getErrorTracker,
  installGlobalErrorHandlers,
  wrapCqrsBus,
  wrapEventBus,            // NEW (D-16)
  obsContext,              // NEW (D-01)
} from "@baseworks/observability";

// NEW imports for Bun.serve fetch wrapper:
import { defaultLocale } from "@baseworks/i18n";
import { parseNextLocaleCookie } from "./lib/locale-cookie";
import { decideInboundTrace } from "./lib/inbound-trace";
```

**Change 2 — wrapEventBus wire-up** (insert one line after existing wrapCqrsBus at line 46):
```typescript
// Phase 18 D-01 — wrap the CqrsBus so thrown handler exceptions are captured.
wrapCqrsBus(registry.getCqrs(), getErrorTracker());
// Phase 19 D-16 — wrap the EventBus so emit/on get producer/consumer spans.
wrapEventBus(registry.getEventBus(), getTracer());
```

**Change 3 — delete localeMiddleware mount** (remove lines 66-69 entirely):
```typescript
// DELETE these lines — localeMiddleware is subsumed by D-12's Bun.serve fetch wrapper:
//   // Locale capture (Phase 12 D-02) -- reads NEXT_LOCALE cookie into AsyncLocalStorage
//   // so sendInvitationEmail and other auth callbacks can resolve the request locale
//   // without touching better-auth's plugin config.
//   .use(localeMiddleware)
```

**Change 4 — insert observabilityMiddleware before requestTraceMiddleware** (per D-22 order):
```typescript
const app = new Elysia()
  .use(errorMiddleware)              // 1. error first (existing)
  .use(observabilityMiddleware)      // 2. NEW — before request-trace
  .use(requestTraceMiddleware)       // 3. modified to read from ALS
  // (localeMiddleware DELETED — subsumed by Bun.serve wrapper)
  .use(cors({...}))
  .use(swagger())
  // ... rest unchanged ...
```

**Change 5 — replace `app.listen(...)` at lines 151-154 with Bun.serve + obsContext.run** (D-01, D-12):
```typescript
// DELETE:
// app.listen(env.PORT, () => {
//   logger.info({ port: env.PORT, role: env.INSTANCE_ROLE }, "Baseworks API started");
// });

// REPLACE WITH:
Bun.serve({
  port: env.PORT,
  fetch(req, server) {
    const remoteAddr = server.requestIP(req)?.address ?? "";
    const cookieHeader = req.headers.get("cookie");
    const locale = parseNextLocaleCookie(cookieHeader) ?? defaultLocale;
    const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const { traceId, spanId, inboundCarrier } = decideInboundTrace(req, remoteAddr);

    return obsContext.run(
      {
        requestId,
        traceId,
        spanId,
        locale,
        tenantId: null,
        userId: null,
        inboundCarrier,
      },
      () => app.handle(req),
    );
  },
});

logger.info({ port: env.PORT, role: env.INSTANCE_ROLE }, "Baseworks API started");
```

---

### `apps/api/src/worker.ts` (MODIFIED — D-05, D-16)

**Analog:** Self — two insertion points.

**Change 1 — wrapEventBus one-liner after wrapCqrsBus** (mirror `index.ts` D-16 insert at current line 41):
```typescript
wrapCqrsBus(registry.getCqrs(), getErrorTracker());
// Phase 19 D-16 — wrap EventBus for producer/consumer spans in worker-dispatched events.
wrapEventBus(registry.getEventBus(), getTracer());
```

**Change 2 — ALS-seed each job execution (D-05 planner pick)**. Recommended: wrap at `packages/queue/src/index.ts::createWorker` (see next entry). Fallback if D-05 chooses app-layer wrap: modify the `createWorker(...)` call at lines 49-67 to wrap the inner processor body inside `obsContext.run(jobCtx, ...)` — pulling `job.data._requestId` as requestId + generating fresh traceId/spanId.

Example (app-layer fallback shape):
```typescript
const worker = createWorker(
  jobDef.queue,
  async (job) => {
    const jobCtx: ObservabilityContext = {
      requestId: job.data?._requestId ?? crypto.randomUUID(),
      traceId: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
      spanId: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
      locale: defaultLocale,
      tenantId: null, // job handlers may setTenantContext from job.data
      userId: null,
    };
    return obsContext.run(jobCtx, async () => {
      // existing job body — lines 53-65 unchanged
      const jobRequestId = job.data?._requestId;
      const jobLog = jobRequestId
        ? logger.child({ requestId: jobRequestId, jobId: job.id, queue: jobDef.queue })
        : logger.child({ jobId: job.id, queue: jobDef.queue });
      jobLog.info("Job started");
      try {
        const result = await jobDef.handler(job.data);
        jobLog.info("Job completed");
        return result;
      } catch (err) {
        jobLog.error({ err: String(err) }, "Job handler error");
        throw err;
      }
    });
  },
  redisUrl,
);
```

---

### `packages/queue/src/index.ts` (MAYBE MODIFIED — D-05 planner pick, recommended)

**Analog:** Self — extend `createWorker` to wrap `processor` in `obsContext.run`.

**Preferred shape per RESEARCH.md Pitfall 5 recommendation** — central wrap:
```typescript
import { obsContext } from "@baseworks/observability";
import { defaultLocale } from "@baseworks/i18n";

export function createWorker(
  name: string,
  processor: Processor,
  redisUrl: string,
  opts?: WorkerConfig,
): Worker {
  const connection = getRedisConnection(redisUrl);

  // Phase 19 D-05 — central wrap: every processor call runs inside a seeded
  // ALS frame. Zero caller-visible signature change.
  const wrappedProcessor: Processor = (job, token) => {
    const jobCtx = {
      requestId: (job.data as any)?._requestId ?? crypto.randomUUID(),
      traceId: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
      spanId: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
      locale: defaultLocale,
      tenantId: null as string | null,
      userId: null as string | null,
    };
    return obsContext.run(jobCtx, () => processor(job, token));
  };

  return new Worker(name, wrappedProcessor, {
    connection,
    concurrency: opts?.concurrency ?? 5,
  });
}
```

**New dependency:** `packages/queue/package.json` must add `@baseworks/observability` + `@baseworks/i18n` to `dependencies`.

---

### `packages/modules/auth/src/locale-context.ts` (REWRITTEN — D-10, D-11)

**Analog:** Self — preserve API surface, swap internals.

**Delete entirely:** lines 1-3 (`AsyncLocalStorage` import, `Elysia` import, `LocaleStore` interface), line 21-23, line 25 (`localeStorage`), lines 52-68 (entire `localeMiddleware` export with `enterWith` call).

**Keep + rewrite:**
```typescript
// packages/modules/auth/src/locale-context.ts (POST-REWRITE)
import { defaultLocale, type Locale } from "@baseworks/i18n";
import { obsContext } from "@baseworks/observability";

/**
 * Read the current request's locale from the unified observability ALS.
 *
 * Returns `defaultLocale` if called outside any request — e.g. from a
 * BullMQ worker process, migration script, or any non-HTTP entry point.
 * API surface unchanged from Phase 12 (D-11 preserves every call site).
 */
export function getLocale(): Locale {
  return obsContext.getStore()?.locale ?? defaultLocale;
}
```

**Keep `parseNextLocaleCookie`?** No — move it to `apps/api/src/lib/locale-cookie.ts` (D-12 requires it at the Bun.serve boundary). Delete from this file.

---

### `packages/modules/auth/src/index.ts` (MODIFIED — drop localeMiddleware export)

**Change** — line 20:
```typescript
// Before:
// export { localeMiddleware, getLocale } from "./locale-context";

// After:
export { getLocale } from "./locale-context";
```

---

### `apps/api/src/lib/locale-cookie.ts` (NEW — relocated from locale-context.ts)

**Analog:** The `parseNextLocaleCookie` function currently at `packages/modules/auth/src/locale-context.ts` lines 42-50. Move verbatim to this new file.

**Imports + body:**
```typescript
import { defaultLocale, locales, type Locale } from "@baseworks/i18n";

/**
 * Parse the NEXT_LOCALE cookie from a raw Cookie header value.
 * Returns null if the cookie is absent or holds an unsupported locale.
 *
 * Called from the Bun.serve fetch wrapper (apps/api/src/index.ts) once per
 * request, before the Elysia pipeline runs (D-12).
 */
export function parseNextLocaleCookie(cookieHeader: string | null): Locale | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
  if (!match) return null;
  const value = decodeURIComponent(match[1]);
  return (locales as readonly string[]).includes(value)
    ? (value as Locale)
    : null;
}

export { defaultLocale };
```

---

### `apps/api/src/lib/inbound-trace.ts` (NEW — D-07, D-08)

**Analog:** None in repo — first CIDR/traceparent domain. Nearest structural peer: `packages/modules/auth/src/locale-context.ts::parseNextLocaleCookie` (pure function, header parse, early return).

**Imports + body** (from RESEARCH.md lines 641-685, reproduced for the planner):
```typescript
import ipaddr from "ipaddr.js";
import { env } from "@baseworks/config";

const TRUSTED_CIDRS: Array<[ipaddr.IPv4 | ipaddr.IPv6, number]> =
  (env.OBS_TRUST_TRACEPARENT_FROM ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((cidr) => ipaddr.parseCIDR(cidr));

const TRUSTED_HEADER = env.OBS_TRUST_TRACEPARENT_HEADER ?? null;

export function decideInboundTrace(
  req: Request,
  remoteAddr: string,
): {
  traceId: string;
  spanId: string;
  inboundCarrier: Record<string, string>;
} {
  const inbound = req.headers.get("traceparent") ?? "";
  const inboundCarrier: Record<string, string> = inbound
    ? { traceparent: inbound }
    : {};

  let trusted = false;
  if (TRUSTED_CIDRS.length > 0 && remoteAddr) {
    try {
      const addr = ipaddr.parse(remoteAddr);
      trusted = TRUSTED_CIDRS.some(
        ([range, bits]) =>
          addr.kind() === range.kind() && addr.match(range, bits),
      );
    } catch {
      /* malformed remote address — untrusted */
    }
  }
  if (!trusted && TRUSTED_HEADER && req.headers.get(TRUSTED_HEADER)) {
    trusted = true;
  }

  if (trusted && inbound) {
    // Parse W3C traceparent: 00-<32hex>-<16hex>-<2hex>
    const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec(inbound);
    if (m) {
      return { traceId: m[1], spanId: m[2], inboundCarrier: {} };
    }
  }

  // Fresh trace server-side (default for untrusted).
  const traceId = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  const spanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return { traceId, spanId, inboundCarrier };
}
```

---

### `packages/config/src/env.ts` (MODIFIED — D-08)

**Analog:** Self — extend both `serverSchema` (lines 10-48) and `validateObservabilityEnv` (lines 117-175).

**Schema addition** (insert after line 43 — alongside other OBS_* keys):
```typescript
  // Phase 19 D-08 — inbound traceparent trust policy.
  // Default empty → never trust. CIDR syntax validated by validateObservabilityEnv.
  OBS_TRUST_TRACEPARENT_FROM: z.string().optional(),
  OBS_TRUST_TRACEPARENT_HEADER: z.string().optional(),
```

**Validator extension** (insert a new branch in `validateObservabilityEnv` after the TRACER/METRICS_PROVIDER switches, before the closing `}` at line 175 — mirror the per-adapter switch discipline at lines 124-160):
```typescript
  // Phase 19 D-08 — CIDR syntax validation for trust policy.
  // Crash-hard on malformed CIDR; empty/unset is allowed (default never-trust).
  if (env.OBS_TRUST_TRACEPARENT_FROM) {
    const ipaddr = require("ipaddr.js"); // dynamic require: dep added Phase 19 plan 1
    const cidrs = env.OBS_TRUST_TRACEPARENT_FROM
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const cidr of cidrs) {
      try {
        ipaddr.parseCIDR(cidr);
      } catch {
        throw new Error(
          `Invalid CIDR in OBS_TRUST_TRACEPARENT_FROM: "${cidr}". ` +
            `Expected IPv4 (e.g., 10.0.0.0/8) or IPv6 (e.g., ::1/128) notation.`,
        );
      }
    }
  }
```

Mirrors the crash-hard/test-warn pattern at lines 131-141 (`if (isTest) { console.warn(...) } else { throw ... }`) — planner may wrap the throw in the same `isTest` conditional if tests must boot with malformed CIDRs.

---

### Test files — all mirror `wrap-cqrs-bus.test.ts` recording-mock shape

**Analog:** `packages/observability/src/wrappers/__tests__/wrap-cqrs-bus.test.ts` lines 1-80.

**Recording mock pattern** (adapt per port):
```typescript
// Shared shape for wrap-event-bus.test.ts, observability.test.ts, etc.
function makeRecordingTracer() {
  const spans: Array<{
    name: string;
    options?: SpanOptions;
    events: Array<{ type: "setAttribute" | "setStatus" | "recordException" | "end"; payload: any }>;
  }> = [];
  const tracer: Tracer = {
    name: "recording",
    startSpan(name, options) {
      const span = { name, options, events: [] as any[] };
      spans.push(span);
      return {
        end: () => span.events.push({ type: "end", payload: null }),
        setAttribute: (k, v) => span.events.push({ type: "setAttribute", payload: { k, v } }),
        setStatus: (s) => span.events.push({ type: "setStatus", payload: s }),
        recordException: (err) => span.events.push({ type: "recordException", payload: err }),
      };
    },
    withSpan: async (name, fn, options) => {
      const span = { name, options, events: [] as any[] };
      spans.push(span);
      const s: Span = {
        end: () => span.events.push({ type: "end", payload: null }),
        setAttribute: (k, v) => span.events.push({ type: "setAttribute", payload: { k, v } }),
        setStatus: (st) => span.events.push({ type: "setStatus", payload: st }),
        recordException: (err) => span.events.push({ type: "recordException", payload: err }),
      };
      return await fn(s);
    },
    inject: () => {},
    extract: () => {},
    currentCarrier: () => ({}),
  };
  return { tracer, spans };
}
```

**Test structure pattern** (mirror wrap-cqrs-bus.test.ts lines 30-55):
```typescript
import { describe, test, expect, beforeEach } from "bun:test";
// ... import SUT ...

describe("<feature name>", () => {
  let spans: ReturnType<typeof makeRecordingTracer>["spans"];
  let tracer: Tracer;

  beforeEach(() => {
    const rec = makeRecordingTracer();
    spans = rec.spans;
    tracer = rec.tracer;
  });

  test("<invariant>", async () => {
    // ... exercise SUT ...
    expect(spans.length).toBe(1);
    expect(spans[0].events).toContainEqual({ type: "setStatus", payload: { code: "error" } });
  });
});
```

---

### `apps/api/__tests__/observability-context-bleed.test.ts` (NEW — D-27, D-28)

**Analog:** `apps/api/__tests__/telemetry-boot.test.ts` (same dir, same bun:test framework, same app-level scope).
**Analog B:** `packages/observability/src/wrappers/__tests__/wrap-cqrs-bus.test.ts` (mock/recording shape).

**Key structural elements:**
1. `import { describe, test, expect, beforeAll } from "bun:test"`
2. Mock `auth.api.getSession` via `mock.module` or direct stubbing so tenantId toggles per request.
3. Fire N=100 concurrent `app.handle(new Request(...))` via `Promise.all`.
4. Capture pino output via a test transport that records every log line: `pino({ level: "info" }, { write: (chunk) => captured.push(JSON.parse(chunk)) })` or a custom destination stream.
5. Assert: each captured log line's `tenantId` matches the session's tenantId for its request.
6. Sub-suite: perf gate — run with mixin stubbed to `() => ({})` (baseline) vs real (after); fail if p99 regresses >5%.

---

### `biome.json` (MODIFIED — D-24) + `.biome/plugins/no-als-enter-with.grit` (NEW)

**Analog:** None in repo (first GritQL plugin). Research file provides the canonical snippet at lines 809-833.

**biome.json change** (append `plugins` key at top level):
```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "plugins": ["./.biome/plugins/no-als-enter-with.grit"],
  "formatter": { ... existing ... },
  "linter": { "enabled": true },
  "organizeImports": { "enabled": true }
}
```

**`.biome/plugins/no-als-enter-with.grit` content** (from RESEARCH.md lines 810-822):
```gritql
// Ban AsyncLocalStorage#enterWith per CTX-01 / Phase 19.
`$obj.enterWith($args)` where {
  register_diagnostic(
    span = $obj,
    message = "AsyncLocalStorage.enterWith is banned (CTX-01). Use .run(store, fn) instead — see `packages/observability/src/context.ts` mutator helpers.",
    severity = "error"
  )
}
```

---

### `scripts/lint-no-enterwith.sh` (NEW — D-25)

**Analog:** None in repo (first bash lint script — repo has `scripts/validate-docs.ts` but different shape + language).

**Content** (from RESEARCH.md lines 840-868). Key invariants:
- `#!/usr/bin/env bash` + `set -euo pipefail`
- Scope: `packages/ apps/` only (match grep backup in D-26 in-test assertion)
- Allow-list: empty after D-10 removes the one existing site
- Exit 0 on no matches; exit 1 with listing on match

**`package.json` wiring** (append to `scripts` section):
```json
{
  "scripts": {
    "lint": "biome check . && bun run lint:als",
    "lint:als": "bash scripts/lint-no-enterwith.sh"
  }
}
```

---

## Shared Patterns

### Lazy-singleton + get/reset/set trio (Phase 17/18 precedent)

**Source:** `packages/modules/billing/src/provider-factory.ts` lines 19-96 and `packages/observability/src/factory.ts` lines 30-78.
**Apply to:** Any new singleton-per-port surface Phase 19 introduces. (Phase 19's `obsContext` is itself an `AsyncLocalStorage` instance, so the exact trio may not apply; however, if the planner needs a `setObsContext(ctx)` test helper, mirror this shape — null-cached instance + guarded getter + explicit reset.)

**Excerpt** (factory.ts lines 43-78):
```typescript
let tracerInstance: Tracer | null = null;

export function getTracer(): Tracer {
  if (!tracerInstance) {
    const name = process.env.TRACER ?? "noop";
    switch (name) {
      case "noop":
        tracerInstance = new NoopTracer();
        break;
      default:
        throw new Error(`Unknown TRACER: ${name}...`);
    }
  }
  return tracerInstance;
}

export function resetTracer(): void { tracerInstance = null; }
export function setTracer(tracer: Tracer): void { tracerInstance = tracer; }
```

---

### External-wrap discipline (Phase 17 D-01 / Phase 18 D-01)

**Source:** `packages/observability/src/wrappers/wrap-cqrs-bus.ts` lines 1-83.
**Apply to:** `wrapEventBus` (new file); any future cross-cutting concern on CQRS/EventBus/similar surfaces.

**Excerpt — the five-line "bind and replace" pattern** (wrap-cqrs-bus.ts lines 43-64):
```typescript
export function wrapCqrsBus<B extends BusLike>(bus: B, tracker: ErrorTracker): B {
  const origExecute = bus.execute.bind(bus);  // 1. capture original
  const origQuery = bus.query.bind(bus);

  (bus as BusLike).execute = async (command, input, ctx) => {  // 2. replace on the instance
    try {
      return await origExecute(command, input, ctx);
    } catch (err) {
      tracker.captureException(err, { ... });  // 3. cross-cutting concern
      throw err;  // 4. always rethrow — preserve upstream behavior
    }
  };
  // ... query symmetric ...
  return bus;  // 5. mutated in place + returned for chainability
}
```

---

### Elysia middleware plugin shape

**Source:** `apps/api/src/core/middleware/request-trace.ts` lines 17-44 (derive + onAfterResponse); `apps/api/src/core/middleware/error.ts` lines 21-96 (onError global hook).
**Apply to:** `observabilityMiddleware` (new file). Use same `new Elysia({ name: "..." })` shape + `as: "global"` hooks.

**Excerpt — derive + onAfterResponse skeleton** (request-trace.ts lines 17-44):
```typescript
export const requestTraceMiddleware = new Elysia({ name: "request-trace" })
  .derive({ as: "global" }, ({ headers }) => {
    // compute per-request values, return them for Elysia context
    return { requestId, log, startTime };
  })
  .onAfterResponse({ as: "global" }, ({ request, set, requestId, log, startTime }) => {
    // read derived values, emit side effects (log, headers)
  });
```

---

### Crash-hard env validation per selected adapter/feature

**Source:** `packages/config/src/env.ts` lines 117-175.
**Apply to:** `validateObservabilityEnv` extension for `OBS_TRUST_TRACEPARENT_FROM` CIDR syntax check.

**Excerpt — switch + isTest + throw pattern** (env.ts lines 121-141):
```typescript
const isTest = env.NODE_ENV === "test";

switch (env.ERROR_TRACKER ?? "pino") {
  case "sentry":
    if (!env.SENTRY_DSN) {
      if (isTest) {
        console.warn("[env] WARNING: SENTRY_DSN is not set (NODE_ENV=test).");
      } else {
        throw new Error("SENTRY_DSN is required when ERROR_TRACKER=sentry. Set SENTRY_DSN in your environment.");
      }
    }
    break;
  // ...
}
```

Apply verbatim for CIDR validation — wrap parse in try/catch, throw with actionable message on failure.

---

### Noop-first port invariants

**Source:** `packages/observability/src/adapters/noop/noop-tracer.ts` lines 1-84.
**Apply to:** Any new test mock (recording tracer) — return `new NoopSpan()` equivalents when the test only needs "does not crash" semantics, use a recording span when assertions need to inspect emitted events.

**Excerpt — NEVER throws rule** (noop-tracer.ts lines 9 comment + lines 38-59):
```typescript
// Design rule: NEVER throws on any input.
startSpan(_name: string, _options?: SpanOptions): Span {
  return new NoopSpan();
}
async withSpan<T>(_name, fn, _options): Promise<T> {
  return await fn(new NoopSpan());
}
```

Phase 19 SUT (`observabilityMiddleware`, `wrapEventBus`, `wrapCqrsBus` extension) must ALSO never throw from its own code — errors from wrapped callees rethrow; errors from the wrapper's own tracer/tracker calls must be swallowed or guarded.

---

### bun:test recording-mock structure

**Source:** `packages/observability/src/wrappers/__tests__/wrap-cqrs-bus.test.ts` lines 1-80.
**Apply to:** All new Phase 19 test files under `__tests__/` — use `describe`/`test`/`expect`/`beforeEach` from `bun:test`, recording-mock pattern with a `calls[]` array + pure-function mock port implementation.

**Excerpt — recording tracker skeleton** (wrap-cqrs-bus.test.ts lines 9-28):
```typescript
function makeRecordingTracker() {
  const calls: Array<{ err: unknown; scope?: CaptureScope }> = [];
  const tracker: ErrorTracker = {
    name: "recording",
    captureException: (err, scope) => { calls.push({ err, scope }); },
    // ... minimal no-op implementations for the rest of the port ...
  };
  return { tracker, calls };
}
```

Parallel shape for `makeRecordingTracer()` (given above under test-file patterns).

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `.biome/plugins/no-als-enter-with.grit` | CI lint rule (GritQL) | CI lint gate | First GritQL plugin in repo. Pattern sourced from Biome 2.x docs (RESEARCH.md lines 810-822). |
| `apps/api/__tests__/core-files-untouched.test.ts` | Integration (file-hash invariant) | CI lint gate | New kind of test — file content hash comparison against a committed baseline. Planner may adopt the `bun test` `expect(fileHash).toBe(KNOWN_HASH)` shape; nearest analog pattern is any `fs.readFileSync` + `crypto.createHash` in repo, which is not present. |
| `scripts/lint-no-enterwith.sh` | CI lint gate (bash) | CI lint gate | Repo's only existing script is `scripts/validate-docs.ts` (TypeScript). First bash script; use the stock `set -euo pipefail` + `grep -rn` pattern from RESEARCH.md lines 840-868. |

## Metadata

**Analog search scope:**
- `packages/observability/src/{wrappers,adapters,ports,lib}/**`
- `packages/observability/src/{factory,index}.ts`
- `apps/api/src/core/middleware/**`
- `apps/api/src/{index,worker}.ts`
- `apps/api/src/lib/logger.ts`
- `packages/modules/{auth,billing}/src/**` (lazy-singleton + AsyncLocalStorage examples)
- `packages/config/src/env.ts`
- `packages/queue/src/index.ts`
- `packages/observability/src/wrappers/__tests__/wrap-cqrs-bus.test.ts`
- `apps/api/__tests__/telemetry-*.test.ts`

**Files scanned:** ~22 source files + 3 test files.
**Pattern extraction date:** 2026-04-23
