# Phase 19: Context, Logging & HTTP/CQRS Tracing - Context

**Gathered:** 2026-04-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship a single `AsyncLocalStorage<ObservabilityContext>` carrier, the Elysia `observabilityMiddleware` that populates it, a pino mixin that auto-injects trace/tenant/request fields on every log line, an HTTP-request span per Elysia route (method + route template + status), and external `wrapCqrsBus` / `wrapEventBus` extensions that emit CQRS command/query and event-publish spans — all without editing `apps/api/src/core/cqrs.ts`, `apps/api/src/core/event-bus.ts`, or any module handler. Delivers CTX-01, CTX-02, CTX-03, TRC-01, TRC-02. Acceptance: operator runs a 100 RPS concurrent-tenant test and sees every log line carry the correct `tenantId`, every HTTP span sees method + route template + status, and CI fails on any `.enterWith(` introduction.

BullMQ enqueue/process propagation ships in Phase 20 (CTX-04, TRC-03), riding on the ALS + worker-side `obsContext.run()` scaffolding Phase 19 installs centrally in `createWorker`. Real OTEL adapters + RED/USE metrics + Grafana stack ship in Phase 21. Drizzle/postgres.js DB-level spans are deferred (TRC-future-01).

</domain>

<decisions>
## Implementation Decisions

### ALS seed-and-enrich pattern

- **D-01:** Replace `app.listen(env.PORT, ...)` in `apps/api/src/index.ts` with `Bun.serve({ port: env.PORT, fetch: req => obsContext.run({ requestId, traceId, spanId, tenantId: null, userId: null, locale }, () => app.handle(req)) })`. Seed runs once per request at the outermost async boundary. Same pattern in `apps/api/src/worker.ts` through a central `createWorker` wrapper (D-05). Canonical Elysia+ALS shape; preserves `.run()`-only invariant and prevents cross-request bleed under concurrent load.
- **D-02:** `ObservabilityContext` shape: `requestId`, `traceId`, `spanId`, `locale` are **required** at seed time; `tenantId`, `userId` are **nullable** and mutated in after `tenantMiddleware.derive` resolves the session. Nullable tenant/user makes pre-auth log lines (e.g., `/health`, `/api/auth/login`) explicitly non-tenant rather than mistakenly tenant-less. Type:
  ```ts
  interface ObservabilityContext {
    requestId: string;
    traceId: string;
    spanId: string;
    locale: Locale;
    tenantId: string | null;
    userId: string | null;
  }
  ```
- **D-03:** Expose **typed mutator helpers** — `setTenantContext({ tenantId, userId })`, `setSpan({ traceId, spanId })`, `setLocale(locale)` — all exported from `@baseworks/observability`. Internally each does `const store = obsContext.getStore(); if (store) { store.tenantId = ...; }`. Call sites never touch `getStore()` for writes — only reads (via `getObsContext()`). This keeps mutation searchable (`grep -r "setTenantContext"`) and makes the lint rule straightforward: "no external code may call `obsContext.getStore()` then mutate fields; use the exported mutators."
- **D-04:** The `tenantMiddleware.derive` at `apps/api/src/core/middleware/tenant.ts` gains a single line after it resolves `{ tenantId, userId }`: `setTenantContext({ tenantId, userId })`. Derive returns the same shape as today (used by downstream `handlerCtx`); ALS is updated in-parallel so logs, spans, and error captures all see tenant/user from the same source of truth.
- **D-05:** Worker-side ALS seeding lives centrally in `packages/queue/src/create-worker.ts` (or the worker-construction path in `apps/api/src/worker.ts` — planner picks based on whether `createWorker` accepts a handler-wrapping hook). Each job runs inside `obsContext.run(jobCtx, () => handler(job))` where `jobCtx` is seeded from `job.data._requestId` (already propagated today) plus a newly-generated `traceId`/`spanId` for Phase 19. Phase 20 upgrades this one function to also extract `traceparent` from `job.data._otel`. Zero per-module job-handler edits.

### ALS module placement

- **D-06:** The single `obsContext` lives at `packages/observability/src/context.ts`. Diverges from research ARCHITECTURE.md §120's app-layer placement — rationale: `wrapCqrsBus` already lives in `packages/observability/src/wrappers/` (Phase 18 D-01), the pino mixin in `apps/api/src/lib/logger.ts` imports it, and Phase 21's OTEL adapter will share the same ALS via `AsyncLocalStorageContextManager`. No cross-package cycle (apps/api already depends on @baseworks/observability). File exports: `obsContext` (the instance), `getObsContext()`, `setTenantContext()`, `setSpan()`, `setLocale()`, and the `ObservabilityContext` type.

### Inbound traceparent trust policy

- **D-07:** Default behavior is **fresh trace server-side for all public inbound requests**. Inbound `traceparent` from untrusted origins is accepted as a **span link** (OTEL `Link` — same traceId correlation in Tempo UI without granting parent status), not as the parent. This satisfies CTX-02 ("reading inbound `traceparent`") while honoring the PITFALLS.md trust-boundary warning: untrusted clients cannot pollute our trace tree or craft traceIds that blow up cardinality.
- **D-08:** Trusted origins opt in via `OBS_TRUST_TRACEPARENT_FROM` (comma-separated CIDR list, e.g., `10.0.0.0/8,172.16.0.0/12`) or `OBS_TRUST_TRACEPARENT_HEADER=X-Internal-Source` (named header must be present on the request). Default empty — never trust. `validateObservabilityEnv()` parses + crash-hard-validates the CIDR syntax on startup. Fork operators running Baseworks behind a trusted API gateway opt in via one env setting.
- **D-09:** Outbound `traceparent` is set on **every response** regardless of inbound trust decision. Cheap (one header), lets operators cite a traceId in bug reports, gives trace-aware clients free correlation, and contains no PII — traceparent is just `00-<128bit-random>-<64bit-random>-<flags>`. The `observabilityMiddleware` sets it in `.onAfterResponse`.

### Existing localeMiddleware enterWith resolution

- **D-10:** **Unify locale into `obsContext`.** Delete `localeStorage` (the standalone `AsyncLocalStorage<LocaleStore>` in `packages/modules/auth/src/locale-context.ts`) and delete the `localeMiddleware` Elysia plugin. Add `locale: Locale` to `ObservabilityContext`. Single ALS instance = single lint rule covers everything, no grandfathered exceptions, no biome-ignore comments. Satisfies CTX-01 literally.
- **D-11:** Keep `getLocale()` as an exported function at `packages/modules/auth/src/locale-context.ts` for backwards compatibility with every current caller (`sendInvitationEmail`, any auth callback). Its body becomes `return obsContext.getStore()?.locale ?? defaultLocale;`. Zero call-site migration across the monorepo. The module-auth package gains `@baseworks/observability` as a dependency (or uses a narrow type import to avoid a runtime dep if one is already present).
- **D-12:** Cookie-to-locale parse moves into the **Bun.serve fetch wrapper** (the same function that seeds ALS in D-01). Parse `req.headers.get('cookie')` for `NEXT_LOCALE`, validate against the `locales` allow-list from `@baseworks/i18n`, include `locale` in the seed object. One place, one parse, runs once per request before the Elysia pipeline ever sees the request. Removes the need for `localeMiddleware` to be mounted separately in `apps/api/src/index.ts`.

### HTTP + CQRS + EventBus span naming

- **D-13:** **HTTP span name: `{method} {route_template}`** (e.g., `POST /api/billing/checkout`, `GET /api/tenants/:id`). Attributes: `http.method`, `http.route` (route template, never raw path), `http.status_code`, plus `tenant.id` and `user.id` read from ALS at span-end. Route template comes from Elysia's `context.route` which is available in `.onBeforeHandle` and later hooks — span is opened in `.onRequest` with a provisional name `{method} unknown` and renamed once route resolves. Matches OTEL HTTP semantic conventions. Low cardinality (finite route set × methods × status classes).
- **D-14:** **CQRS span name: `cqrs.command` or `cqrs.query`** (fixed). Attribute `cqrs.name=auth:create-tenant` carries per-command identity. Phase 21 builds RED metrics from the attribute dimension where OTEL Views cap cardinality. Matches OTEL messaging semantic conventions and keeps Tempo's span-name search index small enough to query fast.
- **D-15:** **EventBus: wrap both `emit()` and `on()` handlers.** `emit(event, data)` opens a `event.publish` span (kind=producer) with attribute `event.name`. `on(event, handler)` runs each listener inside its own `event.handle` child span (kind=consumer) with attributes `event.name` + `event.listener.index`. Child spans are OTEL-linked to the publish span (same traceId). The listener try/catch at `event-bus.ts:54-64` currently swallows + logs errors; wrapEventBus now also calls `span.setStatus({ code: 'error' })` + `span.recordException(err)` before the swallow, so silently-failing listeners become visible in Tempo. Per-listener spans attribute silent failures cleanly.
- **D-16:** `wrapEventBus` lives at `packages/observability/src/wrappers/wrap-event-bus.ts` and is applied in both `apps/api/src/index.ts` and `apps/api/src/worker.ts` with a single line immediately after the existing `wrapCqrsBus(...)` call: `wrapEventBus(registry.getEventBus(), getTracer())`. Mirrors Phase 18 D-01 wire-up pattern. Zero edits to `apps/api/src/core/event-bus.ts` or `ModuleRegistry`.

### wrapCqrsBus extension (Phase 19 enrichment, zero signature change)

- **D-17:** `wrapCqrsBus(bus, tracker)` signature stays identical to Phase 18. Phase 19 extends its body to:
  - Read `obsContext.getStore()` at the start of `execute`/`query` — pull requestId, traceId, spanId, tenantId, userId.
  - Open a `cqrs.command` / `cqrs.query` span with `cqrs.name`, `tenant.id`, `user.id`, `request.id` attributes via the injected tracer (the wrapper gains an internal reliance on `getTracer()` from the factory — same Noop default so test behavior unchanged).
  - On throw: `span.recordException(err)` + `span.setStatus({ code: 'error' })` BEFORE the existing `tracker.captureException(...)` call, then rethrow. Error capture scope enriched with ALS-derived fields (requestId, traceId) so Sentry events have trace links.
  - The ALS-derived fields are **the source of truth** and override any tenantId on the passed-in ctx — once Phase 19 seeds ALS at request entry, ctx.tenantId is downstream of ALS.
- **D-18:** Zero edits required to the 2 existing `wrapCqrsBus(registry.getCqrs(), getErrorTracker())` call sites in `apps/api/src/index.ts:46` and `worker.ts:41`. The wrapper internally imports `getTracer()` from its own package — no caller-visible change.

### Pino mixin wiring (CTX-03)

- **D-19:** One-line change in `apps/api/src/lib/logger.ts` — add `mixin: () => (obsContext.getStore() ?? {})` to the `pino({...})` options bag. Pino merges mixin output with each log call's bindings at serialization time — existing `logger.child({ jobId, queue })`, `logger.child({ requestId })`, and any future child bindings all continue working unchanged and appear in the final log object alongside `traceId`, `spanId`, `requestId`, `tenantId`, `userId`, `locale` from ALS. Zero call-site edits across the entire monorepo (literal CTX-03 compliance).
- **D-20:** The `mixin` function is defensive — `obsContext.getStore() ?? {}` — so calls from outside a request frame (e.g., startup logs, shutdown hooks, migration scripts) don't crash; they just log without trace/tenant fields. The mixin imports `obsContext` from `@baseworks/observability` — `apps/api` already depends on the package, no new cross-cutting import introduced.

### Elysia observabilityMiddleware shape + order

- **D-21:** New plugin `apps/api/src/core/middleware/observability.ts` (app-layer, matches where `request-trace.ts`, `tenant.ts`, `error.ts` live). Hooks:
  - `.onRequest` — decide trust for inbound `traceparent` (D-07, D-08), generate fresh `traceId`+`spanId` if not honored, open the HTTP span with provisional name `{method} unknown` + kind=server. Span is returned in Elysia context for later hooks to reference.
  - `.onBeforeHandle` — rename span to `{method} {context.route}` once route template is resolved. Set `http.route`, `http.method` attributes.
  - `.onAfterResponse` — set `http.status_code`, `tenant.id`, `user.id` (from ALS, post-enrichment) attributes, call `span.end()`, set `traceparent` + `x-request-id` on `set.headers`.
  - `.onError` — call `span.recordException(err)` + `span.setStatus({ code: 'error' })` before re-throwing (Phase 18's existing `app.onError(...)` at the Elysia root handles the tracker.captureException).
- **D-22:** Middleware order in `apps/api/src/index.ts`:
  1. `errorMiddleware` (already first)
  2. `observabilityMiddleware` (**new — inserted here, before requestTraceMiddleware**)
  3. `requestTraceMiddleware` (unchanged — still generates requestId, but now reads it from ALS via `getObsContext()` instead of `crypto.randomUUID()` inline)
  4. `localeMiddleware` — **DELETED** (subsumed by D-12)
  5. remaining (cors, swagger, auth, tenantMiddleware, billingApi, admin, …)
- **D-23:** `requestTraceMiddleware` evolves: `requestId` comes from ALS (seeded by Bun.serve fetch wrapper in D-01); onAfterResponse log line now has trace/tenant fields automatically via the pino mixin; no call-site changes. The `set.headers["x-request-id"]` line is deleted — `observabilityMiddleware.onAfterResponse` sets it (single writer). Tenant middleware and all downstream handlers continue to use the `requestId` derive value Elysia-context-wise.

### CI enforcement of the enterWith ban

- **D-24:** **Primary gate — Biome custom lint rule** `no-async-local-storage-enterWith` that fails on any `.enterWith(` call receiver-typed as AsyncLocalStorage. Lives in `biome.json` or a configured rule plugin. Runs as part of `bun run lint`.
- **D-25:** **Secondary gate — grep-based CI script** `scripts/lint-no-enterwith.sh` that fails if `.enterWith(` appears anywhere in the repo outside a short allow-list. Phase 19 ships with an **empty** allow-list (D-10 removes the one existing usage). The script runs inside `bun run lint:als`, wired into `bun run lint`. Belt-and-suspenders because Biome custom rules are still maturing — grep backs up Biome if the rule doesn't catch something.
- **D-26:** Phase 18 deferred the broader `ci.yml` (PR-time lint/typecheck/test). Phase 19 does NOT ship PR-time CI either — the enterWith gates run in `bun run lint` locally and will be wired into `ci.yml` when that phase arrives. An inline `bun test` inside Phase 19's test suite asserts `grep -r "\\.enterWith(" packages/ apps/ --include="*.ts"` returns empty — so the ban is enforced at test-time today, CI-time tomorrow.

### Concurrent-tenant load test (Success Criterion #5)

- **D-27:** `apps/api/__tests__/observability-context-bleed.test.ts` — a `bun test` that mounts the Elysia app (or a slimmed obs-middleware-only version), mocks `auth.api.getSession` with tenantId toggled per request, and fires 100 concurrent `app.handle(new Request(...))` calls (50 for tenantA + 50 for tenantB, interleaved) via `Promise.all`. Asserts that each response's server-log line (captured via a pino test transport) shows the expected tenantId matching the request's session. Fast, deterministic, runs on every `bun test` run, no sidecar services. The "load" dimension is concurrency pressure (N=100 parallel async tasks), not throughput — ALS bleed bugs surface reliably at N≥20 with Promise.all.
- **D-28:** Same test captures p50 + p99 request handling time in two sub-suites: (a) before-mixin baseline (run once with mixin shimmed to a noop), (b) after-mixin with the real `obsContext.getStore()` mixin. **Hard-fail if p99 regresses >5%** vs baseline. ALS `getStore()` is O(1) and should add sub-microsecond cost per log call — but the test cements a regression gate before Phase 21's real Grafana dashboards exist.

### Claude's Discretion

- Exact OTEL `Link` API usage pattern for attaching untrusted-inbound-traceparent as a span link (D-07) — planner to pick between `startSpan({ links: [...] })` at open time vs. post-hoc `span.addLink(...)` depending on what the Phase 17 tracer port shape supports.
- Exact CIDR parser for `OBS_TRUST_TRACEPARENT_FROM` — `ipaddr.js` vs. `netmask` vs. hand-rolled. Must handle IPv4 + IPv6 but Bun has neither natively.
- Whether the pino mixin closure is defined inline in `apps/api/src/lib/logger.ts` or exported as `createObsMixin()` from `@baseworks/observability`. Functionally identical; the export variant is nicer if another app ever wants it.
- Precise Biome custom rule syntax for `no-async-local-storage-enterWith` — depends on current Biome rule plugin API; planner confirms at research time.
- Whether `setTenantContext`, `setSpan`, `setLocale` are three separate functions or one `updateObsContext(partial)` helper. Three named functions read better in call sites.
- Whether `wrapEventBus` accepts only the tracer or also the error tracker (for listener-error capture parity with wrapCqrsBus). Current event-bus.ts already logs via pino; adding tracker capture is a nice-to-have that lands or defers based on planner judgement.
- Exact directory naming for the new Elysia plugin file (`observability.ts` vs. `obs.ts` vs. nested under `observability/` subfolder) — align with existing `middleware/` convention.

### Folded Todos

None — no todos were surfaced against Phase 19 at discussion time.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone & requirements
- `.planning/milestones/v1.3-ROADMAP.md` §"Phase 19: Context, Logging & HTTP/CQRS Tracing" — Goal, Depends on (Phase 17), requirements (CTX-01..03, TRC-01..02), and the 5 Success Criteria. Every Phase 19 plan must trace back to those.
- `.planning/REQUIREMENTS.md` — CTX-01 (single ALS + enterWith ban), CTX-02 (observabilityMiddleware + traceparent read + tenant/user from session), CTX-03 (pino mixin, no call-site changes), TRC-01 (HTTP span per request), TRC-02 (external wrapCqrsBus + wrapEventBus).
- `.planning/PROJECT.md` — Vision and hard constraints (Bun-only; Elysia + Eden Treaty; modular backend pattern).

### Research & pitfalls
- `.planning/research/ARCHITECTURE.md` §"Q7 — Integration with existing pino logger" and §"AsyncLocalStorage context flow" (~lines 377–486) — sketches the ALS + mixin design. **Note divergence:** the research uses `obsContext.enterWith(...)`; CTX-01 bans enterWith, so Phase 19 uses the `Bun.serve + als.run()` wrapper pattern (D-01) with mutator helpers (D-03) instead.
- `.planning/research/PITFALLS.md` §"Pitfall 3: ALS context bleed" (lines 80–99) — the enterWith ban rationale, 100 RPS load test requirement, Bun worker reuse concerns. Drives D-01, D-03, D-24, D-27.
- `.planning/research/PITFALLS.md` §"Trace context headers accepted from untrusted clients" (line 581) — drives the trust-policy design (D-07, D-08).
- `.planning/research/SUMMARY.md` lines 109–179 — overall Phase 19 scope within v1.3's build order; confirms ALS + pino mixin + wrapCqrsBus + wrapEventBus as Phase 19's delivery set and names the 100 RPS mixed-tenant load test as the gate.
- `.planning/research/FEATURES.md` lines 71–75, 148, 215 — confirms single-ALS + pino-mixin as table-stakes, better-auth session → ALS enrichment as the design, and OTEL trace context sharing the same ALS instance.

### Phase 17 handoff (locked precedents)
- `.planning/phases/17-observability-ports-otel-bootstrap/17-CONTEXT.md` — factory shape (D-01..D-03), port interface style (D-07..D-12), crash-hard env validation, Noop-first discipline. Phase 19 extends `validateObservabilityEnv()` for D-08's trust-config keys.
- `packages/observability/src/ports/tracer.ts` — tracer port Phase 19 consumes for HTTP + CQRS + EventBus spans. Phase 19 does NOT widen it; only uses existing `startSpan` / `withSpan` / `inject` / `extract` / `currentCarrier`.
- `packages/observability/src/ports/types.ts` — `Attributes`, `TraceCarrier` types used throughout Phase 19.
- `packages/observability/src/factory.ts` — `getTracer()` lazy singleton (Noop default); `getErrorTracker()` extended by Phase 18. Phase 19 wrappers depend on both factories.

### Phase 18 handoff (locked precedents)
- `.planning/phases/18-error-tracking-adapters/18-CONTEXT.md` — `wrapCqrsBus` external-wrap discipline (D-01), `app.onError` hook wiring (D-03), `worker.on('failed')` capture (D-04), PII scrubbing defense-in-depth (D-12..D-15). Phase 19 extends the existing `wrapCqrsBus` in place (D-17).
- `packages/observability/src/wrappers/wrap-cqrs-bus.ts` — Phase 18's current implementation. Phase 19 modifies internals (D-17) without changing the signature.
- `packages/observability/src/lib/install-global-error-handlers.ts` — registered at entrypoints. Phase 19 relies on these being called inside the als.run() frame from D-01 so flushes see ALS context.
- `packages/observability/src/lib/scrub-pii.ts` — denylist still authoritative for all captured fields. Phase 19 does NOT add PII fields (tenantId, requestId, traceId are on the allow-list per Phase 18 D-13).

### Existing code Phase 19 modifies (required reading)
- `apps/api/src/index.ts` — replace `app.listen(env.PORT, ...)` with the `Bun.serve + obsContext.run(...)` wrapper (D-01, D-12). Delete `localeMiddleware` mount (D-22). Add `wrapEventBus(...)` line after existing `wrapCqrsBus(...)` at line 46 (D-16).
- `apps/api/src/worker.ts` — same `obsContext.run(...)` wrap for each job via createWorker (D-05). Add `wrapEventBus(...)` line after existing `wrapCqrsBus(...)` at line 41 (D-16).
- `apps/api/src/lib/logger.ts` — add `mixin: () => obsContext.getStore() ?? {}` option (D-19, D-20). Zero other changes.
- `apps/api/src/core/middleware/tenant.ts` — add `setTenantContext({ tenantId, userId })` one-liner after the session resolution (D-04).
- `apps/api/src/core/middleware/request-trace.ts` — rewrite to read `requestId` from ALS instead of generating inline; delete `set.headers["x-request-id"]` writer (moved to observabilityMiddleware in D-23).
- `apps/api/src/core/middleware/observability.ts` — NEW FILE (D-21).
- `apps/api/src/core/cqrs.ts` — NO EDITS (invariant from Phase 18 D-01).
- `apps/api/src/core/event-bus.ts` — NO EDITS (Phase 19 extends this invariant to TypedEventBus via wrapEventBus).
- `packages/observability/src/context.ts` — NEW FILE (D-06).
- `packages/observability/src/wrappers/wrap-event-bus.ts` — NEW FILE (D-15, D-16).
- `packages/observability/src/wrappers/wrap-cqrs-bus.ts` — MODIFIED (D-17); signature unchanged.
- `packages/modules/auth/src/locale-context.ts` — rewrite: delete standalone AsyncLocalStorage + localeMiddleware export; `getLocale()` body becomes an obsContext read (D-10, D-11).
- `packages/modules/auth/src/index.ts` — remove `localeMiddleware` from exports if present.
- `packages/queue/src/create-worker.ts` (or equivalent; planner confirms path) — wrap each job execution in `obsContext.run(...)` (D-05).
- `packages/config/src/env.ts` — add `OBS_TRUST_TRACEPARENT_FROM`, `OBS_TRUST_TRACEPARENT_HEADER` keys with CIDR/header parsing in `validateObservabilityEnv()` (D-08).
- `biome.json` — add custom lint rule `no-async-local-storage-enterWith` configuration (D-24); planner confirms Biome rule-plugin syntax at research time.
- `scripts/lint-no-enterwith.sh` — NEW FILE, grep-based belt-and-suspenders gate (D-25).

### Existing patterns to mirror (byte-for-byte where applicable)
- `packages/modules/billing/src/provider-factory.ts` — lazy-singleton + get/set/reset trio (Phase 17/18 precedent continues).
- `packages/modules/auth/src/locale-context.ts` current shape — reference for how `getLocale()` is consumed; Phase 19 preserves that surface (D-11).

### External docs
- Node.js AsyncLocalStorage API — `.run(ctx, fn)` only; `.enterWith` deliberately avoided. Bun supports AsyncLocalStorage natively.
- Pino mixin docs — single function returning an object merged into every log line at serialization time.
- W3C Trace Context spec — `traceparent` header format `00-<traceid>-<spanid>-<flags>`; `tracestate` not consumed by Phase 19 (deferred, per minimal-carrier principle from PITFALLS.md §503).
- OTEL semantic conventions — HTTP (`http.method`, `http.route`, `http.status_code`), messaging (`messaging.system`, `messaging.destination.name`). Drives D-13, D-14, D-15.
- OTEL `Link` concept — non-parent span relationships; used for attaching untrusted-inbound-traceparent without making it a parent (D-07).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/observability/src/wrappers/wrap-cqrs-bus.ts` — Phase 18 wrapper; Phase 19 extends internals (D-17) without changing signature or call-site.
- `packages/observability/src/factory.ts` — `getTracer()` + `setTracer()` trio already present; wrapCqrsBus + wrapEventBus consume via the factory.
- `packages/observability/src/ports/tracer.ts` — Span interface (`end`, `setAttribute`, `setStatus`, `recordException`) covers everything Phase 19 needs. Span link support TBD by planner.
- `apps/api/src/lib/logger.ts` — pino instance ready for mixin; `createRequestLogger(requestId)` untouched.
- `apps/api/src/core/middleware/tenant.ts` — session resolution returns `{ tenantId, userId, user, session }`; Phase 19 adds one line to publish that into ALS.
- `apps/api/src/core/middleware/request-trace.ts` — already has `X-Request-Id` header logic + per-request logger; Phase 19 deletes the header writer and reads `requestId` from ALS.
- `packages/modules/auth/src/locale-context.ts` — `getLocale()` call surface preserved across the migration; internals swap from localeStorage to obsContext.
- `apps/api/src/worker.ts` lines 49–68 — central createWorker loop is the one surface for per-job ALS seeding.

### Established Patterns
- **External wrappers over core edits** — Phase 17 codified this for CQRS; Phase 18 extended to error capture; Phase 19 extends to ALS + tracing for HTTP, CQRS, and EventBus.
- **Noop-first with factory selection** — tracer stays Noop by default; Phase 19 uses only ports, no adapter wiring, no vendor SDKs. Real OTEL adapter ships in Phase 21 without changing Phase 19 call sites.
- **Crash-hard env validation per selected adapter/feature** — `validateObservabilityEnv()` extended for D-08 CIDR/header keys; same pattern as Phase 17/18.
- **Single source of truth for context** — ALS is the source; ctx.tenantId, logger child bindings, span attributes all derive from it. D-17 makes wrapCqrsBus prefer ALS over ctx passed by caller.
- **Test-time enforcement precedes CI-time enforcement** — Phase 19's enterWith ban gates run in `bun test` + `bun run lint` today; Phase 18 deferred `ci.yml` (PR-time CI) to a future phase and Phase 19 inherits that deferral.

### Integration Points
- `packages/observability/src/context.ts` NEW — exports the `obsContext` instance + helpers; consumed by apps/api (Bun.serve wrapper, middleware, logger), packages/observability (wrappers), and packages/queue (createWorker).
- `packages/observability/src/index.ts` — re-export the new context helpers + wrapEventBus for ergonomic single-import at call sites.
- `apps/api/src/index.ts:152` — `app.listen(...)` replaced by `Bun.serve({ port, fetch })` with obsContext.run wrap.
- `apps/api/src/index.ts:46` → add `wrapEventBus(registry.getEventBus(), getTracer())` one line after existing `wrapCqrsBus`.
- `apps/api/src/worker.ts:41` → same `wrapEventBus(...)` line.
- `apps/api/src/core/middleware/tenant.ts:69` area → `setTenantContext({ tenantId, userId })` one-liner.
- `packages/modules/auth/src/locale-context.ts` → full rewrite of body; API surface preserved.
- `packages/modules/auth/src/index.ts` → remove localeMiddleware from exports.
- `packages/queue/src/create-worker.ts` (or `apps/api/src/worker.ts` lines 49–68) → wrap job handler body in `obsContext.run(jobCtx, () => handler(job))`.
- `biome.json` + `scripts/lint-no-enterwith.sh` + `package.json` scripts → the CTX-01 CI gate trio.
- `apps/api/__tests__/observability-context-bleed.test.ts` NEW — concurrent-tenant test + perf gate.
- `packages/observability/src/adapters/__tests__/` — no new error-tracker adapters; Phase 18 conformance tests stay as-is but now run inside the als.run frame for integration coverage.

</code_context>

<specifics>
## Specific Ideas

- **Bun.serve + als.run is the canonical Elysia+ALS pattern.** User explicitly chose it over the middleware-reorder fallback. Planner should treat the Bun.serve wrapper as the single entry point for every request-scoped concern (requestId, trace, locale, upstream trust check) — not as a generic wrapper to be bypassed for special cases.
- **Mutator helpers over direct getStore() mutation.** The lint rule must distinguish "read via getObsContext / getStore" (allowed everywhere) from "mutate via setTenantContext / setSpan / setLocale" (allowed) vs "mutate via getStore().X = Y inline" (banned). Three named helpers beat one `updateObsContext(partial)` in call-site readability.
- **Unify locale into obsContext — no grandfathered enterWith.** Biome-ignore comments drift; a single ALS + single lint rule is the maintainable shape. The getLocale() import path stays stable so no caller feels the migration.
- **Trust policy is fresh-trace by default.** Public endpoints generate new traceIds; inbound traceparent becomes a span link, not a parent. Operators who run Baseworks behind a trusted gateway opt in via CIDR env. This lets the starter kit ship safely regardless of where it's deployed.
- **Span names are OTEL-semantic-convention-compliant.** `POST /api/tenants/:id` (HTTP), `cqrs.command` + attribute (CQRS), `event.publish` / `event.handle` (EventBus). Phase 21 builds RED metrics off attributes — cardinality stays bounded regardless of tenant count.
- **wrapCqrsBus signature is load-bearing.** Zero signature change means two entrypoints (`index.ts`, `worker.ts`) and any future test harness that calls it continue to work. Phase 19 is purely internal.
- **The 100 RPS test is in-process and fast.** `app.handle()` + Promise.all catches ALS bleed reliably at N=100 concurrency. No autocannon, no sidecar API, no flaky network. Runs on every `bun test`.
- **Biome rule + grep gate + in-test grep — defense in depth.** Three layers because ALS bleed is the Phase 3 Pitfall and one missed `.enterWith(` can cause tenant-A-sees-tenant-B under load.

</specifics>

<deferred>
## Deferred Ideas

- **Drizzle/postgres.js DB-level spans** — TRC-future-01 per REQUIREMENTS.md. Phase 19 reaches DB context via CQRS handler spans (the parent of any DB call inherits via ALS); full per-query spans wait for confirmation of postgres.js OTEL instrumentation or a Drizzle Proxy approach. Research task at Phase 21 planning time.
- **BullMQ traceparent injection + extraction** — Phase 20 (CTX-04, TRC-03). Phase 19 installs the worker-side `obsContext.run(...)` scaffolding centrally in createWorker so Phase 20 adds only the carrier-to-ALS line without touching every handler.
- **OTEL Views + collector cardinality guardrails** — Phase 21 (MET-02). Phase 19 picks span names + attributes with Phase 21's guardrails in mind but does not implement the cap.
- **Sampling strategy decision (parent-based 10% vs other)** — deferred to Phase 21 where a real exporter exists. Phase 19 under Noop tracer default samples nothing (no-op).
- **PR-time ci.yml** — deferred since Phase 18. Phase 19 enforces the CTX-01 ban via `bun run lint` + in-test grep so the gate exists today; CI-time enforcement lands with the future ci.yml phase.
- **OBS_SAMPLE_RATE env var for trace sampling** — Phase 21 territory.
- **Span link for inbound traceparent when trusted** — the trust policy opts in to parent semantics for CIDR-allow-listed requests (D-08). The link-only fallback is Phase 19; the parent case is code that lands now and exercises automatically once operators configure the allow-list. No separate phase needed.
- **`wrapEventBus` error-tracker integration for listener errors** — Phase 19 makes listener errors visible via span status but does NOT add `tracker.captureException(err)` in the listener wrapper. The listener-error path currently only logs via pino (event-bus.ts:58-63); adding capture risks noisy Sentry events for known-flaky subscribers. Revisit if a listener-error incident surfaces.
- **Frontend browser-side trace propagation** — `apps/admin` and `apps/web` injecting traceparent on fetch calls. Would require `@opentelemetry/sdk-trace-web` or a hand-wired propagator. Not in CTX-01..03 or TRC-01..02 scope; a future frontend-observability phase.
- **Tracestate header forwarding** — W3C spec allows a tracestate header alongside traceparent for vendor-specific context. Phase 19 drops tracestate on inbound + never emits it on outbound; minimal-carrier discipline per PITFALLS §503.
- **Baggage header propagation** — OTEL Baggage is a separate spec from traceparent, often used for tenant_id propagation across services. Phase 19 encodes tenant_id in span attributes + ALS, not Baggage. A future cross-service phase can adopt Baggage if multi-service deployment lands.

### Reviewed Todos (not folded)
None — no todo matches were surfaced for Phase 19.

</deferred>

---

*Phase: 19-context-logging-http-cqrs-tracing*
*Context gathered: 2026-04-23*
