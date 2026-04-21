# Research Summary -- v1.3 Observability and Operations

**Project:** Baseworks v1.3 Observability and Operations
**Domain:** Production observability layer for a Bun + Elysia + BullMQ + Drizzle + PostgreSQL SaaS starter
**Researched:** 2026-04-21
**Confidence:** HIGH (stack, architecture from direct repo inspection + 2026 community guides); MEDIUM (postgres.js OTEL driver compat -- needs smoke-test at implementation time)

---

## Executive Summary

v1.3 adds a complete, production-grade observability layer to an already-working monorepo. The guiding constraint is the existing port/adapter pattern used by the billing PaymentProvider: every observability concern gets an interface in packages/observability/, env-selected adapters (real backends + a noop), and a factory that mirrors provider-factory.ts byte-for-byte. Fork users configure ERROR_TRACKER=pino, TRACER=noop, METRICS_PROVIDER=noop and get a fully operational system. The three real-backend stacks are Sentry + GlitchTip (DSN swap, same @sentry/bun SDK), OTEL (Grafana Tempo + Loki + Prometheus via a single OTEL Collector Contrib), and the Pino-sink fallback.

The foundational design: all request-scoped state flows through a single AsyncLocalStorage<ObservabilityContext> instance. Pino reads from it via a mixin on every log call; OTEL uses AsyncLocalStorageContextManager sharing the same async task graph. BullMQ enqueue serializes a W3C traceparent carrier into job.data._otel; workers extract it and rehydrate the ALS context, making the trace tree span both processes. No handler code changes are required -- all instrumentation is applied as external wrappers around CqrsBus, TypedEventBus, the Drizzle client, and BullMQ Queue/Worker.

The primary Bun-specific risks: (1) OTEL SDK initialization ordering -- import "./telemetry" must be line 1 of every entrypoint because Bun does not honour NODE_OPTIONS=--require; (2) instrumentation-pg instruments the pg driver, not postgres.js -- the reliable path is a hand-rolled Drizzle Proxy wrapper; (3) @sentry/profiling-node does not load under Bun -- use @sentry/bun only.

---

## Stack Additions

New packages only -- the v1.0-v1.2 baseline is unchanged.

| Package | Version | Purpose | Bun Compat |
|---------|---------|---------|------------|
| @opentelemetry/api | ^1.9.0 | Tracing/metrics/context API | HIGH |
| @opentelemetry/sdk-node | ^0.215.0 | Aggregate SDK bootstrap (programmatic init) | HIGH -- use sdk.start(), not --require |
| @opentelemetry/sdk-trace-node | ^1.30.0 | Tracer provider | HIGH |
| @opentelemetry/sdk-metrics | ^1.30.0 | MeterProvider | HIGH |
| @opentelemetry/sdk-logs | ^0.215.0 | LoggerProvider for OTLP log export | HIGH |
| @opentelemetry/resources | ^1.30.0 | Resource attributes | HIGH |
| @opentelemetry/semantic-conventions | ^1.30.0 | Standard attribute keys | HIGH |
| @opentelemetry/exporter-trace-otlp-proto | ^0.215.0 | OTLP/HTTP+protobuf trace exporter | HIGH |
| @opentelemetry/exporter-metrics-otlp-proto | ^0.215.0 | OTLP/HTTP+protobuf metrics exporter | HIGH |
| @opentelemetry/exporter-logs-otlp-proto | ^0.215.0 | OTLP/HTTP+protobuf logs exporter | HIGH |
| @opentelemetry/auto-instrumentations-node | ^0.60.0 | Bundle of HTTP/ioredis/pino auto-instrumentations | MEDIUM -- disable fs/dns/net explicitly |
| @opentelemetry/instrumentation-pino | ^0.47.0 | Injects trace_id/span_id into pino records | HIGH |
| @appsignal/opentelemetry-instrumentation-bullmq | ^0.7.x | BullMQ span creation + traceparent propagation | MEDIUM -- smoke-test in Phase 1; fallback: hand-wired W3C propagator |
| @sentry/bun | ^10.32+ | Error tracking (Sentry SaaS + GlitchTip via DSN swap) | HIGH -- do NOT use @sentry/node or @sentry/profiling-node |
| @bull-board/api | ^7.0.0 | bull-board core API | HIGH |
| @bull-board/elysia | ^7.0.0 | Native Elysia adapter (published 2026-04) | HIGH |
| @bull-board/ui | ^7.0.0 | Pre-built UI bundle (auto-served by adapter) | HIGH |

**DO NOT add:** prom-client, @grpc/grpc-js + OTLP gRPC exporters, @sentry/profiling-node, promtail (EOL 2026-03), winston/bunyan, opentracing/jaeger-client.

**Docker images for docker-compose.observability.yml:**

| Image | Pinned Tag | Purpose |
|-------|-----------|---------|
| otel/opentelemetry-collector-contrib | 0.127.0 | Single OTLP ingress to Tempo / Prometheus / Loki |
| grafana/tempo | 2.10.4 | Trace storage |
| prom/prometheus | v3.10.0 | Metrics storage |
| grafana/loki | 3.7.1 | Log storage |
| grafana/grafana | 12.4.3 | Dashboards -- remap to port 3030 (avoids Next.js :3000 collision) |

---

## Feature Table Stakes vs Differentiators

### Table Stakes -- must ship for v1.3 to be credible

| Area | Feature |
|------|---------|
| Error Tracking | ErrorTracker port + captureException/captureMessage; uncaught exception + rejection handlers; Elysia onError capture (5xx only); CQRS + BullMQ job failure capture; context enrichment (tenant_id, user_id, correlation_id, trace_id); PII redaction; release tagging; env tagging |
| Metrics | MetricsProvider port (counter/histogram/gauge); RED per Elysia route using route templates not raw paths; USE for DB + Redis pools; BullMQ queue depth/active/failed/duration per job type; CQRS dispatch counter + duration histogram; process metrics |
| Distributed Tracing | Tracer port; Elysia HTTP auto-instrumentation; Drizzle query spans (Proxy wrapper -- not instrumentation-pg); BullMQ enqueue-to-worker span continuity via W3C traceparent; CQRS dispatch spans; AsyncLocalStorageContextManager; OTLP exporter; parent-based 10% sampler |
| Logging Upgrade | Single AsyncLocalStorage request context carrier; pino mixin reading from ALS on every log call; correlation ID generation + header propagation; trace_id + span_id auto-injected; log level per environment; PII redaction at pino level |
| Admin Job Monitor | bull-board at /admin/bull-board via @bull-board/elysia; all module queues auto-registered; RBAC gated by requireRole(owner); read-only by default; iframe embed in admin SPA |
| Health Dashboard | Split /health (liveness) / /health/detailed (operator view); queue depth with warn/critical thresholds; worker heartbeat (Redis TTL, 30s); per-module status from registry; golden signals card (reads MetricsProvider) |
| Runbooks + Alerts | docs/runbooks/ with TEMPLATE.md; 8-10 runbooks for this stack incident classes; grafana-alerts.yaml with SLO-based rules; alert-to-runbook linking via runbook_url annotation |
| Local Dev Stack | docker-compose.observability.yml (opt-in); OTEL Collector + Tempo + Loki + Prometheus + Grafana; 4 pre-provisioned dashboards; resource limits < 2 GB RAM total |

### Differentiators -- high ROI for a starter kit, include in v1.3

| Feature | Value |
|---------|-------|
| Three real ErrorTracker adapters (Sentry, GlitchTip, Pino-sink) | Mirrors Stripe/Pagar.me PaymentProvider story -- swap via env, no code changes |
| CQRS dispatch span + metric + log correlation as a single wrapper | One layer makes every command fully observable with zero handler changes |
| better-auth session context auto-injected to ALS | Unlocks tenant/user context everywhere downstream, zero per-handler code |
| Recent errors panel on admin health page | Closes debugging loop without leaving the admin UI |
| Grafana CQRS dashboard (commands/sec, p95 per command, error rate) | Baseworks-specific; highest value-per-hour for fork users |
| Runbook validation script | Extends scripts/validate-docs.ts; turns write good runbooks into a CI contract |

### Anti-Features -- do NOT build in v1.3

| Feature | Why Not |
|---------|---------|
| Custom in-app alert pipeline (Slack/PagerDuty from code) | Grafana/Sentry already do this; rebuilding it takes weeks and you will get deduplication wrong |
| Custom logs UI in admin dashboard | This is Grafana Loki purpose; yours will be strictly worse |
| Storing metrics/traces/logs in the app PostgreSQL | Time-series data crushes OLTP Postgres; use the docker-compose observability stack |
| Per-request profiling (Pyroscope/continuous profiling) | Separate port/adapter story; defer to v1.4+ |
| user_id / tenant_id as metric label dimensions | Cardinality explosion -- Prometheus OOM within weeks |
| Multi-backend error tracking (Sentry AND GlitchTip simultaneously) | Single adapter selected via env; the port makes swapping trivial |
| Tenant-aware sampling (boost specific tenants to 100%) | Needs a UI for flag management; premature for v1.3 |
| Tracing Drizzle query parameters (actual bound values) | PII leak; queries contain tenant data, passwords, tokens |
| Full event sourcing / audit log of every command | Different problem; PII storage nightmare; defer |
| 100% sampling in production | Storage cost + backend throttling; use parent-based 10% with error preservation |

---

## Architecture Summary

### Where Ports Live

Three locations with distinct roles:

1. **packages/observability/** (new root-level package) -- port interfaces (Tracer, MetricsProvider, ErrorTracker), all adapter implementations (otel/, sentry/, glitchtip/, pino/, noop/), factory functions. Zero dependencies on apps/ or packages/modules/. This is infrastructure -- every other module consumes it.

2. **apps/api/src/core/observability/** (new app-layer directory) -- wrappers around CqrsBus, TypedEventBus, Drizzle, BullMQ Queue/Worker; Elysia observabilityMiddleware; ALS context (context.ts); bull-board mount helper. These import from packages/observability but never the reverse.

3. **packages/modules/observability/** (new thin module) -- CQRS queries only (get-system-health, get-queue-stats, get-recent-errors). No commands. Keeps admin UI data access uniform with all other modules.

### Wrapping Strategy

All instrumentation is applied as **external wrappers** -- never by modifying core primitives. wrapCqrsBus(bus, tracer, metrics) decorates execute/query methods; a Drizzle Proxy intercepts terminal query calls; wrapQueue overrides queue.add() to inject the OTEL carrier. CqrsBus, TypedEventBus, Drizzle, and BullMQ Queue remain unmodified and independently testable.

### Trace Propagation Flow



Pino reads { traceId, spanId, requestId, tenantId } from ALS via a mixin on every log call -- zero call-site changes to existing loggers.

### Adapter Matrix

| Port | Adapters | Default (no config) |
|------|---------|---------------------|
| ErrorTracker | sentry, glitchtip (same @sentry/bun SDK, DSN swap only), pino-sink | pino-sink |
| Tracer | otel (OTLP HTTP/proto to Tempo), noop | noop |
| MetricsProvider | otel (OTLP HTTP/proto to Prometheus), noop | noop |

---

## Top Pitfalls to Design Around

**1. OTEL SDK init ordering under Bun (Critical)**
Bun does not honour NODE_OPTIONS=--require. Any instrumented module imported before sdk.start() will never emit spans. import "./telemetry" must be line 1 of every entrypoint -- no exceptions. Add a startup self-test span as an acceptance criteria gate for Phase 1.

**2. BullMQ trace context not injected -- orphan worker spans (Critical)**
BullMQ is not in auto-instrumentations-node. Without explicit W3C traceparent injection at queue.add() and extraction at the worker processor, every job span starts a new disconnected trace. Acceptance criteria: automated test asserts traceId from API request equals traceId in worker job span.

**3. AsyncLocalStorage context bleed (Critical)**
als.enterWith() leaks context across concurrent requests -- tenant A sees tenant B IDs. Only als.run(ctx, fn) is permitted; ban enterWith via Biome lint rule or CI grep check. Verify with a concurrent load test (100 RPS, mixed tenants).

**4. High-cardinality metric labels (Critical)**
user_id, unbounded tenant_id, raw URL paths, or any UUID as a metric label will OOM Prometheus. Configure an OTEL View with AttributeSelector dropping these at SDK level; add collector transform to strip UUID regex before Prometheus export. Design-time rule, not a code-review catch.

**5. Sentry/GlitchTip PII leaks (Critical)**
Default SDK scrubbers miss Stripe webhook bodies, better-auth session tokens, and error messages built with user input. Set sendDefaultPii: false always; add beforeSend/beforeBreadcrumb hooks with a shared redaction list; strip request.data for /api/webhooks/** routes. Conformance test for both adapters is a Phase 1 gate.

**6. Sampling configured to lose error traces (Moderate)**
100% head sampling costs storage; 1% head sampling drops the error trace you needed. Default policy: parent-based 10% + tail sampling in the OTEL Collector with always_sample for errors and requests over 1s. This policy ships in otel-collector-config.yaml -- it is not a tune-later note.

**7. postgres.js OTEL driver mismatch (Moderate -- verify in Phase 1)**
instrumentation-pg instruments the pg driver; the codebase uses postgres.js. The instrumentation silently emits no DB spans. The reliable path is a hand-rolled Drizzle Proxy wrapper (db-instrumentation.ts) -- 30 lines, deterministic, Bun-safe.

**8. bull-board without RBAC (Moderate)**
bull-board exposes job payloads (PII: emails, billing data) and destructive actions. Mount only under requireRole(owner); read-only by default; destructive actions require platform_superadmin. requireRole must gate static asset requests too.

---

## Build Order -- Phase Candidates

### Phase 1: Ports + Noop Adapters + Factory + OTEL Bootstrap + ErrorTracker Adapters

**Rationale:** Port contracts must exist before any wrappers or adapters can be written. Noop adapters ship here so every downstream phase has a working default. OTEL SDK bootstrap must be verified Bun-compatible before any instrumentation work proceeds. ErrorTracker adapters depend only on the port -- no ALS or tracing required.

**Delivers:** packages/observability/ with all three ports and all adapters. apps/api/src/telemetry.ts bootstrap (line-1 import guard + startup self-test span). validateObservabilityEnv(). PII conformance tests for Sentry and GlitchTip adapters.

**Pitfalls addressed:** Init ordering, PII leaks, cardinality View defined before first metric, postgres.js smoke test.

**Research flag:** Smoke-test @appsignal/opentelemetry-instrumentation-bullmq under Bun 1.1+. Verify postgres.js OTEL instrumentation status.

### Phase 2: ALS Context + Pino Mixin + CqrsBus/EventBus Wrapping + DB Instrumentation

**Rationale:** ALS is the foundation -- BullMQ carrier extraction, pino mixin, and metric labels all depend on it. CqrsBus wrapping is the highest-value instrumentation point. DB spans complete the trace tree for synchronous work.

**Delivers:** context.ts (single ALS instance). observabilityMiddleware (Elysia). pino-mixin.ts. wrapCqrsBus + wrapEventBus. db-instrumentation.ts (Drizzle Proxy). Concurrent load test (100 RPS, mixed tenants) passing with correct tenantId in all log lines.

**Pitfalls addressed:** ALS side of BullMQ propagation, enterWith ban + concurrent load test, Drizzle Proxy, p99 benchmark gate.

### Phase 3: BullMQ Propagation + Worker Context + bull-board Mount

**Rationale:** BullMQ is the last missing link in the trace tree. bull-board is bundled here because it touches the same queue infrastructure -- avoids a second pass through queue-related code.

**Delivers:** queue-instrumentation.ts (wrapQueue, injectCarrier, extractCarrier). Worker modified to extract carrier + ALS.run per job. bull-board.ts Elysia plugin behind requireRole(owner). Iframe embed in admin SPA. Automated trace continuity test (API traceId == worker traceId).

**Pitfalls addressed:** BullMQ orphan spans fully resolved, bull-board RBAC (unauthenticated 401, non-admin 403, static assets also gated).

### Phase 4: OTEL Adapters + docker-compose.observability.yml + Grafana Provisioning

**Rationale:** OTEL adapters depend only on Phase 1 ports. The local dev stack can only be validated once metrics and traces are emitting from real code paths (Phases 2-3 complete).

**Delivers:** otel-tracer.ts, otel-metrics.ts, otel-sdk.ts. docker-compose.observability.yml with resource limits (Grafana on :3030, total < 2 GB RAM, 24h retention for dev). otel-collector-config.yaml with tail-sampling policy (always_sample errors + slow requests, 10% otherwise). 4 pre-provisioned Grafana dashboards (API Overview/RED, Queue Health, DB+Redis/USE, CQRS View).

**Pitfalls addressed:** Sampling policy in collector config, compose RAM limits and port remapping.

**Research flag:** Verify Grafana 12.4 provisioning JSON schema before building dashboards.

### Phase 5: Health Dashboard Upgrade

**Rationale:** Needs Phases 2-4 to have data (module health contributions, BullMQ queue depths, MetricsProvider golden signals). Extends an existing admin page.

**Delivers:** HealthContribution interface added to ModuleDefinition. packages/modules/observability/ CQRS queries. GET /api/admin/observability/health. Worker heartbeat (Redis TTL, 10s write/30s TTL). Admin SPA health page with queue depth cards, worker heartbeat status, per-module status, golden signals card, recent errors panel.

**Pitfalls addressed:** Tiered checks: /health/live, /health/ready, /health/deep with canary DB query.

### Phase 6: Runbooks + Alert Templates + Docs

**Rationale:** Must be last -- runbooks reference concrete alert names, dashboard names, and metric names that only exist after Phases 1-5.

**Delivers:** docs/runbooks/TEMPLATE.md + 8-10 runbooks (DB connection exhaustion, Redis down, BullMQ queue backed up, worker stuck, Stripe webhook failures, high 5xx rate, email delivery backlog, better-auth session failure). docs/observability/grafana-alerts.yaml (SLO-based, deploy-aware, for: 5m minimum, runbook_url on every rule). docs/runbooks/observability-attributes.md. Runbook validation script. ALERT-PHILOSOPHY.md.

**Pitfalls addressed:** Attribute placement doc, alert fatigue (SLO-based rules), runbook decay (validation CI + review cadence as a deliverable).

### Research Flags

**Needs /gsd:plan-phase deeper research:**
- **Phase 1** -- postgres.js OTEL instrumentation: verify whether a postgres.js-specific instrumentation has shipped; confirm Drizzle Proxy covers transactions + batch queries. Smoke-test @appsignal/opentelemetry-instrumentation-bullmq on Bun 1.1+.
- **Phase 4** -- Grafana 12.4 provisioning JSON schema: verify format before building the 4 dashboards.

**Standard patterns (skip research-phase):**
- **Phase 2** -- ALS + pino mixin is well-documented; Bun node:async_hooks is confirmed native.
- **Phase 3** -- @bull-board/elysia v7.0.0 has an official native adapter; mount pattern is straightforward.
- **Phase 5** -- HealthContributor pattern mirrors existing module patterns in the codebase.
- **Phase 6** -- Documentation and alert YAML; no runtime code.

---

## Watch Out For

- **import "./telemetry" must be line 1** -- Bun ignores --require; any instrumented import before sdk.start() will never emit spans.
- **Never als.enterWith() in a server** -- use als.run(ctx, fn) exclusively; enterWith causes cross-tenant context bleed under load.
- **user_id is never a metric label** -- it turns every counter into a time series per user; Prometheus OOMs within weeks.
- **@sentry/profiling-node does not load under Bun** -- tracked in oven-sh/bun#19230; skip it entirely.
- **OTLP gRPC exporter has native-addon edge cases on Bun** -- use HTTP/protobuf (exporter-*-otlp-proto) exclusively.
- **instrumentation-pg instruments pg, not postgres.js** -- DB spans require the Drizzle Proxy wrapper, not auto-instrumentation.
- **bull-board shows all tenants job data** -- gate with platform_admin role, not tenant admin; scrub payloads before display.
- **Grafana default port is 3000** -- collides with Next.js dev server; remap to 3030 in the compose file.
- **Promtail is EOL (2026-03-02)** -- use OTEL Collector Contrib for log shipping to Loki.
- **Do not bun build --compile the API** -- breaks OTEL and Sentry auto-instrumentation; run bun run src/index.ts in Docker.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack (new packages) | HIGH | All packages verified on npm 2026-04-21; Bun compat confirmed via 2026 community guides and official docs |
| Features | HIGH | Feature set derived from industry-standard RED/USE patterns + direct codebase inspection |
| Architecture | HIGH | Port/adapter pattern read directly from existing billing module; OTEL init ordering confirmed by Bun community |
| Pitfalls | MEDIUM-HIGH | Critical pitfalls from official docs + Bun issue tracker; recovery strategies are forward-looking |
| postgres.js OTEL compat | MEDIUM | instrumentation-pg targets pg driver; postgres.js status uncertain; Proxy wrapper is reliable fallback |
| Grafana image tags | MEDIUM | Versions verified 2026-04-21; pin at implementation time |

**Overall confidence:** HIGH for architectural decisions and package selections. MEDIUM for two implementation-time verification points.

### Gaps to Address

- **postgres.js OTEL driver** (Phase 1): verify whether a postgres.js-specific instrumentation now exists; if not, confirm Drizzle Proxy covers transactions and batch queries.
- **BullMQ instrumentation Bun compat** (Phase 1): smoke-test @appsignal/opentelemetry-instrumentation-bullmq under Bun 1.1+; fallback to hand-wired W3C propagator if it fails.
- **Grafana 12.4 provisioning JSON schema** (Phase 4): verify format before building dashboard JSON files.
- **Trace + log retention alignment** (Phase 4 + 6): decide default Tempo retention (7 or 14 days) and document alignment with removeOnFail BullMQ job retention and the project privacy policy.

---

## Sources

### Primary (HIGH confidence)
- Direct repo reads: apps/api/src/{index.ts,worker.ts,core/**,lib/logger.ts,routes/admin.ts}, packages/modules/billing/src/{ports/,provider-factory.ts}, packages/queue/src/index.ts, packages/db/src/**, packages/shared/src/types/**
- Sentry Bun docs (official) -- @sentry/bun confirmed; @sentry/profiling-node broken (oven-sh/bun#19230)
- @bull-board/elysia npm v7.0.0 (2026-04) -- native Elysia adapter
- @opentelemetry/sdk-node npm v0.215.0 (2026-04)
- GlitchTip 6 docs -- Sentry wire protocol DSN-swap compat
- Bun node:async_hooks reference (official) -- ALS native support
- Promtail EOL + Grafana Alloy migration docs (official)

### Secondary (MEDIUM confidence)
- OneUptime: OTEL Bun without --require (2026-02) -- programmatic init pattern
- OneUptime: Instrument Bun + ElysiaJS with OTEL (2026-02) -- Bun compat validation
- AppSignal BullMQ OTEL instrumentation -- maintained fork confirmed; Bun compat is MEDIUM
- oven-sh/bun#13638 -- NAPI addon inside ALS scope (known issue, none of our deps trigger it)
- Grafana Tempo 2.10, Loki 3.7.1, Prometheus 3.10.0, Grafana 12.4.3 release notes

### Tertiary (LOW -- verify at implementation)
- postgres.js + instrumentation-pg compat -- no definitive 2026 source; Proxy wrapper is safe fallback regardless

---
*Research completed: 2026-04-21*
*Ready for roadmap: yes*
