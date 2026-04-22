# Requirements: Baseworks v1.3 Observability & Operations

**Defined:** 2026-04-21
**Core Value:** Clone, configure, and start building a multitenant SaaS in minutes — not weeks.
**Milestone Goal:** Ship production-grade observability and ops tooling so operators running Baseworks can detect, diagnose, and resolve incidents without SSHing into boxes or grep-ing logs.
**Architecture:** Port + adapters (matching `PaymentProvider` pattern). Adapters env-selected at startup.

## v1.3 Requirements

### OBS — Observability Ports & Bootstrap

- [x] **OBS-01**: Operator can use a typed `ErrorTracker` port with a Noop adapter that mirrors the GlitchTip API surface (capture exception/message/breadcrumb/context) and is factory-selected at startup by `@t3-oss/env-core` config
- [x] **OBS-02**: Operator can use a typed `MetricsProvider` port (counter/histogram/gauge) with a Noop adapter, factory-selected at startup
- [x] **OBS-03**: Operator can use a typed `Tracer` port (startSpan/withSpan/inject/extract) with a Noop adapter, factory-selected at startup
- [x] **OBS-04**: Operator sees the OTEL SDK bootstrapped as the first-imports in `apps/api` and `apps/worker` entrypoints (programmatic `NodeSDK`, no `--require`), with a Bun smoke-test gate in CI verifying each auto-instrumentation loads without crashing

### ERR — Error Tracking

- [ ] **ERR-01**: Operator can enable Sentry error capture via `SENTRY_DSN` env var; the Sentry adapter uses `@sentry/bun`, captures uncaught exceptions + CQRS handler errors + BullMQ job failures, and uploads source maps on release tag
- [ ] **ERR-02**: Operator can point the same adapter at GlitchTip via DSN swap; adapter-conformance test proves parity with Sentry
- [ ] **ERR-03**: Operator sees the Pino-sink Error fallback adapter active when no DSN is configured, writing errors to pino at ERROR level without any external dependency
- [ ] **ERR-04**: Operator sees errors reported with context (tenant_id, user_id, request_id, command/query name) and with webhook/auth/payment payloads scrubbed — verified by an adapter-conformance test that feeds known-PII fixtures and asserts they are redacted

### CTX — Context & Logging Upgrade

- [ ] **CTX-01**: Operator sees a single `AsyncLocalStorage<ObservabilityContext>` carrying `{requestId, traceId, spanId, tenantId, userId}`, with a Biome/ESLint rule banning `enterWith` (only `.run()` permitted)
- [ ] **CTX-02**: Operator sees an Elysia `observabilityMiddleware` that populates the ALS on every request, reading inbound `traceparent` or starting a new trace, and derives tenant/user from the existing tenant middleware
- [ ] **CTX-03**: Operator sees every pino log line include `trace_id`, `span_id`, `requestId`, and `tenantId` via a logger mixin — no call-site changes required across any existing handler
- [ ] **CTX-04**: Operator sees BullMQ enqueue wrap inject W3C `traceparent` + `requestId` into job data, and workers reconstitute ALS context via `obsContext.run(...)` on job pickup — verified by an end-to-end test that asserts a single trace spans API request → enqueued job → worker processing

### TRC — Distributed Tracing

- [ ] **TRC-01**: Operator sees a span per HTTP request with method + route template + status code, accepting inbound W3C `traceparent` and emitting it on outbound responses
- [ ] **TRC-02**: Operator sees the `CqrsBus` and `EventBus` externally wrapped so every command/query dispatch and every event publish emits a span with correlation attributes — without any edit to existing handler or core files
- [ ] **TRC-03**: Operator sees BullMQ enqueue + process instrumented with W3C context propagation (via `@appsignal/opentelemetry-instrumentation-bullmq` or hand-rolled equivalent), with a Bun smoke test as merge gate; enqueue spans linked to process spans in Tempo

### MET — Metrics

- [ ] **MET-01**: Operator can enable OTLP/HTTP-proto export to an OTEL Collector via env var; Noop adapter is the default with zero overhead
- [ ] **MET-02**: Operator sees RED metrics (rate, errors, duration p50/p95/p99) per Elysia route template and per CQRS command/query name — with a unit test asserting no `tenant_id`/`user_id`/URL-path labels escape onto metrics
- [ ] **MET-03**: Operator sees USE metrics for DB connection pool, Redis, and BullMQ queues (depth, active, failed/sec) — aggregate only, never per-tenant; cardinality guardrails enforced by OTEL Views + collector filters

### OPS — Admin Ops Tooling

- [ ] **OPS-01**: Operator sees `@bull-board/elysia` mounted at `/admin/bull-board` behind `requireRole("owner")`, with read-only mode enabled by default via feature-flag env and admin-origin CSP
- [ ] **OPS-02**: Admin user sees a bull-board entry in the Vite admin dashboard sidebar, rendered as a same-origin iframe sharing the better-auth session cookie
- [ ] **OPS-03**: Admin user sees a `/health/detailed` endpoint + admin dashboard page showing queue depth, worker heartbeat, DB lag, recent errors, and per-module status
- [ ] **OPS-04**: Module author can register a `HealthContributor` at module registration time; central aggregator rolls up all contributions into overall status surfaced by OPS-03

### DOC — Documentation & Dev Stack

- [ ] **DOC-01**: Developer can run `bun run observability:up` to launch `docker-compose.observability.yml` (OTEL Collector + Tempo 2.10 + Loki 3.7 + Prometheus 3.10 + Grafana 12.4) with per-service `mem_limit` and laptop-tuned retention
- [ ] **DOC-02**: Developer sees 4 pre-provisioned Grafana dashboards on stack up — API Overview (RED), Queue Health (BullMQ), DB+Redis (USE), CQRS View (per-command RED) — committed to repo
- [ ] **DOC-03**: Operator sees 8–10 incident runbooks under `docs/runbooks/` (DB down, Redis down, queue backing up, webhook failures, auth outage, OTEL exporter failing, bull-board inaccessible, high error rate, slow checkout) using a Trigger → Symptoms → Triage → Resolution → Escalation template
- [ ] **DOC-04**: Operator gets pre-built Grafana alert rule YAML + Sentry alert config templates (importable into their tooling) with `runbook_url` annotations pointing to DOC-03, plus an observability concepts doc at `docs/observability/` covering attributes glossary, cardinality guide, and trace-propagation flow

### EXT — Extensions

- [ ] **EXT-01**: Developer sees a CI step (GitHub Actions) uploading source maps to Sentry/GlitchTip on release tag push — stack traces in prod are readable by release
- [ ] **EXT-02**: Operator sees workers publishing heartbeat keys to Redis on a configurable interval, so OPS-03's worker heartbeat status reflects real state, not a mock

## Future Requirements

### TRC (deferred)

- **TRC-future-01**: Drizzle/postgres.js DB-level span instrumentation — deferred pending confirmation of postgres.js OTEL instrumentation path; DB context currently reached via CQRS handler spans

### MET (deferred)

- **MET-future-01**: `/metrics` Prometheus scrape endpoint alongside OTLP push — scrape-based collectors not needed for v1.3 self-hosted stack
- **MET-future-02**: OTEL histogram exemplars linking metrics ↔ traces — revisit when request volume exceeds 100k req/min

### ALT (deferred)

- **ALT-future-01**: Full in-app `AlertRouter` port with email + webhook adapters and in-code alert-rule definitions — v1.3 ships templates only

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Replacing pino with another logger | pino stays canonical; ErrorTracker adapters tee from it, not replace |
| Building a native bull-board UI in the Vite admin SPA | Iframe embed is lower-risk; bull-board already solves the problem |
| Per-tenant GDPR/LGPD trace retention automation | Legal/compliance policy decision belongs to the fork user; v1.3 ships guidance, not automation |
| Browser → collector telemetry from Next.js customer app | v1.3 is backend-origin only; browser telemetry has CORS + sampling design impact, revisit later |
| In-app custom alert evaluation engine | Ship Grafana/Sentry-shaped templates instead; rebuilding their alert engines is multi-week waste |
| `@sentry/node` (explicitly NOT used) | `@sentry/bun` required for Bun compat; `@sentry/profiling-node` broken under Bun |
| OTEL `--require`-style auto-instrumentation | Not honored by Bun; programmatic `NodeSDK` init only |

## Traceability

Which phases cover which requirements. Populated during roadmap creation (2026-04-21).

| Requirement | Phase | Status |
|-------------|-------|--------|
| OBS-01 | Phase 17 | Satisfied (2026-04-22) |
| OBS-02 | Phase 17 | Satisfied (2026-04-22) |
| OBS-03 | Phase 17 | Satisfied (2026-04-22) |
| OBS-04 | Phase 17 | Satisfied (2026-04-22) |
| ERR-01 | Phase 18 | Pending |
| ERR-02 | Phase 18 | Pending |
| ERR-03 | Phase 18 | Pending |
| ERR-04 | Phase 18 | Pending |
| CTX-01 | Phase 19 | Pending |
| CTX-02 | Phase 19 | Pending |
| CTX-03 | Phase 19 | Pending |
| CTX-04 | Phase 20 | Pending |
| TRC-01 | Phase 19 | Pending |
| TRC-02 | Phase 19 | Pending |
| TRC-03 | Phase 20 | Pending |
| MET-01 | Phase 21 | Pending |
| MET-02 | Phase 21 | Pending |
| MET-03 | Phase 21 | Pending |
| OPS-01 | Phase 22 | Pending |
| OPS-02 | Phase 22 | Pending |
| OPS-03 | Phase 22 | Pending |
| OPS-04 | Phase 22 | Pending |
| DOC-01 | Phase 21 | Pending |
| DOC-02 | Phase 21 | Pending |
| DOC-03 | Phase 23 | Pending |
| DOC-04 | Phase 23 | Pending |
| EXT-01 | Phase 18 | Pending |
| EXT-02 | Phase 22 | Pending |

**Coverage:**
- v1.3 requirements: 28 total
- Mapped to phases: 28 ✓
- Unmapped: 0

**Phase distribution:**

| Phase | Requirements | Count |
|-------|--------------|-------|
| 17 | OBS-01, OBS-02, OBS-03, OBS-04 | 4 |
| 18 | ERR-01, ERR-02, ERR-03, ERR-04, EXT-01 | 5 |
| 19 | CTX-01, CTX-02, CTX-03, TRC-01, TRC-02 | 5 |
| 20 | CTX-04, TRC-03 | 2 |
| 21 | MET-01, MET-02, MET-03, DOC-01, DOC-02 | 5 |
| 22 | OPS-01, OPS-02, OPS-03, OPS-04, EXT-02 | 5 |
| 23 | DOC-03, DOC-04 | 2 |

---
*Requirements defined: 2026-04-21*
*Last updated: 2026-04-21 after roadmap creation — traceability populated*
