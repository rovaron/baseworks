# Phase 19: Context, Logging & HTTP/CQRS Tracing - Research

**Researched:** 2026-04-23
**Domain:** Observability — AsyncLocalStorage context propagation, Elysia middleware ordering, pino mixin, OTEL span lifecycle (HTTP + CQRS + EventBus), W3C traceparent trust boundary, Biome GritQL custom-rule enforcement.
**Confidence:** HIGH (stack, code patterns), MEDIUM (Biome GritQL syntax — v2.0+ plugin API is young), HIGH (ALS invariants — well-established).

## Summary

Phase 19 is a **wiring phase over an already-established port set**. Phase 17 shipped the tracer port (`startSpan`/`withSpan`/`inject`/`extract`/`currentCarrier`) and factory singletons. Phase 18 shipped `wrapCqrsBus` as the external-wrap precedent, global error handlers, and PII scrubbing. Phase 19 adds: (a) the single `AsyncLocalStorage<ObservabilityContext>` carrier at `packages/observability/src/context.ts`, (b) a `Bun.serve` fetch wrapper that seeds the ALS per request via `.run()` only (never `.enterWith`), (c) pino mixin reading ALS via `obsContext.getStore() ?? {}`, (d) an Elysia `observabilityMiddleware` opening the HTTP server span and setting outbound `traceparent`, (e) internal extensions to `wrapCqrsBus` (signature locked) plus a new `wrapEventBus`, (f) deletion of the `localeMiddleware` + `localeStorage` (the one existing `.enterWith` site in the repo) by folding `locale` into the unified `ObservabilityContext`, (g) a Biome GritQL plugin + grep script + in-test assertion enforcing the `enterWith` ban three ways, and (h) an in-process 100 RPS concurrent-tenant test (`app.handle(new Request(...))` × `Promise.all`) that gates merge on zero context bleed and ≤5% p99 regression.

The Noop tracer remains the default; real OTEL emission ships in Phase 21. Phase 19's spans call the port, and under Noop they no-op at sub-microsecond cost — the test suite still asserts span lifecycle via mock tracers.

**Primary recommendation:** Land Phase 19 in a single coherent plan sequence — context module first, then logger mixin + request-trace rewrite, then observabilityMiddleware + Bun.serve wrap, then wrapEventBus + wrapCqrsBus internal extension, then locale unification, then CI gates, then the 100 RPS test. The 28 CONTEXT.md decisions are locked; no alternatives need evaluation. The remaining Claude's Discretion items (OTEL Link API pattern, CIDR parser, Biome GritQL syntax, wrapEventBus tracker arg, exact hook placements) are answered below with HIGH or MEDIUM confidence.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**ALS seed-and-enrich pattern**
- **D-01:** Replace `app.listen(env.PORT, ...)` in `apps/api/src/index.ts` with `Bun.serve({ port: env.PORT, fetch: req => obsContext.run({ requestId, traceId, spanId, tenantId: null, userId: null, locale }, () => app.handle(req)) })`. Same pattern in `apps/api/src/worker.ts` through a central `createWorker` wrapper (D-05).
- **D-02:** `ObservabilityContext` shape: `requestId`, `traceId`, `spanId`, `locale` are **required** at seed time; `tenantId`, `userId` are **nullable** and mutated after `tenantMiddleware.derive` resolves the session.
- **D-03:** Expose typed mutator helpers — `setTenantContext({ tenantId, userId })`, `setSpan({ traceId, spanId })`, `setLocale(locale)` — all exported from `@baseworks/observability`. Call sites never touch `getStore()` for writes.
- **D-04:** `tenantMiddleware.derive` gains a single line after session resolution: `setTenantContext({ tenantId, userId })`.
- **D-05:** Worker-side ALS seeding lives centrally in the worker-construction path (planner picks `packages/queue/src/index.ts::createWorker` vs `apps/api/src/worker.ts`).

**ALS module placement**
- **D-06:** The single `obsContext` lives at `packages/observability/src/context.ts`. File exports: `obsContext`, `getObsContext()`, `setTenantContext()`, `setSpan()`, `setLocale()`, and the `ObservabilityContext` type.

**Inbound traceparent trust policy**
- **D-07:** Default behavior is fresh trace server-side. Untrusted inbound `traceparent` is attached as a span **Link** (OTEL Link — same-traceId correlation), NOT the parent.
- **D-08:** Trusted origins opt in via `OBS_TRUST_TRACEPARENT_FROM` (CIDR list) or `OBS_TRUST_TRACEPARENT_HEADER`. Default empty. `validateObservabilityEnv()` parses + crash-hard-validates CIDR syntax on startup.
- **D-09:** Outbound `traceparent` is set on **every response** regardless of inbound trust decision.

**Locale unification**
- **D-10:** Delete `localeStorage` and `localeMiddleware`. Add `locale: Locale` to `ObservabilityContext`.
- **D-11:** Keep `getLocale()` as an exported function at `packages/modules/auth/src/locale-context.ts` — body becomes `return obsContext.getStore()?.locale ?? defaultLocale;`. Zero call-site migration.
- **D-12:** Cookie-to-locale parse moves into the Bun.serve fetch wrapper (same function that seeds ALS).

**Span naming**
- **D-13:** HTTP span name: `{method} {route_template}`. Attributes: `http.method`, `http.route`, `http.status_code`, `tenant.id`, `user.id`.
- **D-14:** CQRS span name: `cqrs.command` or `cqrs.query` (fixed). Attribute `cqrs.name=auth:create-tenant`.
- **D-15:** EventBus: wrap both `emit()` and `on()`. `emit` → `event.publish` (kind=producer); each listener → `event.handle` (kind=consumer). Child spans linked to publish span. Listener try/catch calls `span.setStatus({ code: 'error' })` + `span.recordException(err)` before swallowing.
- **D-16:** `wrapEventBus` lives at `packages/observability/src/wrappers/wrap-event-bus.ts`, applied in both `apps/api/src/index.ts` and `apps/api/src/worker.ts` immediately after `wrapCqrsBus(...)`.

**wrapCqrsBus extension**
- **D-17:** Signature stays identical to Phase 18. Body extended to: read `obsContext.getStore()`, open `cqrs.command` / `cqrs.query` span via `getTracer()`, on throw: `span.recordException + setStatus` BEFORE existing `tracker.captureException`. ALS is source of truth — overrides ctx.tenantId.
- **D-18:** Zero edits to the 2 existing call sites (`apps/api/src/index.ts:46`, `worker.ts:41`).

**Pino mixin (CTX-03)**
- **D-19:** One-line change in `apps/api/src/lib/logger.ts` — add `mixin: () => (obsContext.getStore() ?? {})` to `pino({...})` options.
- **D-20:** The mixin is defensive — `?? {}` — so calls outside a request frame don't crash.

**Elysia observabilityMiddleware**
- **D-21:** New plugin `apps/api/src/core/middleware/observability.ts`. Hooks: `.onRequest` (decide trust, open provisional span), `.onBeforeHandle` (rename span with resolved route), `.onAfterResponse` (set attrs, end span, write traceparent + x-request-id headers), `.onError` (span status=error).
- **D-22:** Middleware order: error → observability (new, before request-trace) → request-trace (modified) → [localeMiddleware DELETED] → remaining.
- **D-23:** `requestTraceMiddleware` evolves to read requestId from ALS; delete its `x-request-id` header writer (moved to observabilityMiddleware — single writer).

**CI enforcement of enterWith ban**
- **D-24:** Primary gate — Biome custom GritQL lint rule `no-async-local-storage-enterWith` configured via biome.json `plugins` array.
- **D-25:** Secondary gate — grep script `scripts/lint-no-enterwith.sh` with empty allow-list (D-10 removes the one existing usage).
- **D-26:** Phase 19 does NOT ship PR-time ci.yml (deferred since Phase 18). Gates run in `bun run lint` + in-test grep.

**Concurrent-tenant load test**
- **D-27:** `apps/api/__tests__/observability-context-bleed.test.ts` — mock `auth.api.getSession` with toggled tenantId, fire 100 concurrent `app.handle(...)` via Promise.all (50 tenantA + 50 tenantB interleaved). Capture pino output via test transport; assert each response's log line shows the expected tenantId.
- **D-28:** Same test captures p50+p99 in two sub-suites (baseline with mixin noop'd, after-mixin with real ALS read). Hard-fail if p99 regresses >5% vs baseline.

### Claude's Discretion (research resolves below)

- Exact OTEL Link API usage pattern for attaching untrusted-inbound-traceparent (D-07).
- Exact CIDR parser for `OBS_TRUST_TRACEPARENT_FROM` — `ipaddr.js` vs `netmask` vs hand-rolled.
- Pino mixin closure inline vs exported `createObsMixin()`.
- Precise Biome GritQL custom rule syntax.
- Three separate mutator functions vs one `updateObsContext(partial)`.
- `wrapEventBus` tracker-only vs tracer+tracker.
- Exact directory naming for observability middleware file.

### Deferred Ideas (OUT OF SCOPE)

- Drizzle/postgres.js DB-level spans (TRC-future-01; revisit Phase 21).
- BullMQ traceparent propagation (Phase 20 / CTX-04, TRC-03).
- OTEL Views + collector cardinality guardrails (Phase 21 / MET-02).
- Sampling strategy decision (Phase 21).
- PR-time ci.yml (deferred since Phase 18).
- OBS_SAMPLE_RATE env var (Phase 21).
- Span link for inbound traceparent when trusted (parent case lands now but activates only on operator opt-in).
- wrapEventBus error-tracker integration for listener errors (span status only, no tracker capture).
- Frontend browser-side trace propagation (future frontend-observability phase).
- Tracestate header forwarding (minimal-carrier discipline).
- Baggage header propagation (future cross-service phase).

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CTX-01 | Single `AsyncLocalStorage<ObservabilityContext>` carrying `{requestId, traceId, spanId, tenantId, userId}`, with Biome/ESLint rule banning `enterWith` | D-06 places single ALS at `packages/observability/src/context.ts`. D-10 deletes the only existing `.enterWith` site (locale-context.ts). D-24/25/26 three-layer ban: Biome GritQL plugin + grep script + in-test assertion. See §"Biome GritQL Plugin" and §"Three-Layer enterWith Ban" below. |
| CTX-02 | Elysia `observabilityMiddleware` populating ALS, reading inbound `traceparent` or starting new, deriving tenant/user from tenant middleware | D-21 defines hook structure (`.onRequest` → `.onBeforeHandle` → `.onAfterResponse` → `.onError`). D-07/08 trust policy: default fresh-trace, CIDR/header-gated parent adoption. D-04 `setTenantContext` one-liner in tenant middleware. See §"Elysia Middleware Order" and §"Trust Boundary Parsing" below. |
| CTX-03 | Every pino log line includes `trace_id`, `span_id`, `requestId`, `tenantId` via logger mixin — zero call-site changes | D-19/20 one-line pino `mixin: () => (obsContext.getStore() ?? {})` option. Pino invokes mixin **per log call** (not per child creation), so child loggers' bindings compose cleanly with ALS-derived fields. See §"Pino Mixin Semantics" below. |
| TRC-01 | Span per HTTP request with method + route template + status, accepting inbound `traceparent` + emitting outbound | D-13 naming + attribute set. D-21 span opened in `.onRequest` (provisional name) and renamed in `.onBeforeHandle` once Elysia resolves route template. D-09 outbound traceparent on every response. See §"HTTP Span Lifecycle" below. |
| TRC-02 | CqrsBus + EventBus externally wrapped — no edits to `core/cqrs.ts`, `core/event-bus.ts`, or any handler | D-17 extends existing `wrapCqrsBus` internals (signature locked by Phase 18). D-15/16 new `wrapEventBus` at `packages/observability/src/wrappers/wrap-event-bus.ts`, called from the two entrypoints. See §"CqrsBus + EventBus Wrappers" below. |

</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| ALS context carrier module | `@baseworks/observability` (package) | — | D-06 locks placement. Consumed by apps/api, module-auth, worker. No cross-package cycle. |
| Bun.serve fetch wrapper (seed ALS, parse locale cookie, trust-decide on traceparent) | `apps/api` (entrypoint) | `@baseworks/observability` (consumes obsContext + trust config) | Single per-request entry point; Elysia runs inside the `als.run` frame. |
| Elysia `observabilityMiddleware` (HTTP span lifecycle) | `apps/api` (app-layer middleware) | `@baseworks/observability` (tracer port) | Follows precedent: `error.ts`, `tenant.ts`, `request-trace.ts` all app-layer. |
| Pino mixin (ALS→log field injection) | `apps/api/src/lib/logger.ts` | `@baseworks/observability` (obsContext import) | Logger instance lives in apps/api; mixin reads from shared obsContext. |
| CQRS/EventBus span wrappers | `@baseworks/observability` (external wrappers) | `apps/api` (wire-up at registry boot) | External-wrap discipline locked since Phase 17 D-01 / Phase 18 D-01. |
| Worker job ALS seeding | `packages/queue` OR `apps/api/src/worker.ts` | — | D-05 defers choice to planner. `packages/queue/src/index.ts::createWorker` currently accepts a `processor` callback — planner must decide whether to wrap at the queue-package boundary (changes createWorker signature behaviorally without breaking callers) vs wrap in `apps/api/src/worker.ts` job loop (zero queue-package edit, but duplication risk if future apps add workers). See §"Worker-Side ALS Placement" below. |
| Biome GritQL lint plugin (enterWith ban) | repo root (`biome.json` + `.biome/plugins/*.grit`) | — | Tooling concern; lives at repo root per Biome plugin convention. |
| grep-based CI script (belt-and-suspenders) | `scripts/lint-no-enterwith.sh` | `package.json` (wire into `lint:als` → `lint`) | Mirrors existing `docker:*` / `db:*` script convention. |
| 100 RPS concurrent-tenant test | `apps/api/__tests__/` | — | In-process test (no sidecars) — naturally lives next to the code it exercises. |
| CIDR parser for trust policy | `packages/config/src/env.ts` (inside `validateObservabilityEnv`) | — | Keeps crash-hard-on-startup invariant with Phase 17/18 precedent. |

## Standard Stack

### Core (new dependencies Phase 19 needs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ipaddr.js` | ^2.3.0 (published 2025-11-28) | CIDR parsing for `OBS_TRUST_TRACEPARENT_FROM` — IPv4 + IPv6 support via `parseCIDR(string)` + `match(range, bits)` API | Widely-used (dependency of `body-parser`, `express`, `pac-resolver`, etc.); zero dependencies; small (~30KB); pure JS so Bun-compatible; authored by @whitequark. `netmask` (v2.1.1) is IPv4-only per its README — insufficient for D-08's IPv6 requirement. Hand-rolling is wasteful given the edge cases in IPv6 CIDR (`::ffff:0:0/96` etc.). [VERIFIED: npm view ipaddr.js version → 2.3.0] [CITED: https://github.com/whitequark/ipaddr.js/] |

**No other new dependencies.** Phase 19 uses already-installed packages:
- `@baseworks/observability` (workspace, already present) — tracer port, factory, wrapCqrsBus
- `@opentelemetry/api` (^1.9.1, already in observability package.json) — `SpanKind` enum + Link type if planner needs them for the Noop tracer's type surface (Noop tracer itself doesn't import OTEL; OtelTracer in Phase 21 will)
- `pino` (^10.3.1 latest; `^10.0.0` per observability/package.json) — mixin API [VERIFIED: npm view pino version → 10.3.1, published 2026-02-09]
- `elysia` (^1.4.0 per module-auth/package.json) — middleware + lifecycle hooks
- `node:async_hooks` (Bun builtin) — AsyncLocalStorage
- `@baseworks/i18n` (workspace) — `Locale` type + `locales` + `defaultLocale` for cookie parsing
- `@baseworks/config` (workspace) — env schema extension for OBS_TRUST_TRACEPARENT_* keys

**Installation:**
```bash
bun add -w ipaddr.js  # only new runtime dep
# (add to packages/config if CIDR parse lives in validateObservabilityEnv;
#  OR to packages/observability if the parser helper lives there — planner decides.
#  Recommendation: packages/config, same location as validateObservabilityEnv.)
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ipaddr.js` | `netmask` | IPv4-only; fails D-08 IPv6 requirement |
| `ipaddr.js` | `ip-cidr` | Fewer downloads, less battle-tested; no meaningful advantage |
| `ipaddr.js` | hand-rolled CIDR match | IPv6 CIDR is deceptively hard (prefix compression, zone IDs, IPv4-mapped addresses); hand-rolling for a single env var is Pitfall 2-adjacent ("don't hand-roll standard libs") |
| inline pino mixin in logger.ts | exported `createObsMixin()` from `@baseworks/observability` | Exporting is nicer if a second app ever needs it, but adds surface area today. **Recommendation: inline** (one-liner; trivially moveable if needed). |
| three mutator helpers (`setTenantContext`, `setSpan`, `setLocale`) | one `updateObsContext(partial)` | Three named functions search-highlight the intent and the lint rule is cleaner (allow-list by exact name). **Recommendation: three helpers** per D-03 wording. |

## Architecture Patterns

### System Architecture Diagram (data flow per request)

```
Client request (HTTP POST /api/billing/checkout)
        │
        │  headers: [cookie: NEXT_LOCALE=pt], [traceparent: 00-...] (untrusted)
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│ Bun.serve fetch handler (apps/api/src/index.ts, D-01/D-12)  │
│   1. Generate requestId (crypto.randomUUID or incoming x-request-id header)
│   2. Parse NEXT_LOCALE cookie → locale (or defaultLocale)    │
│   3. Decide trust for inbound traceparent (D-07/D-08):       │
│      - check remote-addr vs OBS_TRUST_TRACEPARENT_FROM (CIDR)│
│      - check OBS_TRUST_TRACEPARENT_HEADER presence           │
│      - if trusted → extract traceId/spanId from traceparent  │
│      - else → generate fresh traceId/spanId; keep inbound    │
│        for later attachment as a Link                        │
│   4. obsContext.run({ requestId, traceId, spanId, locale,    │
│      tenantId: null, userId: null }, () => app.handle(req))  │
└──────────────────────────┬──────────────────────────────────┘
                           │ (inside als.run frame)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ errorMiddleware.onError (Phase 18 site, unchanged)           │
│   — fires only on thrown errors                              │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ observabilityMiddleware (NEW, D-21)                          │
│   .onRequest: open HTTP span via tracer.startSpan(           │
│     `${method} unknown`, { kind: 'server', links: [...] })   │
│     setSpan({ traceId, spanId }) — publishes into ALS        │
│   .onBeforeHandle: rename span `${method} ${context.route}`  │
│                    setAttribute('http.route', route)         │
│                    setAttribute('http.method', method)       │
│   .onError: span.recordException(err);                       │
│             span.setStatus({ code: 'error' })                │
│   .onAfterResponse: setAttribute('http.status_code', status);│
│                     setAttribute('tenant.id', store.tenantId)│
│                     setAttribute('user.id', store.userId)    │
│                     span.end()                               │
│                     set.headers['traceparent'] = W3C encoded │
│                     set.headers['x-request-id'] = requestId  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ requestTraceMiddleware (MODIFIED, D-23)                      │
│   .derive: requestId = getObsContext()?.requestId (from ALS) │
│            log = createRequestLogger(requestId)              │
│            startTime = performance.now()                     │
│   .onAfterResponse: log.info({ method, path, status, dur })  │
│   — x-request-id header writer REMOVED (moved to observability)│
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ [localeMiddleware DELETED — folded into Bun.serve wrapper]   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
      (cors, swagger, authRoutes — unchanged)
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ tenantMiddleware (MODIFIED, D-04)                            │
│   .derive: session = auth.api.getSession(headers)            │
│            ... existing auto-select-first-org logic ...      │
│            setTenantContext({ tenantId, userId })  ← ONE NEW LINE
│            return { tenantId, userId, user, session }        │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
   Handler dispatches cqrs command → wrapCqrsBus (MODIFIED, D-17)
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ wrapCqrsBus.execute(commandName, input, ctx):                │
│   store = obsContext.getStore()                              │
│   tracer.withSpan('cqrs.command', { attrs: {                 │
│     cqrs.name: commandName, tenant.id: store.tenantId,       │
│     user.id: store.userId, request.id: store.requestId       │
│   } }, async (span) => {                                     │
│     try { return await origExecute(...) }                    │
│     catch (err) {                                            │
│       span.recordException(err)                              │
│       span.setStatus({ code: 'error' })                      │
│       tracker.captureException(err, { tenantId: store.tenantId, extra: { commandName, requestId, traceId } })
│       throw err                                              │
│     }                                                        │
│   })                                                         │
└─────────────────────────────────────────────────────────────┘

   Handler emits domain event → wrapEventBus (NEW, D-15/D-16)
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ wrapEventBus.emit(event, data):                              │
│   withSpan('event.publish', { kind: 'producer',              │
│     attrs: { event.name: event, tenant.id, request.id } })   │
│     origEmit(event, data)  ← inside span frame               │
│   end                                                        │
│                                                              │
│ wrapEventBus.on(event, handler) installs wrapping listener:  │
│   each call runs in its own child span                       │
│   withSpan('event.handle', { kind: 'consumer',               │
│     attrs: { event.name, event.listener.index } })           │
│   try { await handler(data) }                                │
│   catch (err) {                                              │
│     span.recordException(err); span.setStatus('error')       │
│     // swallow (preserves existing event-bus.ts behavior)    │
│   }                                                          │
└─────────────────────────────────────────────────────────────┘

   Every pino log call along the way:
   logger.info({ custom: field }, "msg")
     pino invokes mixin() per-call → merges { requestId, traceId,
     spanId, tenantId, userId, locale } from obsContext.getStore()
```

### Recommended Project Structure

```
packages/observability/src/
├── context.ts                 # NEW (D-06) — obsContext + helpers + type
├── wrappers/
│   ├── wrap-cqrs-bus.ts      # MODIFIED (D-17 internals; signature locked)
│   └── wrap-event-bus.ts     # NEW (D-15/D-16)
└── index.ts                   # MODIFIED — add barrel exports for new surfaces

apps/api/src/
├── index.ts                   # MODIFIED (D-01, D-12, D-16, D-22)
├── worker.ts                  # MODIFIED (D-05, D-16)
├── lib/logger.ts              # MODIFIED (D-19 one-line mixin)
├── core/middleware/
│   ├── observability.ts      # NEW (D-21)
│   ├── request-trace.ts      # MODIFIED (D-23)
│   ├── tenant.ts             # MODIFIED (D-04 one-line setTenantContext)
│   └── error.ts              # UNCHANGED (Phase 18 site)
├── core/cqrs.ts              # NO EDITS (invariant)
├── core/event-bus.ts         # NO EDITS (extended via wrapEventBus)
└── __tests__/
    └── observability-context-bleed.test.ts  # NEW (D-27/D-28)

packages/modules/auth/src/
├── locale-context.ts         # REWRITTEN (D-10/D-11) — getLocale preserved,
│                             #   localeStorage + localeMiddleware deleted
└── index.ts                  # MODIFIED — drop localeMiddleware export

packages/queue/src/
└── index.ts                  # MAYBE MODIFIED (D-05 planner choice)

packages/config/src/
└── env.ts                    # MODIFIED (D-08) — OBS_TRUST_TRACEPARENT_*
                              #   keys + CIDR parse in validateObservabilityEnv

biome.json                    # MODIFIED (D-24) — plugins array
.biome/plugins/
└── no-als-enter-with.grit   # NEW (D-24) — GritQL rule file

scripts/
└── lint-no-enterwith.sh     # NEW (D-25)

package.json                  # MODIFIED — add lint:als script; include in lint
```

### Pattern 1: Bun.serve + als.run as the single request entry point

**What:** Replace `app.listen(env.PORT, cb)` with a `Bun.serve({ port, fetch })` that wraps `app.handle(req)` in `obsContext.run(seedCtx, () => ...)`. This is the only seed point — no other call site calls `obsContext.run()` for HTTP traffic. The als frame closes automatically when the Promise returned by `app.handle(req)` resolves.

**When to use:** Every HTTP request in apps/api. The same pattern applies to workers (D-05) where `createWorker` wraps each job's processor call in `obsContext.run(jobSeedCtx, () => handler(job))`.

**Example:**
```typescript
// apps/api/src/index.ts (post-Phase 19)
// Source: locked decision D-01/D-12; pattern verified against Bun 1.3.10 + Elysia 1.4.0 BunAdapter
// CITED: https://bun.com/docs/guides/ecosystem/elysia
import { obsContext, setTenantContext } from "@baseworks/observability";
import { parseNextLocaleCookie } from "./lib/locale-cookie";
import { decideInboundTrace } from "./lib/inbound-trace";

const server = Bun.serve({
  port: env.PORT,
  fetch(req, server) {
    const remoteAddr = server.requestIP(req)?.address ?? "";
    const cookieHeader = req.headers.get("cookie");
    const locale = parseNextLocaleCookie(cookieHeader) ?? defaultLocale;
    const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const { traceId, spanId, inboundCarrier } = decideInboundTrace(req, remoteAddr);
    return obsContext.run(
      { requestId, traceId, spanId, locale, tenantId: null, userId: null, inboundCarrier },
      () => app.handle(req),
    );
  },
});

logger.info({ port: env.PORT, role: env.INSTANCE_ROLE }, "Baseworks API started");
```

**CRITICAL:** `Bun.serve` returns a Promise-returning fetch handler. The als frame is alive for the entire async flow because `als.run()` returns the return value of its callback (the Promise from `app.handle`). No microtask loses the context. This has been verified pattern since Node 16 / Bun 1.0. [CITED: Node.js AsyncLocalStorage docs — `.run(store, callback[, ...args])` returns whatever the callback returns]

### Pattern 2: Pino mixin reads ALS at log time

**What:** `pino({ mixin: () => obsContext.getStore() ?? {} })` is called **per log invocation** — not per logger construction and not per child creation. This means every `logger.child({...})` still works unchanged; the mixin output merges with both the parent logger's bindings and the per-call object.

**When to use:** The single pino instance in `apps/api/src/lib/logger.ts`. Worker uses the same logger (imported from the same file), so worker logs also get ALS fields.

**Example:**
```typescript
// apps/api/src/lib/logger.ts (post-Phase 19)
// Source: D-19/D-20. Pino mixin per-call semantics verified.
// CITED: https://github.com/pinojs/pino/blob/main/docs/api.md (mixin section)
import pino from "pino";
import { obsContext } from "@baseworks/observability";

const level = process.env.LOG_LEVEL ?? "info";
const isDev = process.env.NODE_ENV === "development";

export const logger = pino({
  level,
  mixin: () => obsContext.getStore() ?? {},  // ← ONE NEW LINE
  ...(isDev
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});

export function createRequestLogger(requestId: string) {
  return logger.child({ requestId });
}
```

The mixin signature per pino docs: `mixin(mergeObject, level, logger?) => object`. Returning the ALS store means: in-call bindings (explicit `{foo: bar}` at the call site) take priority by default; mixin fields fill in when absent. This is desired — a handler that wants to override `tenantId` at a specific call can do so.

### Pattern 3: External-wrap discipline for CqrsBus + EventBus

**What:** Wrappers at `packages/observability/src/wrappers/` intercept at the public API surface (`execute`, `query`, `emit`, `on`) without touching the core class. This preserves the D-01 invariant from Phase 17/18 ("zero edits to `apps/api/src/core/cqrs.ts` or `apps/api/src/core/event-bus.ts`").

**When to use:** Any cross-cutting concern (tracing, error capture, metrics) on CQRS or EventBus. Never edit the core class; always wrap externally at registry boot time.

**Example:** see §"CqrsBus + EventBus Wrappers" below.

### Pattern 4: Three-layer enterWith ban (defense in depth)

**What:** Pitfall 3 ("ALS context bleed") costs tenant-A-sees-tenant-B in production — so the ban gets three enforcement layers:
1. **Biome GritQL plugin** (primary) — fails `biome check .` on `.enterWith(` where receiver is AsyncLocalStorage-typed
2. **grep script** `scripts/lint-no-enterwith.sh` (secondary) — fails if any `.enterWith(` occurs in `packages/ apps/` (allow-list: empty after D-10)
3. **In-test assertion** — `bun test` runs `grep -r "\.enterWith(" packages/ apps/ --include="*.ts"` and asserts empty output (D-26)

**When to use:** Phase 19. All three layers wire in so one regression doesn't slip through a tool update or misconfiguration.

### Anti-Patterns to Avoid

- **Don't use `obsContext.enterWith(...)`** — primary failure mode (ARCHITECTURE.md line 410-421 suggested it; CTX-01 bans it; D-01 uses `.run()` only).
- **Don't store full request/DB-client/session objects in ALS** — per PITFALLS.md §98, store IDs only. `ObservabilityContext` is ~7 small scalar fields.
- **Don't open the HTTP span outside the `als.run` frame** — `observabilityMiddleware.onRequest` must execute *inside* the Bun.serve wrapper's frame so `setSpan({traceId, spanId})` writes to the right store.
- **Don't re-parse `traceparent` in multiple places** — the Bun.serve wrapper decides trust + extracts once; the middleware reads the extracted values from `inboundCarrier` + the seeded ALS fields.
- **Don't `await Sentry.close()` on the hot path** (ref PITFALLS.md §562) — Phase 19 captures via Phase 18's existing `tracker.captureException` which is async-fire-and-forget under Sentry/Pino/Noop.
- **Don't make `wrapEventBus` replace `event-bus.ts:54-64` try/catch** — the swallow+log is canonical; wrapping adds span recording *before* the swallow, it does not replace it.
- **Don't rename the span in `.onRequest`** — `context.route` is not yet resolved. Open with provisional name, rename in `.onBeforeHandle` once the route template is known.
- **Don't set the `x-request-id` header in both `requestTraceMiddleware` and `observabilityMiddleware`** — single writer in `observabilityMiddleware.onAfterResponse` (D-23 deletes the duplicate writer).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CIDR matching (IPv4+IPv6) | String-split + bitmask math in `validateObservabilityEnv` | `ipaddr.js` — `parseCIDR` + `match` | IPv6 CIDR has prefix compression, zone IDs, IPv4-mapped addresses; hand-rolling is a guaranteed pitfall. |
| W3C traceparent parse | Regex-match the `00-<32hex>-<16hex>-<2hex>` format yourself | Use tracer port's `extract(carrier)` when/if Phase 17 NoopTracer supports it; else the Phase 21 OTEL adapter handles it. For Phase 19 Noop: write a **tiny** 10-line parser inline (the W3C format is simple + locked; `ipaddr.js`-class dependency would be overkill). | traceparent is small and stable; the parse is 5 regex groups. Unlike CIDR, this is genuinely trivial. |
| AsyncLocalStorage | Roll your own continuation-passing wrapper or use closures to thread context | `new AsyncLocalStorage<ObservabilityContext>()` | Node/Bun built-in; battle-tested; the whole point of Phase 19. |
| Pino context injection | `logger.child({ ...obsContext.getStore() })` in every handler | Pino `mixin` option | Per-call, zero call-site edits, literally CTX-03's "no call-site changes" requirement. |
| Span linking when trust-decision is "untrusted" | Duplicate the trace in logs yourself | OTEL Link (`SpanOptions.links` at `startSpan`) — preferred per spec (lets samplers consider the link) | Span links are the semantic-conventions answer for "related trace but not parent." |
| Custom EventEmitter for tracing | Fork `TypedEventBus` and add tracing inside | Wrap at the `emit`/`on` boundary (same pattern as `wrapCqrsBus`) | External-wrap discipline — zero edits to `core/event-bus.ts`. |
| Biome ESLint-compatible rule | Hand-write an AST visitor in TypeScript | Biome 2.0+ GritQL `.grit` plugin — 5-line declarative pattern | Biome's native plugin system; wires cleanly into `bun run lint`. |

**Key insight:** Phase 19 is deliberately light on new dependencies. The only new runtime dep is `ipaddr.js`. Everything else extends existing ports and patterns.

## Runtime State Inventory

> This is not a rename/refactor phase, but Phase 19 DOES delete the `localeStorage` AsyncLocalStorage and `localeMiddleware` (D-10). Two categories need explicit verification.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — ALS is in-process memory, zero persisted state. Tenant data keyed by `tenantId` remains unchanged. | None. |
| Live service config | None — no external services reference `localeStorage` or `localeMiddleware`. | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | **New keys added**: `OBS_TRUST_TRACEPARENT_FROM` (CIDR list), `OBS_TRUST_TRACEPARENT_HEADER` (header name). Both optional (default empty → never-trust). No renames of existing keys. | Document in `.env.example` if one exists; otherwise, document in CONTEXT.md deferred or a DOC-04-adjacent runbook. |
| Build artifacts / installed packages | None. New `ipaddr.js` dep will land via `bun install` during Phase 19 plan 1. | Run `bun install` after package.json change. |

**Additional consideration:** the `getLocale()` export signature at `packages/modules/auth/src/locale-context.ts` stays identical (D-11), so no downstream caller (`sendInvitationEmail`, auth callbacks) needs editing. Verified by reading the current file — `getLocale(): Locale` is a zero-arg function; D-11 preserves that exact signature. [VERIFIED: read of `packages/modules/auth/src/locale-context.ts` lines 34-36.]

## Common Pitfalls

### Pitfall 1: AsyncLocalStorage context bleed under concurrent load

**What goes wrong:** Developer calls `als.enterWith(ctx)` instead of `als.run(ctx, fn)` at request entry. The context is set on the current async task and inherited by every subsequent async operation on the event loop, including the next request on the same task. Tenant A sees tenant B's data in logs — or worse, in DB queries if tenantId is pulled from ALS.

**Why it happens:** `enterWith` is documented as a convenience in Node's API surface but is almost never what you want on a long-lived server. Tests run sequentially, so leaks don't reproduce locally.

**How to avoid:**
1. Use `als.run(ctx, fn)` at exactly one place (Bun.serve fetch wrapper, D-01).
2. Use exported typed mutator helpers (`setTenantContext`, `setSpan`, `setLocale`) for intra-request enrichment — they mutate the existing store in place, not create a new frame.
3. Three-layer enterWith ban (Biome + grep + in-test).
4. The 100 RPS concurrent-tenant test (D-27) surfaces bleed reliably at N=100 + `Promise.all`.

**Warning signs:** Log lines for one tenant carry another tenant's `tenant_id` under load. p99 latency climbs steeply (suggests ALS misuse, not OTEL itself).

**[VERIFIED: PITFALLS.md §80-107]**

### Pitfall 2: W3C `traceparent` pollution from untrusted clients

**What goes wrong:** Public client sends a forged `traceparent: 00-<crafted-traceid>-<crafted-spanid>-01`. If you accept it as parent, the attacker controls the trace ID space (cardinality DoS on Tempo) and can correlate their fake trace with your real one.

**Why it happens:** OTEL auto-instrumentation defaults to "always trust upstream." Baseworks is a fork-and-ship starter kit — operators may deploy it behind diverse networks.

**How to avoid:** D-07 default: fresh trace server-side; inbound traceparent becomes a **Link** (same-traceId correlation in Tempo UI without making it the parent). D-08: operators behind a trusted gateway opt in via CIDR env list. `validateObservabilityEnv()` crash-hards if the CIDR syntax is invalid.

**Warning signs:** Trace graph in Tempo shows unexpected traceIds with no server-side origin. High-cardinality traceID explosion in the collector.

**[VERIFIED: PITFALLS.md §581]**

### Pitfall 3: Elysia middleware ordering — span lifecycle vs `context.route` resolution

**What goes wrong:** HTTP span name needs the route template (`/api/tenants/:id`), not the raw path. Elysia resolves `context.route` during routing (before `.onBeforeHandle`). Opening the span in `.onRequest` with the final name requires data you don't yet have.

**Why it happens:** Developers split the span open/close across hooks without understanding Elysia's lifecycle shape.

**How to avoid:** Two-phase span naming.
- `.onRequest` opens with provisional `{method} unknown` (kind=server, links populated from untrusted inbound).
- `.onBeforeHandle` renames to `{method} {context.route}` + sets `http.route` + `http.method` attributes.
- `.onAfterResponse` sets status_code + tenant.id + user.id (now post-auth) + calls `span.end()`.
- `.onError` sets status=error + records exception (but does NOT end the span — `.onAfterResponse` still runs after `.onError` in Elysia's lifecycle and ends the span there; verify during TDD).

**Warning signs:** Spans named `GET /api/tenants/abc-uuid-1234` (high cardinality, wrong) instead of `GET /api/tenants/:id`. `http.status_code` attribute missing.

**[MEDIUM confidence — Elysia 1.4 lifecycle for `context.route` availability is documented at https://elysiajs.com/essential/life-cycle but the page I fetched didn't include the field-by-field availability matrix. Plan Task 1 should confirm empirically via a TDD unit test.]**

### Pitfall 4: Pino mixin closure capturing stale context

**What goes wrong:** Mixin function is created once at logger construction and called per log invocation. If the closure captures anything other than `obsContext` (which is itself a stable module-level singleton), it will serve stale data.

**Why it happens:** Developer writes `mixin: () => ({...obsContext.getStore(), requestId})` where they accidentally merge a closure-captured `requestId` — but the closure was created at module init time, not per-call.

**How to avoid:** The mixin body MUST be purely `obsContext.getStore() ?? {}` — no explicit field extraction, no closure captures. All dynamic state comes from `getStore()`'s runtime lookup. D-19 specifies exactly this shape.

**Warning signs:** Log lines show `requestId: undefined` (empty `ObservabilityContext` at module init) mixed with call-time explicit bindings, or all log lines show the *same* requestId across requests.

**[VERIFIED: Pino docs — https://github.com/pinojs/pino/blob/main/docs/api.md says mixin is called "each time one of the active logging methods is called"]**

### Pitfall 5: Worker job ALS placement — race between `processor` registration and wrap site

**What goes wrong:** If the ALS wrap is at the `createWorker` boundary (packages/queue), future callers that pass their own processor function must not ALSO wrap internally — risk of double-frame. If the wrap is at the `apps/api/src/worker.ts` job loop, each new `worker.on`-style handler in the future must remember to wrap (copy-paste hazard).

**Why it happens:** Central boundaries are better for invariants; call-site wraps leak with project growth.

**How to avoid:** Recommendation — wrap at `packages/queue/src/index.ts::createWorker` by extending the `processor` argument: internally wrap the user-supplied processor in `obsContext.run(jobSeedCtx, () => userProcessor(job))`. The signature of `createWorker(name, processor, redisUrl, opts)` stays identical; behavior becomes "every processor runs inside a seeded als frame." Zero caller-visible change, zero risk of forgetting to wrap at a future call site. Requires `@baseworks/queue` to add `@baseworks/observability` as a dependency — it currently has none. Alternative: wrap at `apps/api/src/worker.ts` lines 49-68 (zero queue-package edit but copy-paste risk).

**Warning signs:** Log lines from jobs show no `requestId`/`traceId`. Jobs that enqueue sub-jobs carry over the wrong parent requestId (Pitfall 1 symptom in worker context).

**[NEEDS PLANNER DECISION — D-05 defers this explicitly. Planner must pick one of two paths and note rationale in 19-PLAN-XX.md.]**

### Pitfall 6: wrapCqrsBus + wrapEventBus double-capture interaction

**What goes wrong:** A CQRS handler emits a domain event; the event-bus wrapper emits a span; a listener on that event throws; `wrapCqrsBus` error capture path runs; `wrapEventBus` listener catch also tries to capture — if tracker.captureException is added to wrapEventBus, the same error gets reported twice (once by the listener wrapper, once by the wrapCqrsBus wrapper).

**Why it happens:** Unclear ownership of error capture across layered wrappers.

**How to avoid:** Per D-15 + the "Claude's Discretion" note at CONTEXT.md line 106, `wrapEventBus` does NOT call `tracker.captureException` on listener errors — it only records span status + exception (visible in Tempo). Listener errors stay swallowed + logged by existing `event-bus.ts` try/catch; command-handler errors remain the sole `tracker.captureException` path via `wrapCqrsBus`. Single tracker-capture site preserves Phase 18's error-telemetry discipline.

**Warning signs:** Same Sentry event deduplicates once, appears twice, or carries mismatched trace IDs. Grep-check after Phase 19: `tracker.captureException` should appear only at the 4 known sites (Phase 18 audit trail + Phase 19's addition inside wrapCqrsBus).

## Code Examples

### Bun.serve fetch wrapper with locale + trust decision

```typescript
// apps/api/src/index.ts (post-Phase 19)
// Source: D-01/D-12; locked by CONTEXT.md.
import { Elysia } from "elysia";
import { obsContext } from "@baseworks/observability";
import { env } from "@baseworks/config";
import { defaultLocale } from "@baseworks/i18n";
import { parseNextLocaleCookie } from "./lib/locale-cookie";
import { decideInboundTrace } from "./lib/inbound-trace";

// ... existing app construction unchanged ...

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
        inboundCarrier,  // preserved for attachment as span Link in .onRequest
      },
      () => app.handle(req),
    );
  },
});

logger.info({ port: env.PORT, role: env.INSTANCE_ROLE }, "Baseworks API started");
```

### Elysia observabilityMiddleware shape

```typescript
// apps/api/src/core/middleware/observability.ts (NEW — D-21)
import { Elysia } from "elysia";
import {
  getObsContext,
  getTracer,
  setSpan,
} from "@baseworks/observability";
import type { Span } from "@baseworks/observability";

export const observabilityMiddleware = new Elysia({ name: "observability" })
  .derive({ as: "scoped" }, () => {
    const tracer = getTracer();
    const store = getObsContext();
    // store is guaranteed non-null here — we're inside the Bun.serve als.run frame.
    const span: Span = tracer.startSpan(`${"unknown-method"} unknown`, {
      kind: "server",
      attributes: {
        "request.id": store?.requestId ?? "",
      },
      // Links for untrusted inbound traceparent populated here if inboundCarrier non-empty.
      // (Noop tracer ignores; Phase 21 OtelTracer attaches via OTEL Link API at startSpan time.)
    });
    // Publish span IDs into ALS (no enterWith — mutate existing store)
    setSpan({ traceId: store!.traceId, spanId: store!.spanId });
    return { _obsSpan: span };
  })
  .onRequest(({ request }) => {
    // Provisional name set in .derive above; no-op here unless we need early trust decisions.
    // (In practice, the .derive hook fires earlier than .onRequest in Elysia's pipeline;
    //  planner should TDD-verify and move logic if needed.)
  })
  .onBeforeHandle(({ request, route, _obsSpan }: any) => {
    // Rename span to {method} {route_template}
    // (Elysia's Span type doesn't expose rename; instead, set http.route attribute and
    //  let Phase 21 OtelTracer support `updateName()` when added. For Phase 19 Noop,
    //  the span "name" attribute is effectively opaque — the attributes carry the truth.)
    (_obsSpan as Span).setAttribute("http.route", route);
    (_obsSpan as Span).setAttribute("http.method", request.method);
  })
  .onError(({ error, _obsSpan }: any) => {
    (_obsSpan as Span).recordException(error);
    (_obsSpan as Span).setStatus({ code: "error" });
    // Do not end here — .onAfterResponse still runs after .onError in Elysia's lifecycle.
  })
  .onAfterResponse(({ request, set, _obsSpan }: any) => {
    const store = getObsContext();
    const status = (set as any).status ?? 200;
    (_obsSpan as Span).setAttribute("http.status_code", status);
    if (store?.tenantId) (_obsSpan as Span).setAttribute("tenant.id", store.tenantId);
    if (store?.userId) (_obsSpan as Span).setAttribute("user.id", store.userId);
    (_obsSpan as Span).end();

    // Single writer for outbound headers (D-23 — moved from requestTraceMiddleware)
    if (set && typeof set === "object" && "headers" in set) {
      (set.headers as Record<string, string>)["x-request-id"] = store!.requestId;
      (set.headers as Record<string, string>)["traceparent"] =
        `00-${store!.traceId}-${store!.spanId}-01`;
    }
  });
```

**NOTE:** Elysia's Span rename API is not yet confirmed for v1.4 — the planner should TDD-verify whether the span opens in `.derive` vs `.onRequest` vs `.onParse`. If the Noop tracer's `Span` interface doesn't support `updateName()`, the working approach is to set `http.route` as an attribute and accept the provisional-name constraint for Phase 19; Phase 21 OtelTracer can extend the Span interface with an `updateName` method (port widening) if it becomes important for RED metric naming.

### Trust decision helper

```typescript
// apps/api/src/lib/inbound-trace.ts (NEW — supports D-07/D-08)
import ipaddr from "ipaddr.js";
import { env } from "@baseworks/config";

const TRUSTED_CIDRS: Array<[ipaddr.IPv4 | ipaddr.IPv6, number]> =
  (env.OBS_TRUST_TRACEPARENT_FROM ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((cidr) => ipaddr.parseCIDR(cidr));

const TRUSTED_HEADER = env.OBS_TRUST_TRACEPARENT_HEADER ?? null;

export function decideInboundTrace(req: Request, remoteAddr: string): {
  traceId: string;
  spanId: string;
  inboundCarrier: Record<string, string>;
} {
  const inbound = req.headers.get("traceparent") ?? "";
  const inboundCarrier: Record<string, string> = inbound ? { traceparent: inbound } : {};

  let trusted = false;
  if (TRUSTED_CIDRS.length > 0 && remoteAddr) {
    try {
      const addr = ipaddr.parse(remoteAddr);
      trusted = TRUSTED_CIDRS.some(([range, bits]) => addr.kind() === range.kind() && addr.match(range, bits));
    } catch { /* malformed remote address — untrusted */ }
  }
  if (!trusted && TRUSTED_HEADER && req.headers.get(TRUSTED_HEADER)) {
    trusted = true;
  }

  if (trusted && inbound) {
    // Parse W3C traceparent: 00-<32hex>-<16hex>-<2hex>
    const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec(inbound);
    if (m) return { traceId: m[1], spanId: m[2], inboundCarrier: {} };
  }

  // Fresh trace server-side.
  const traceId = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  const spanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return { traceId, spanId, inboundCarrier };
}
```

### wrapEventBus shape (D-15/D-16)

```typescript
// packages/observability/src/wrappers/wrap-event-bus.ts (NEW)
import { obsContext } from "../context";
import type { Tracer } from "../ports/tracer";

export interface EventBusLike {
  emit(event: string, data: unknown): void;
  on(event: string, handler: (data: any) => void | Promise<void>): void;
}

export function wrapEventBus<B extends EventBusLike>(bus: B, tracer: Tracer): B {
  const origEmit = bus.emit.bind(bus);
  const origOn = bus.on.bind(bus);

  (bus as EventBusLike).emit = (event, data) => {
    const store = obsContext.getStore();
    tracer.withSpan(
      "event.publish",
      () => origEmit(event, data),
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
  (bus as EventBusLike).on = (event, handler) => {
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
            throw err;  // existing try/catch in event-bus.ts swallows + logs
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

**Note:** `wrapEventBus.on` intercepts the user handler and wraps it. The real `TypedEventBus.on` at `apps/api/src/core/event-bus.ts:52-66` already does try/catch-and-log. The wrapper's `throw err` after span.recordException flows up into that existing try/catch — no duplicate logging, no swallowed-without-telemetry errors.

### wrapCqrsBus extension (D-17)

```typescript
// packages/observability/src/wrappers/wrap-cqrs-bus.ts (MODIFIED — signature locked)
// Additions shown; full file structure unchanged.
import { obsContext } from "../context";
import { getTracer } from "../factory";

export function wrapCqrsBus<B extends BusLike>(bus: B, tracker: ErrorTracker): B {
  const tracer = getTracer();
  const origExecute = bus.execute.bind(bus);
  const origQuery = bus.query.bind(bus);

  (bus as BusLike).execute = async (command, input, ctx) => {
    const store = obsContext.getStore();
    return tracer.withSpan(
      "cqrs.command",
      async (span) => {
        try {
          return await origExecute(command, input, ctx);
        } catch (err) {
          span.recordException(err);
          span.setStatus({ code: "error" });
          tracker.captureException(err, {
            extra: {
              commandName: command,
              requestId: store?.requestId,
              traceId: store?.traceId,
            },
            tenantId: store?.tenantId ?? (ctx as any)?.tenantId,  // ALS is source of truth
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

  // `query` symmetrical — span name "cqrs.query", extra.queryName, same attr shape.
  // ... see file for full symmetric block ...

  return bus;
}
```

### Biome GritQL plugin for enterWith ban (D-24)

```gritql
// .biome/plugins/no-als-enter-with.grit
// Ban AsyncLocalStorage#enterWith per CTX-01 / Phase 19.
// Source: https://biomejs.dev/linter/plugins/ (Biome 2.3, January 2026)
// CITED: WebFetch biomejs.dev/linter/plugins/ 2026-04-23

`$obj.enterWith($args)` where {
  register_diagnostic(
    span = $obj,
    message = "AsyncLocalStorage.enterWith is banned (CTX-01). Use .run(store, fn) instead — see `packages/observability/src/context.ts` mutator helpers.",
    severity = "error"
  )
}
```

```json
// biome.json (MODIFIED — D-24)
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "plugins": ["./.biome/plugins/no-als-enter-with.grit"],
  "formatter": { "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": { "enabled": true },
  "organizeImports": { "enabled": true }
}
```

**NOTE:** Biome GritQL plugins as of v2.3 (January 2026) match receiver by AST shape, not by TypeScript type — the rule will flag **any** `.enterWith(` regardless of whether the receiver is truly an AsyncLocalStorage instance. For a monorepo that uses no other library named `enterWith`, this is acceptable. If a false-positive arises, the plugin can refine to `$obj.enterWith($args) where { $obj <: r"^[a-zA-Z]+Storage$" }` (regex receiver match) or similar. Phase 19 ships the simple version; if false positives surface during implementation, narrow at PR-time. [MEDIUM confidence — GritQL type awareness is still evolving; the simple pattern is the documented path.]

### grep-based backup gate (D-25)

```bash
#!/usr/bin/env bash
# scripts/lint-no-enterwith.sh (NEW — D-25)
set -euo pipefail

# CTX-01 belt-and-suspenders. Runs alongside Biome GritQL plugin.
# Allow-list is intentionally empty after Phase 19 D-10 removes the last use site.
ALLOWLIST=()  # add paths if ever a justified exception arises; document in CONTEXT.md

MATCHES=$(grep -rn "\.enterWith(" packages/ apps/ --include="*.ts" --include="*.tsx" 2>/dev/null || true)

if [ -z "$MATCHES" ]; then
  exit 0
fi

# Filter allow-list
if [ ${#ALLOWLIST[@]} -gt 0 ]; then
  for allowed in "${ALLOWLIST[@]}"; do
    MATCHES=$(echo "$MATCHES" | grep -v "$allowed" || true)
  done
fi

if [ -z "$MATCHES" ]; then
  exit 0
fi

echo "ERROR: AsyncLocalStorage.enterWith is banned (CTX-01). Matches:"
echo "$MATCHES"
exit 1
```

```json
// package.json (MODIFIED — wire into lint)
{
  "scripts": {
    "lint": "biome check . && bun run lint:als",
    "lint:als": "bash scripts/lint-no-enterwith.sh"
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `AsyncLocalStorage.enterWith(ctx)` at request entry | `AsyncLocalStorage.run(ctx, fn)` only | Ongoing consensus since Node 16; codified here by CTX-01 | Phase 19 bans enterWith with three layers (Biome GritQL + grep + test) |
| Auto-trust inbound W3C `traceparent` | Default fresh-trace; inbound attached as OTEL Link unless CIDR/header-allow-listed | PITFALLS.md §581; OTEL SDK defaults are trending toward opt-in trust as of 2024 | Phase 19 D-07/D-08 |
| `pino.child({ requestId })` at each handler | `pino({ mixin: () => obsContext.getStore() ?? {} })` — zero call-site changes | Pino 7+ exposes `mixin` as the canonical dynamic-context hook | Phase 19 D-19; CTX-03 literal compliance |
| ESLint custom AST visitor plugins | Biome 2.3+ `.grit` GritQL plugin files wired via `biome.json` plugins array | Biome 2.0 beta June 2025; 2.3 current Jan 2026 | Phase 19 D-24 |
| Span rename after creation via `Span.updateName()` | Provisional name at creation + `http.route` attribute (OTEL semantic convention) | OTEL HTTP semantic conventions crystallized 2024-2025 | D-13 |

**Deprecated/outdated:**
- `AsyncLocalStorage.enterWith` — technically still in the Node API but universally flagged as foot-gun on long-lived servers. Ban is correct.
- Pino 6.x `child` callbacks for dynamic context — `mixin` has been the canonical approach since Pino 7.
- `@opentelemetry/instrumentation-pino` auto-injection — not used here because the manual `mixin` approach is simpler, debuggable, and doesn't require the OTEL auto-instrumentation pipeline (which Phase 17 D-01 already sidesteps for Bun-compat reasons).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Elysia 1.4 `.onBeforeHandle` has `context.route` populated with the route template (e.g., `/api/tenants/:id`) | Pattern 1, HTTP Span Lifecycle, Pitfall 3 | If unavailable, span naming strategy needs adjustment — use a different hook or extract from `request.url` after middleware chain resolves. Task-1 TDD should empirically verify. [MEDIUM — WebSearch confirmed the hook exists but did not clarify field availability.] |
| A2 | Biome 2.3 GritQL plugin syntax `\`$obj.enterWith($args)\`` (backtick pattern) is stable and matches via AST shape | Code Examples §"Biome GritQL plugin" | Rule syntax drift breaks `bun run lint`. Grep backup (D-25) + in-test grep (D-26) still enforce the ban regardless. Low impact. [MEDIUM — https://biomejs.dev/linter/plugins/ verified syntax, but may evolve.] |
| A3 | `pino({ mixin })` option in pino 10.3.1 still calls the mixin per log invocation with `(mergeObject, level, logger)` signature | Pattern 2, Pitfall 4 | If the semantics changed, CTX-03's zero-call-site requirement breaks. [HIGH — verified against https://github.com/pinojs/pino/blob/main/docs/api.md.] |
| A4 | `ipaddr.js` 2.3.0 supports both IPv4 and IPv6 CIDR match via `parseCIDR(string)` + `match(range, bits)` | Don't Hand-Roll, Code Examples §"Trust decision helper" | If IPv6 handling is different in 2.3 vs 1.x, parser fails on IPv6 CIDR strings. [HIGH — verified via GitHub README + npm registry.] |
| A5 | `Bun.serve`'s `server.requestIP(req)?.address` returns the remote peer IP as a string in Bun 1.3.10 | Code Examples §"Bun.serve fetch wrapper" | If the API shape differs, trust-policy degrades silently to "always untrusted." Impact is safe (never-trust default), but the D-08 opt-in won't work. [MEDIUM — Bun 1.x docs vary; TDD should verify against a mocked Request.] |
| A6 | The Elysia Span type (from `@baseworks/observability`) does NOT yet need an `updateName()` method because Phase 19's Noop tracer treats the span name as opaque | Pitfall 3 commentary | If Phase 21 needs span-name-based RED metrics and updateName isn't added, Phase 21 has to widen the port. Not a Phase 19 risk. [HIGH — Phase 21 concern, not Phase 19.] |
| A7 | `Bun.serve` returning from `fetch()` keeps the `als.run` frame alive through the Promise chain returned by `app.handle(req)` | Pattern 1 | If Bun's microtask scheduler loses the frame mid-request, ALS bleeds. This is the core invariant the 100 RPS test (D-27) validates. [HIGH — standard Node/Bun AsyncLocalStorage behavior; documented.] |
| A8 | `context.route` in Elysia `.onBeforeHandle` is the route template (`/api/tenants/:id`), not the matched path (`/api/tenants/abc-123`) | D-13, Pitfall 3 | If it's the matched path, HTTP span names carry high cardinality (one name per tenant ID) — violates TRC-01 intent. [MEDIUM — WebSearch inconclusive; Task-1 TDD must verify.] |

**Planner action on assumptions:** Task 1 of Plan 1 should include targeted TDD that verifies A1 + A5 + A8 before committing to the observabilityMiddleware shape. If A1/A8 fail, fall back to extracting `http.route` via a Elysia's `Route` type at `.onAfterHandle` (still inside span lifetime) or via `request.route` if Elysia Context exposes it.

## Open Questions

1. **Which path wins for worker-side ALS wrap — `packages/queue/src/index.ts::createWorker` or `apps/api/src/worker.ts` job loop?**
   - What we know: D-05 defers. packages/queue currently has no `@baseworks/observability` dep.
   - What's unclear: Whether adding the dependency is acceptable vs wrapping at the application layer.
   - Recommendation: **Wrap at `createWorker`** — add dep, mutate processor argument to wrap in obsContext.run. Net: one line in createWorker, cross-cutting guarantee, zero duplication risk. If the planner prefers avoiding the new dep, wrap at `worker.ts` lines 49-68 (duplicates work if `apps/worker` ever splits from apps/api).

2. **Does Elysia 1.4's `context.route` return the template or the matched path?**
   - What we know: Assumption A8 states "template"; WebSearch did not confirm.
   - What's unclear: Empirical behavior at `.onBeforeHandle`.
   - Recommendation: Task 1 of the observability-middleware plan includes a TDD test that hits a param route (`/api/tenants/:id`) with `/api/tenants/abc` and asserts `context.route === "/api/tenants/:id"`. If it returns the matched path, refactor to use Elysia's router lookup (exposed at `app.router.find(method, path)` in some versions) or fall back to matching against registered route patterns.

3. **Does the Noop Span interface in Phase 17 support OTEL Link attachment at `startSpan({ links })`?**
   - What we know: `SpanOptions` in `packages/observability/src/ports/tracer.ts` has `attributes` + `kind` only — no `links` field.
   - What's unclear: Whether to widen `SpanOptions` in Phase 19 (port widening) or defer Link support to Phase 21.
   - Recommendation: **Widen in Phase 19** — add `links?: Array<{ traceId: string; spanId: string }>` to SpanOptions. Noop ignores; Phase 21 OtelTracer maps to OTEL Link API at `startSpan`. Cleanest discipline: the port surface added now matches the CONTEXT.md "span link for untrusted inbound" requirement without a later breaking widening. [Ref: OTEL spec — "Links added at span creation may be considered by Samplers" — see https://opentelemetry.io/docs/specs/otel/trace/api/]

4. **Does Biome GritQL in 2.3 support filtering by file path (e.g., exclude `.planning/worktrees/`)?**
   - What we know: The worktrees dir at `C:\Projetos\baseworks\.claude\worktrees\agent-*` contains old `enterWith` references from branches under development.
   - What's unclear: Whether Biome plugin path filters are via `biome.json` `files.includes`/`excludes` or in the plugin itself.
   - Recommendation: Use `biome.json` `files.includes` to scope the plugin to `packages/` + `apps/` only. Confirm at plan time. Grep backup already scopes to `packages/ apps/`.

5. **Will `apps/api/src/core/middleware/observability.ts` conflict with `apps/api/src/core/observability/` (a different subfolder if Phase 21 adds one)?**
   - What we know: CONTEXT.md lists the `middleware/observability.ts` path. ARCHITECTURE.md mentions `core/observability/` as a Phase 21-era directory for bull-board, db-instrumentation, etc.
   - What's unclear: Whether a flat file or a subfolder is preferred.
   - Recommendation: Go flat (`middleware/observability.ts`) per D-21 wording. If Phase 21 introduces `core/observability/`, move at that time; Phase 19 doesn't need to anticipate.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun runtime | Everything | ✓ | 1.3.10 | — |
| `ipaddr.js` | Trust-policy CIDR parsing (D-08) | Not installed yet | 2.3.0 (latest) | Fail plan 1 Task 1 until `bun add ipaddr.js` runs. |
| `@baseworks/observability` | Cross-cutting imports | ✓ (workspace) | 0.0.1 | — |
| `@baseworks/i18n` | locale type + `locales` + `defaultLocale` | ✓ (workspace, already imported by auth module) | — | — |
| `pino` | Mixin option | ✓ | 10.3.1 in registry; `^10.0.0` declared | — |
| `elysia` | Middleware + lifecycle hooks | ✓ (workspace) | ^1.4.0 | — |
| Biome CLI | Lint + GritQL plugin | ✓ (devDep in root package.json) | ^2.0.0; 2.3 latest | If the rule fails on old Biome (<2.0), `bun run lint:als` grep script still catches violations. |
| `npx` | Context7 CLI fallback | ✓ | 11.6.2 | Built-in MCP tools otherwise. |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** `ipaddr.js` ships with Phase 19; until then, trust policy is effectively "never" (empty-CIDR-list → skip CIDR check → default to untrusted). The Phase 19 plan includes `bun add ipaddr.js` as its first package.json modification.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Bun test runner (backend) — `bun:test` |
| Config file | None — Bun discovers `__tests__/**/*.test.ts` and `*.test.ts` by convention |
| Quick run command | `bun test apps/api/__tests__/observability-context-bleed.test.ts` |
| Full suite command | `bun run test` (root — runs all packages + apps + ui Vitest subsuite) |

### Phase Requirements → Test Map

Validation for Phase 19 spans **multiple concerns**, each requiring its own sampling rate. The Nyquist principle: sample each concern at a rate that catches its failure modes before merge.

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CTX-01 | obsContext is a single AsyncLocalStorage instance exported from packages/observability/src/context.ts | unit | `bun test packages/observability/src/__tests__/context.test.ts` | ❌ Wave 0 |
| CTX-01 | No `.enterWith(` usage in repo (three-layer ban) | integration | `bun run lint && bash scripts/lint-no-enterwith.sh && bun test apps/api/__tests__/enterwith-ban.test.ts` | ❌ Wave 0 |
| CTX-01 | `setTenantContext`, `setSpan`, `setLocale` mutate in-place (no new frame) | unit | `bun test packages/observability/src/__tests__/context.test.ts` | ❌ Wave 0 |
| CTX-02 | observabilityMiddleware opens HTTP span with provisional name in .onRequest | unit | `bun test apps/api/src/core/middleware/__tests__/observability.test.ts` | ❌ Wave 0 |
| CTX-02 | observabilityMiddleware renames span to `{method} {route}` in .onBeforeHandle (A1/A8 verification) | unit | `bun test apps/api/src/core/middleware/__tests__/observability.test.ts` | ❌ Wave 0 |
| CTX-02 | Trust decision: fresh trace when remoteAddr outside CIDR list | unit | `bun test apps/api/src/lib/__tests__/inbound-trace.test.ts` | ❌ Wave 0 |
| CTX-02 | Trust decision: adopt inbound traceparent when remoteAddr in CIDR | unit | `bun test apps/api/src/lib/__tests__/inbound-trace.test.ts` | ❌ Wave 0 |
| CTX-02 | Trust decision: adopt when `OBS_TRUST_TRACEPARENT_HEADER` present | unit | `bun test apps/api/src/lib/__tests__/inbound-trace.test.ts` | ❌ Wave 0 |
| CTX-02 | Invalid CIDR in `OBS_TRUST_TRACEPARENT_FROM` crashes `validateObservabilityEnv()` | unit | `bun test packages/config/src/__tests__/env.test.ts` | (existing file — extend) |
| CTX-02 | `setTenantContext` called from tenant middleware after session resolution | integration | `bun test apps/api/src/core/middleware/__tests__/tenant-als-publish.test.ts` | ❌ Wave 0 |
| CTX-02 | Outbound `traceparent` header on every response | unit | covered in observability.test.ts | ❌ Wave 0 |
| CTX-03 | Pino mixin is called per log invocation with correct ALS fields | unit | `bun test apps/api/src/lib/__tests__/logger-mixin.test.ts` | ❌ Wave 0 |
| CTX-03 | Child logger bindings compose with mixin output (no override surprises) | unit | `bun test apps/api/src/lib/__tests__/logger-mixin.test.ts` | ❌ Wave 0 |
| CTX-03 | Mixin returns `{}` outside request frame (no crash) | unit | `bun test apps/api/src/lib/__tests__/logger-mixin.test.ts` | ❌ Wave 0 |
| CTX-03 | No call-site edits in any existing handler — verified by grep | integration | `bun test apps/api/__tests__/no-logger-call-site-edits.test.ts` (grep-based, ensures no `obsContext.getStore()` references in modules/*/src/handlers/**) | ❌ Wave 0 |
| TRC-01 | HTTP span opens + closes once per request with method + route + status | integration | `bun test apps/api/__tests__/http-span-lifecycle.test.ts` | ❌ Wave 0 |
| TRC-01 | Inbound traceparent consumed → span has matching traceId when trusted | integration | covered in http-span-lifecycle.test.ts | ❌ Wave 0 |
| TRC-01 | Inbound traceparent → span Link when untrusted (verify via mock tracer capturing links) | integration | covered in http-span-lifecycle.test.ts (requires SpanOptions.links port widening) | ❌ Wave 0 |
| TRC-02 | wrapCqrsBus opens `cqrs.command` span with cqrs.name + tenant.id + request.id | unit | `bun test packages/observability/src/wrappers/__tests__/wrap-cqrs-bus.test.ts` (extend existing) | (existing — extend) |
| TRC-02 | wrapCqrsBus error path: span.recordException + setStatus BEFORE captureException | unit | extend existing wrap-cqrs-bus test | (existing — extend) |
| TRC-02 | wrapCqrsBus reads ALS; prefers ALS tenantId over ctx.tenantId | unit | extend existing wrap-cqrs-bus test | (existing — extend) |
| TRC-02 | wrapEventBus.emit opens `event.publish` span (producer kind) | unit | `bun test packages/observability/src/wrappers/__tests__/wrap-event-bus.test.ts` | ❌ Wave 0 |
| TRC-02 | wrapEventBus.on runs each listener in its own `event.handle` child span | unit | covered in wrap-event-bus.test.ts | ❌ Wave 0 |
| TRC-02 | Listener error: span.setStatus('error') + span.recordException, then swallow+log (existing try/catch still fires) | unit | covered in wrap-event-bus.test.ts | ❌ Wave 0 |
| TRC-02 | No edits to apps/api/src/core/cqrs.ts + event-bus.ts (invariant) | integration | `bun test apps/api/__tests__/core-files-untouched.test.ts` (reads the two files' content hashes against committed baselines) | ❌ Wave 0 |
| **Success #5** | **100 RPS concurrent-tenant bleed test — tenantId per log line matches request's session** | **integration (load)** | `bun test apps/api/__tests__/observability-context-bleed.test.ts` | ❌ Wave 0 |
| **Success #5** | **p99 regression ≤5% vs baseline (mixin-off vs mixin-on)** | **perf** | sub-suite inside observability-context-bleed.test.ts | ❌ Wave 0 |
| **Success #5** | **Biome GritQL + grep + in-test all flag a deliberately-introduced `.enterWith(` usage** | **integration** | `bun test apps/api/__tests__/enterwith-ban.test.ts` (injects a temporary fixture file, asserts all three gates fail, cleans up) | ❌ Wave 0 |

### Sampling Rate

**Sampling-rate rationale per Nyquist Dimension 8:**

- **ALS context bleed** (Pitfall 1, highest severity): sampled at N=100 concurrent requests per CI run (D-27). This exceeds the minimum for detecting Promise-reuse bleed (~N≥20 surfaces it reliably). Ratchet if flakes appear.
- **Span lifecycle** (open-rename-end ordering): sampled per-route-kind (GET/POST, param/fixed) — 4 tests minimum. Per-commit.
- **Pino mixin call-site invariance**: grep-based integration test — single pass per commit. Augmented by unit tests for mixin invocation semantics.
- **Traceparent inbound/outbound**: 5 trust-decision unit tests covering (CIDR match, CIDR miss, header match, header miss, malformed CIDR env → crash). Per-commit.
- **CQRS/EventBus wrappers**: extend existing wrap-cqrs-bus test suite; new wrap-event-bus test suite. Run every commit.
- **enterWith ban enforcement**: three-layer test runs `bun run lint` + grep + in-test — redundancy is the point. Per-commit.

**Coverage envelopes:**
- **Unit:** Per-file; bias toward `__tests__/` colocated next to the source file.
- **Integration:** App-level — `apps/api/__tests__/` for anything that composes middleware + handler + wrappers.
- **Load (Nyquist-critical):** `observability-context-bleed.test.ts` runs at N=100 per commit. Must complete in <30s.
- **Perf gate:** baseline-vs-mixin-on p99 comparison; hard-fail if regression > 5%.

**Per task commit:** `bun test <scoped test file>` — quick feedback (<5s per test file).
**Per wave merge:** `bun test apps/api packages/config packages/db packages/modules packages/queue packages/observability` — full suite <60s.
**Phase gate:** Full suite green + `bun run lint` green + verifier `/gsd-verify-work` passes.

### Wave 0 Gaps

- [ ] `packages/observability/src/__tests__/context.test.ts` — CTX-01 unit tests (single instance invariant, mutator helpers).
- [ ] `apps/api/src/core/middleware/__tests__/observability.test.ts` — CTX-02 + TRC-01 span lifecycle.
- [ ] `apps/api/src/lib/__tests__/inbound-trace.test.ts` — D-07/D-08 trust decision matrix.
- [ ] `apps/api/src/lib/__tests__/logger-mixin.test.ts` — CTX-03 pino mixin per-call semantics.
- [ ] `apps/api/src/core/middleware/__tests__/tenant-als-publish.test.ts` — D-04 setTenantContext call.
- [ ] `apps/api/__tests__/http-span-lifecycle.test.ts` — TRC-01 end-to-end.
- [ ] `apps/api/__tests__/no-logger-call-site-edits.test.ts` — CTX-03 grep-based invariant.
- [ ] `packages/observability/src/wrappers/__tests__/wrap-event-bus.test.ts` — TRC-02 EventBus wrapper.
- [ ] `apps/api/__tests__/core-files-untouched.test.ts` — TRC-02 zero-edit invariant.
- [ ] `apps/api/__tests__/observability-context-bleed.test.ts` — Success #5 load + perf gate.
- [ ] `apps/api/__tests__/enterwith-ban.test.ts` — Success #5 three-layer ban self-test.
- [ ] Framework install: none — Bun test runner already wired via root `bun run test` script.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 19 does NOT modify auth; tenant middleware unchanged |
| V3 Session Management | partial | D-04 publishes session-derived tenantId/userId into ALS; no session state added |
| V4 Access Control | no | Unchanged |
| V5 Input Validation | yes | CIDR syntax validation in `validateObservabilityEnv()` (D-08). Traceparent format validation in `decideInboundTrace`. Both crash-hard on malformed input at startup; runtime malformed traceparent silently falls through to fresh-trace (safe default). |
| V6 Cryptography | yes | `crypto.randomUUID()` used for fresh traceId/spanId generation. Standard Bun/Node crypto — never hand-rolled. |
| V9 Communications | yes | Outbound `traceparent` header set unconditionally (D-09); no PII carried (format: `00-<random>-<random>-01`). Inbound traceparent treated as untrusted by default (D-07) — addresses OWASP header-injection risk. |
| V13 API/Web Service | yes | Route-template extraction (not raw path) on HTTP span names (D-13) prevents user-ID / tenant-ID / session-token leakage into span metadata (which Phase 21 will ship to Tempo). |

### Known Threat Patterns for Elysia + Bun + ALS + OTEL

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant ALS context bleed under load | **I**nformation disclosure (wrong tenant sees another's data) | `AsyncLocalStorage.run()` only, three-layer enterWith ban, 100 RPS concurrent-tenant test (D-27) as merge gate |
| Client-forged traceparent → trace-ID pollution / cardinality DoS in backend | **T**ampering | Default never-trust; CIDR/header opt-in; inbound attached as OTEL Link (correlation without parent status) (D-07/D-08) |
| PII leak into span attributes / log mixin output | **I**nformation disclosure | `ObservabilityContext` holds IDs only (tenantId, userId, requestId, traceId, spanId, locale) — never email/name/session tokens. Phase 18 scrubPii already denies common PII keys; mixin output flows through same log pipeline and inherits that defense |
| ALS stores heavyweight objects (DB client, full session) causing GC pressure and retention | **D**enial of service | D-02 shape locked to 7 small scalar fields |
| `context.route` resolves to raw path instead of template → span attribute cardinality explosion | **D**enial of service (metric backend) | A1/A8 TDD gate; planner validates before committing observabilityMiddleware shape. Fallback: extract from registered-routes lookup. |
| Biome plugin bypass via `// biome-ignore` comments re-allowing enterWith | **E**levation of privilege (bypass of lint gate) | Three-layer ban — grep script (D-25) and in-test grep (D-26) don't honor Biome suppressions. Belt-and-suspenders. |
| Traceparent written to response body instead of header (operator exposes trace IDs in HTML) | **I**nformation disclosure | D-21 sets traceparent in `set.headers` only — never in response body. |
| Remote-addr spoofing via `X-Forwarded-For` tricking CIDR trust check | **S**poofing | Use `server.requestIP(req)?.address` (Bun's peer-address API) — returns the TCP peer, not any X-Forwarded-For header. [Operators behind a reverse proxy: CIDR must match the proxy's IP, not the original client. Document in DOC-04 runbook.] |

## Sources

### Primary (HIGH confidence)
- `@baseworks/observability` package — ports/tracer.ts + factory.ts + wrappers/wrap-cqrs-bus.ts (read directly 2026-04-23)
- `apps/api/src/{index,worker,lib/logger,core/middleware/*}.ts` (read directly 2026-04-23)
- `packages/modules/auth/src/{locale-context,index}.ts` (read directly 2026-04-23)
- `packages/queue/src/index.ts` — confirmed `createWorker(name, processor, redisUrl, opts)` signature (read directly 2026-04-23)
- `packages/config/src/env.ts` — existing `validateObservabilityEnv()` pattern to extend (read directly 2026-04-23)
- `.planning/phases/19-context-logging-http-cqrs-tracing/19-CONTEXT.md` — 28 locked decisions
- `.planning/phases/17-observability-ports-otel-bootstrap/17-CONTEXT.md` + `.planning/phases/18-error-tracking-adapters/18-CONTEXT.md` — upstream handoffs
- `.planning/research/PITFALLS.md` §80-107 (ALS bleed), §581 (trust boundary), §500-513 (Sentry body capture adjacent)
- `.planning/research/ARCHITECTURE.md` §370-486 — prior ALS flow (note: uses enterWith; Phase 19 diverges)
- Pino docs — https://github.com/pinojs/pino/blob/main/docs/api.md (mixin per-call semantics)
- Biome docs — https://biomejs.dev/linter/plugins/ (GritQL plugin syntax)
- OTEL Trace API — https://opentelemetry.io/docs/specs/otel/trace/api/ (Link at startSpan preferred)
- npm registry — ipaddr.js@2.3.0 (published 2025-11-28), pino@10.3.1 (published 2026-02-09)

### Secondary (MEDIUM confidence)
- WebSearch: Biome 2.0/2.3 plugin system + GritQL release notes (June 2025 → January 2026)
- WebSearch: ipaddr.js IPv4+IPv6 CIDR support details
- WebSearch: Elysia 1.x lifecycle hook ordering (onRequest → onParse → onTransform → onBeforeHandle → onHandle → onAfterHandle → onMapResponse → onError → onAfterResponse)
- WebSearch: Bun.serve + Elysia integration via BunAdapter
- https://bun.com/docs/guides/ecosystem/elysia — Bun + Elysia guide

### Tertiary (LOW confidence)
- WebSearch: `context.route` field availability at `.onBeforeHandle` — inconclusive; marked as A1/A8 assumption for Task-1 TDD verification
- WebSearch: Biome GritQL type-awareness for receiver-matching (AsyncLocalStorage-specific pattern) — rule ships simple; refine if false-positives surface

## Metadata

**Confidence breakdown:**
- Standard stack (existing ports + ipaddr.js choice): **HIGH** — all existing workspace packages read directly; ipaddr.js verified on npm registry.
- Architecture (middleware layering + span lifecycle): **MEDIUM-HIGH** — Elysia hooks well-understood in principle; A1/A8 require Task-1 TDD verification before committing observabilityMiddleware shape.
- Pitfalls (ALS bleed, trust boundary, cardinality): **HIGH** — sourced from PITFALLS.md which was validated during prior phase work.
- Biome GritQL syntax: **MEDIUM** — Biome 2.3 plugin API is young (2025 release); the simple pattern is documented but complex patterns (type-aware receiver match) may evolve. Grep backup mitigates.
- Worker-side ALS placement: **MEDIUM** — planner decision deferred per D-05; both paths viable.
- Pino mixin semantics: **HIGH** — verified against official pino docs.
- OTEL Link at startSpan: **HIGH** — verified against OTEL spec; requires Phase 19 SpanOptions port widening (Open Question 3).

**Research date:** 2026-04-23
**Valid until:** 2026-05-23 (30 days for stable; revisit if Biome 3.x releases or Elysia 2.0 ships)

---

*Phase: 19-context-logging-http-cqrs-tracing*
*Research completed: 2026-04-23*
