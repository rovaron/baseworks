# Feature Research

**Domain:** Production-grade observability & operations tooling for a multitenant SaaS starter (Bun + Elysia + BullMQ + PostgreSQL + Redis)
**Researched:** 2026-04-21
**Confidence:** MEDIUM-HIGH (patterns are industry-standard; Bun-specific OTEL wiring is the main uncertainty)
**Milestone:** v1.3 Observability & Operations (subsequent milestone — augments existing pino logging, /health endpoint, and CQRS/BullMQ infrastructure)

## Scope Guardrails (From Milestone Context)

This research intentionally does **not** re-cover features already shipped in v1.0–v1.2:
- Pino structured logging (baseline — v1.3 **upgrades** it, does not replace)
- `/health` endpoint with DB + Redis + queue status (baseline — v1.3 **upgrades** it)
- CQRS dispatch with TypeBox validation
- Module registry, event bus, tenant-scoped DB, auth, billing, admin dashboard

The eight v1.3 target features from `.planning/PROJECT.md` drive the analysis below. Each feature is broken into **table stakes**, **differentiators**, and **anti-features**, with complexity, dependencies, and REQ-ID-ready descriptions.

---

## Feature Landscape

### Table Stakes (Production-Grade Minimum)

These are the "not-laughable" baselines. If any of these are missing, operators will route around Baseworks with their own tooling within the first week.

#### 1. Error Tracking

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `ErrorTracker` port with `captureException(err, context)` + `captureMessage(msg, level, context)` | Port/adapter pattern already used for `PaymentProvider`; fork users must be able to swap Sentry ↔ GlitchTip ↔ Pino-sink via env var | LOW | Mirror the shape of `packages/billing/src/ports/PaymentProvider.ts`. Noop adapter for tests. |
| Uncaught exception + unhandled rejection capture | Node process will crash silently without this; baseline for any tracker | LOW | Register global handlers once in `apps/api/src/bootstrap.ts` and worker entrypoints |
| Elysia route error capture | The primary surface area of the API; must capture 5xx with route, method, status | LOW | Use Elysia's `onError` lifecycle hook; skip 4xx (noise) but capture for status >=500 |
| CQRS handler error capture (command + query) | CQRS dispatch is the app's core business-logic boundary; failures here are what operators actually want to see | LOW-MEDIUM | Wrap dispatcher; capture `command_name`, `tenant_id`, `user_id`, sanitized payload (PII-redacted) |
| BullMQ job failure capture | Jobs fail asynchronously out-of-band of user requests; without capture they are invisible | LOW | Listen to `failed` event on every worker; capture `job.name`, `job.id`, `job.data` (redacted), attempt count, final error |
| Context enrichment: `tenant_id`, `user_id`, `correlation_id`, `command_name`, `span_id` / `trace_id` | Non-negotiable for multitenant debugging — "which tenant is broken?" is the first question | LOW | Pull from AsyncLocalStorage context (see Logging feature). Sentry tags + user + contexts API. |
| PII redaction before send | Legal / GDPR concern; captures often contain request bodies with emails, passwords, tokens | MEDIUM | Shared redaction list (Authorization, cookie, password, token, apiKey, creditCard, cpf, cnpj for Pagar.me) applied at tracker layer, not per-callsite |
| Release tracking (commit SHA or version tag) | Distinguish "error in v1.2.3" from "error in v1.2.4"; table stakes for regression detection | LOW | Inject `SENTRY_RELEASE` env var at build time from git SHA; adapter reads it |
| Environment tagging (`dev` / `staging` / `prod`) | Prevents dev errors polluting prod dashboards | LOW | Read `NODE_ENV` + optional `DEPLOY_ENV` |

#### 2. Metrics

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `MetricsProvider` port with `counter`, `histogram`, `gauge` primitives | Port/adapter mirrors `ErrorTracker`; Noop adapter for tests and fork users who don't want OTEL | LOW | Expose OTEL Meter API shape directly — don't invent a wrapper around it |
| RED metrics per Elysia route: request **R**ate, **E**rrors, **D**uration | The RED method is the industry standard for request-driven services (Weaveworks canonical, still correct in 2026) | LOW-MEDIUM | Use route **template** (`/users/:id`) not raw path (`/users/123`) as label — else cardinality explodes |
| USE metrics for pooled resources: **U**tilization, **S**aturation, **E**rrors on DB pool + Redis pool | Complementary to RED (RED for requests, USE for resources — Brendan Gregg canonical) | MEDIUM | DB pool: total / in-use / idle / waiting. Redis: same. Scrape from `postgres.js` pool + ioredis status. |
| BullMQ queue metrics: depth (waiting), active, completed, failed, delayed, duration histogram per job type | Queue depth is the #1 leading indicator of worker health; missing = flying blind | LOW | BullMQ exposes `getJobCounts()`; scrape on a timer and emit as gauges. Job duration: wrap processor. |
| HTTP exporter for Prometheus scrape (`/metrics` endpoint, separate port or path) | Prometheus-first ecosystem; OTEL collector can also scrape Prom format | LOW | Gate behind `METRICS_ENABLED=true`; bind to internal port in prod (not public) |
| CQRS dispatch metrics: command count, duration histogram, error rate per `command_name` | The app-level RED — tells you which commands are slow/failing without route-level noise | LOW | Emit from dispatcher middleware; label = `command_name` (low cardinality by design) |
| Process metrics: heap used, RSS, event loop lag, uptime | Standard SRE baseline; near-zero cost via `@opentelemetry/instrumentation-runtime-node` | LOW | Auto-instrumentation handles this — just enable it |
| Noop adapter (metrics disabled) | Fork users who don't want metrics infra shouldn't pay the runtime cost | LOW | Zero-overhead stubs; the `port` pattern makes this trivial |

#### 3. Distributed Tracing

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `Tracer` port wrapping OTEL Tracer API | Consistent with ErrorTracker/MetricsProvider pattern | LOW | Thin wrapper over `@opentelemetry/api` Tracer; expose `startSpan` / `withSpan` helpers |
| Elysia HTTP server auto-instrumentation | The entry point for every request — without this, traces are 0% useful | MEDIUM | Bun OTEL compat is the **main risk**. Use `@opentelemetry/instrumentation-http` + Elysia lifecycle hooks for span naming |
| Drizzle / postgres.js query instrumentation | The #1 latency source in any app is the DB; without DB spans, traces are ornamental | MEDIUM | Either `@opentelemetry/instrumentation-pg` (check postgres.js compat) or manual wrapper around Drizzle's query execution |
| BullMQ enqueue → worker span continuity via W3C traceparent | Producer span must link to consumer span or async work is invisible in traces | MEDIUM-HIGH | Inject `traceparent` into job data on enqueue; extract in worker `process` callback; create `messaging.process` span as child of injected context |
| CQRS dispatch spans (`cqrs.command.<name>`, `cqrs.query.<name>`) | App-level business-logic boundary; most useful span layer for debugging | LOW | Wrap dispatcher; span name convention: `cqrs.command.create-user`, attributes: `tenant_id`, `user_id`, `command_name` |
| W3C traceparent propagation (HTTP in + out, BullMQ in + out) | Standard since 2020; every vendor speaks it; interop across services | LOW | Use `W3CTraceContextPropagator` + `W3CBaggagePropagator` (baggage for `tenant_id`) |
| AsyncLocalStorage-backed context manager | Required for trace context to survive async boundaries (Promise chains, event handlers, timers) | LOW | OTEL ships `AsyncLocalStorageContextManager` — just register it |
| OTLP exporter (gRPC or HTTP) | Standard OTEL wire protocol; target = local Grafana Tempo or any OTEL collector | LOW | `@opentelemetry/exporter-trace-otlp-http` — use HTTP (gRPC has more Bun edges) |
| Parent-based sampler with configurable ratio (0.0 → 1.0) | 100% sampling in dev, 5-10% in prod; standard pattern | LOW | `ParentBasedSampler` + `TraceIdRatioBasedSampler`; env: `OTEL_TRACES_SAMPLER_ARG=0.1` |

#### 4. Structured Logging Upgrade

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| AsyncLocalStorage-based request context carrier | The foundation for correlation — once in place, every log line automatically gets `correlation_id`, `tenant_id`, `user_id`, `trace_id`, `span_id` without threading parameters | LOW-MEDIUM | Single `requestContext` ALS instance; middleware runs `als.run(ctx, next)` per request. Worker wraps `als.run(jobCtx, processor)` per job. |
| Pino mixin reading from ALS on every log call | Auto-enriches all logs; no `.child()` threading required | LOW | `pino({ mixin: () => requestContext.getStore() ?? {} })` — one line |
| Correlation ID generation + header propagation | `X-Correlation-Id` / `X-Request-Id` header in + out; generated if absent on ingress | LOW | Middleware reads header or generates ULID/nanoid, attaches to ALS and response header |
| Correlation ID propagated into BullMQ job metadata | Breaking the chain at the queue is the #1 reason "where did this fail?" debugging stalls | LOW | Add `correlationId`, `traceparent`, `tenantId` to job data at enqueue; worker pulls them back into ALS |
| `trace_id` + `span_id` auto-injected into log entries | Enables Grafana "log → trace" jump; table stakes for log-trace correlation | LOW | Pull from OTEL active context in pino mixin |
| Log level per environment (`debug` dev, `info` prod) | Noise control; performance (pino formatting has cost at `debug`) | LOW | Env-driven: `LOG_LEVEL=info` default |
| Structured field conventions (`tenant_id`, `user_id`, `command_name`, `job_name`, `duration_ms`, `error.type`, `error.message`, `error.stack`) | Consistent field names = queryable in Loki/Splunk/Datadog; otherwise logs are regex hell | LOW | Document in a short conventions file; enforce via lint rule if energy allows (otherwise code review) |
| PII redaction at pino level (shared redaction list with error tracker) | Same legal concern as error tracking; single source of truth | LOW | `pino({ redact: [...] })` with list shared from a `@baseworks/observability` module |
| Child loggers for CQRS handlers + workers (module/handler tagging) | `log.child({ module: 'billing', handler: 'create-subscription' })` makes filter queries trivial | LOW | Factory helper `getLogger('billing.create-subscription')` |

#### 5. Admin Job Monitor (bull-board)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| bull-board UI embedded at `/admin/jobs` route in the Vite admin dashboard | The admin dashboard already exists; embedding keeps one console, one auth session | MEDIUM | bull-board exposes Express/Koa/Fastify/Hono adapters. Elysia adapter may need a tiny shim — check `@bull-board/api` + a custom `ServerAdapter`. |
| All module queues auto-registered | Manual queue registration drifts; registry should emit queues into the dashboard automatically | LOW | Module registry already tracks queues; iterate at startup |
| Queue operations: retry, promote, remove, drain (failed/completed/delayed) | Basic ops hygiene; without these, operators SSH into Redis to flush jobs manually | LOW | bull-board ships these built-in; just enable them |
| View job data + result + error stack | Core debug affordance; seeing `job.data` + failure reason is 80% of job debugging | LOW | bull-board default |
| RBAC gating via existing admin auth (admin role or `can_view_jobs` permission) | Jobs contain PII (email payloads, billing data); exposing to all users is a data leak | LOW-MEDIUM | Guard the Elysia mount with existing better-auth admin-role middleware — not bull-board's own basic auth |
| Job search / filter by name, status, date | At 1K+ jobs the default list is useless | LOW | bull-board default — just confirm it works |
| Multi-queue dashboard (not one queue at a time) | Per-queue tabs are what bull-board ships; single dashboard view of all queues is the modern ask | LOW | bull-board default |

#### 6. Health Dashboard Upgrade

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Extend existing `/health` endpoint with: queue depth per queue, worker heartbeat freshness, DB replication lag (if replica), recent error count (last 5min), per-module load status | The current `/health` is fine as a load-balancer probe; the dashboard view is what operators want | MEDIUM | Split into `/health` (liveness, fast, no deps) and `/health/detailed` (all checks, auth-required) — standard split |
| Admin UI "System Health" page upgraded with the detailed data | Already exists as a skeleton; wire the new endpoint to it | LOW-MEDIUM | Extend existing admin health page; add status cards + last-updated timestamp |
| Worker heartbeat mechanism (worker writes to Redis every N seconds, API reads age) | Without heartbeat, dead workers go unnoticed until queue depth alerts fire | LOW | Worker SET `worker:heartbeat:<id>` TTL 30s every 10s; health check asserts at least one heartbeat < 30s old |
| Queue depth thresholds with warning / critical states | Operators need "is this normal?" at a glance; raw numbers are useless without thresholds | LOW | Configurable per queue in env or config file; default: warn >100, critical >1000 |
| "Golden signals" summary card at top: latency p95, error rate, request rate, saturation | Google SRE canonical; one glance = is the system healthy | LOW-MEDIUM | Read from metrics provider; if metrics disabled, hide card |
| Per-module status (loaded / failed-to-load / disabled) | Module registry already knows this; surface it | LOW | Iterate `moduleRegistry.getAll()`; show load state |

#### 7. Runbooks + Alert Playbook

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `docs/runbooks/` directory with one `.md` per incident class | Industry standard; version-controlled > wiki rot | LOW | Existing `docs/` folder already has integration docs — add peer directory |
| Consistent runbook template: **Trigger → Symptoms → Triage → Resolution → Escalation → Post-incident** | Pattern matches 2026 industry guidance; lets a new engineer execute at 3am | LOW | Single `TEMPLATE.md`; every runbook copies from it |
| Runbooks for each common incident class for this stack: DB connection exhaustion, Redis down, BullMQ queue backed up, worker stuck, Stripe webhook failures, high 5xx rate, OAuth provider outage, email delivery backlog, better-auth session store failure | These are the actual incident classes for a Bun + Elysia + PostgreSQL + BullMQ + Stripe SaaS | MEDIUM | 8-10 runbooks is the right volume — enough to cover, few enough to maintain |
| Alert → runbook linking (alert payload contains runbook URL) | Closes the loop from "pager fires" to "here's what to do" without humans searching | LOW | Grafana alert annotation `runbook_url`; Sentry alert includes link |
| Pre-built Grafana alert rule YAML (`docs/runbooks/grafana-alerts.yaml`) | Starter-kit value prop — fork users inherit a baseline alert set | LOW-MEDIUM | ~8-12 rules covering the runbook incident classes |
| Pre-built Sentry alert configuration templates (JSON or docs) | Same starter-kit value for error-based alerts | LOW | Document alert conditions; actual API import is optional (docs → click in UI is fine for v1.3) |
| Alert fatigue guardrails documented (deduplication windows, `for:` thresholds, severity levels) | Every mature SRE org relearns this lesson the hard way | LOW | Single `docs/runbooks/ALERT-PHILOSOPHY.md` with the principles |

#### 8. Local Dev Observability Stack

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `docker-compose.observability.yml` separate from main `docker-compose.yml` | Composable opt-in; don't force Grafana stack on every `bun dev` | LOW | Pattern: `docker compose -f docker-compose.yml -f docker-compose.observability.yml up` |
| OTEL Collector receiving OTLP (port 4318 HTTP, 4317 gRPC) | Central funnel; app sends OTLP, collector routes to Tempo/Loki/Prom — standard pattern | LOW | `otel/opentelemetry-collector-contrib` with a `otel-collector-config.yaml` |
| Grafana Tempo for traces | Grafana's trace backend; cheap, local-friendly, single binary | LOW | Single-binary mode; HTTP API port 3200 |
| Grafana Loki for logs | Grafana's log backend; ingest via OTEL Collector or Promtail | LOW-MEDIUM | OTEL Collector → Loki is simpler than Promtail — use that |
| Prometheus for metrics | Industry-standard metrics backend; scrapes `/metrics` endpoint | LOW | Default config scrapes `host.docker.internal:<api-port>/metrics` |
| Grafana with pre-provisioned data sources (Tempo + Loki + Prometheus) | Zero-click onboarding; log in at `localhost:3000` and everything is wired | LOW | Grafana provisioning directory `grafana/provisioning/datasources/datasources.yaml` |
| Pre-built Grafana dashboards provisioned: **API Overview** (RED per route), **Queue Health** (BullMQ depth, throughput, failures), **DB + Redis** (USE metrics), **Errors** (error rate + recent exceptions by route/command) | Starter-kit value — Grafana's empty state is the killer of adoption | MEDIUM | 4 dashboards = right volume; more = maintenance burden |
| Reasonable default resource limits (tempo 256MB, loki 256MB, prom 512MB) | Dev laptops have 16GB RAM total; observability shouldn't eat half | LOW | Set `deploy.resources.limits` in compose |
| README snippet: how to start, how to access, how to stop, how to reset | Turn "runs on my laptop" into "runs on every fork user's laptop" | LOW | 10 lines in `docs/observability/local-stack.md` |

---

### Differentiators (Above Baseline — Starter-Kit Value-Add)

These features push Baseworks past "production-grade" into "opinionated kit with batteries included." Each one exists because Baseworks is a *starter kit*, so wiring one great path beats listing five options.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Three real `ErrorTracker` adapters (Sentry, GlitchTip, Pino-sink) | Mirrors the Stripe / Pagar.me PaymentProvider story — "you get two real backends plus a noop, not one vendor lock-in" | MEDIUM | GlitchTip is Sentry-wire-compatible → a thin config shim on top of Sentry SDK is often enough. Pino-sink is a log-structured alternative for users who don't want a tracker at all. |
| CQRS dispatch span + metric + log correlation as a single middleware layer | One middleware emits span, metric (counter + histogram), and a structured log entry per command with the same correlation fields. Developers get full observability on every command with zero extra work. | MEDIUM | The layer that ties all three signals together. This is what makes Baseworks' observability feel coherent vs bolted-on. |
| Tenant-aware sampling (sample 100% of traces for a flagged tenant, 10% otherwise) | Lets operators debug a specific customer's traffic without flooding traces for everyone | MEDIUM | Custom `Sampler` checking `tenantId` baggage; flag list in Redis for hot reload |
| "Recent errors" panel on the admin system-health page (last 10 errors with tenant, command, timestamp) | Operators see problems without leaving the admin dashboard; bridges ErrorTracker data into the main UI | LOW-MEDIUM | Either pull from Sentry API (if configured) or a local in-memory ring buffer for the pino-sink adapter |
| Per-module status + owned-queue-depth rollup in health dashboard | Module-level view: "billing is healthy, email is backed up" instead of per-queue raw numbers | LOW | Module registry already groups queues; roll them up in the health endpoint |
| Runbook validation script (asserts every runbook has the required sections + every Grafana alert has a `runbook_url`) | Same style as `scripts/validate-docs.ts` — turns "write good runbooks" into a contract | LOW | Extend the existing `validate-docs.ts` pattern |
| `/debug/trace/:id` endpoint that redirects to the configured tracing UI (Tempo / Jaeger / Datadog) | One-click jump from a log line to the trace view; reduces friction in debugging | LOW | Env var `TRACE_UI_BASE_URL`, redirect with trace ID appended |
| Pre-built OpenTelemetry Collector config with working routing for Tempo + Loki + Prometheus | Fork users inherit a known-good collector config instead of learning OTEL routing syntax | LOW | Ship in `docker-compose.observability/otel-collector-config.yaml` |
| Grafana dashboard for the "CQRS view": commands per second, p95 per command, error rate per command, top-10 slowest commands | This is Baseworks-specific and the thing fork users will most value (their domain logic lives in CQRS handlers) | MEDIUM | Grafana JSON dashboard file; uses the command-level metrics emitted by the dispatch middleware |
| Synthetic incident script (`bun run simulate:incident <name>`) that fires a known failure pattern | Lets fork users smoke-test their alert wiring locally before going to prod | MEDIUM | `bun run simulate:incident db-down` → temporarily makes DB unreachable for 30s. Optional but high-ROI for starter-kit credibility. |
| better-auth session + org context auto-added to every error/log/trace | Tenant + user context is the #1 debugging question; auto-wiring saves every fork user from rediscovering this | LOW | Middleware reads session once, writes to ALS; everything downstream reads from ALS |

---

### Anti-Features (Do NOT Build)

The traps. These seem like obvious additions but create more problems than they solve — either overengineering for a starter kit, creating maintenance debt, or duplicating upstream tooling.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Custom in-app alert pipeline (evaluate metric rules, send to Slack/PagerDuty in-process) | "We should send alerts ourselves" | Grafana/Sentry already do this correctly; rebuilding is weeks of work and you will get deduplication, flapping, and silencing wrong | Ship **alert config templates** + runbooks only. Explicitly deferred per PROJECT.md. |
| Custom logs UI in admin dashboard (viewer with filters, tail, search) | "Nice to see logs without leaving the admin" | This is Grafana/Kibana/Datadog's entire reason to exist; your version will be strictly worse | Link out to Loki / Grafana from the admin. Add a "Logs" sidebar link pointing to `LOG_UI_BASE_URL` |
| Storing metrics / traces / logs in the app's own PostgreSQL | "We already have a DB, why add Prometheus?" | Time-series data crushes an OLTP Postgres; cardinality will tank your app; no query engine for metrics | Ship the docker-compose observability stack; keep OLTP and telemetry separate. Non-negotiable. |
| Full event sourcing / audit log of every command with payload | "We should have an audit trail" | Different problem than observability; event store complexity; PII storage nightmare | Structured CQRS dispatch logs via pino already cover the 80% case. Defer full audit logs to a separate v1.x decision. |
| Automatic alert rule generation from code annotations | "Declare SLOs in code and auto-create alerts" | Cute in theory; leaky abstractions in practice; alert tuning is a human judgment call | Hand-written alert YAML templates; document the principles |
| Real-time metrics streaming to the admin dashboard (WebSocket push of live QPS graphs) | "Live graphs look cool" | Re-implementing Grafana; performance cost; maintenance burden | Grafana iframe embed on the admin dashboard, or a "View in Grafana" link |
| Sampling decisions based on request payload content | "Sample errors always, success 1%" | Requires buffering entire request bodies; memory pressure; PII risk; standard tail sampling is better done by the OTEL Collector | Use OTEL Collector's tail-sampling processor if needed; head sampling (parent-based ratio) as default |
| User feedback widget integrated into error tracking | "Let users report bugs that auto-attach Sentry event" | Sentry ships this; wiring it in is 10 lines of the Sentry browser SDK; not a Baseworks API concern | Document "to enable Sentry user feedback, add `<SentryFeedback />` from their SDK" in the Sentry integration doc |
| Source map upload automation in CI/CD | "Debug minified errors in prod" | Baseworks ships backend-only (Bun runs TS natively — no minification); Next.js app handles this via the Sentry Next.js plugin, already-solved | Document it for the Next.js app in the Sentry integration doc; do not build it for the API |
| Custom span processor / exporter | "We want our own wire format" | OTLP is the standard; custom processors become a Bun/Node compat nightmare at every OTEL SDK upgrade | Use stock OTLP exporter + OTEL Collector for any routing logic |
| Multi-backend error tracking (send to Sentry AND GlitchTip AND Rollbar simultaneously) | "Redundancy!" | Double the spend, double the config; if one's down, the other almost certainly is too (network issue) | Single-adapter selection via env; the port pattern makes swapping trivial |
| Per-request profiling (CPU / memory flame graphs per HTTP request) | "We want Pyroscope / continuous profiling" | Legitimately valuable but scope creep; a whole separate port/adapter/backend story | Defer to v1.4+ as a dedicated "continuous profiling" feature if demand emerges |
| Custom Grafana plugin / panel for CQRS | "Native Grafana integration for our command model" | Building Grafana plugins is an entire subproject; stock panels are fine for v1.3 | Use stock bar-gauge and heatmap panels with templated variables for command name |
| Tracing of Drizzle query parameters (the actual values) | "See exactly what parameters ran" | PII leak; queries have tenant data, passwords, tokens; regulatory risk | Trace query template + duration only. OTEL's pg instrumentation has `enhancedDatabaseReporting: false` — keep it off. |
| 100% sampling in production | "We want to see every trace" | OTLP export cost, storage cost, Grafana UI becomes unusable at scale | Parent-based + 10% ratio default; document how to raise it |
| Pre-built dashboards for every possible metric | "More dashboards is better" | Maintenance debt; stale dashboards are worse than missing ones | 4 well-maintained dashboards > 20 stale ones |

---

## Feature Dependencies

```
[Logging Upgrade (AsyncLocalStorage context)]
    └──required by──> [Error Tracking (context enrichment)]
    └──required by──> [Distributed Tracing (context propagation)]
    └──required by──> [Metrics (tenant/user labels)]

[Distributed Tracing]
    └──required by──> [Error Tracking (trace_id / span_id in error events)]
    └──required by──> [Logging Upgrade (trace_id / span_id in logs)]
    └──enhances─────> [Local Dev Observability Stack (Tempo only useful with traces)]

[Metrics]
    └──required by──> [Health Dashboard Upgrade (golden signals card)]
    └──required by──> [Local Dev Observability Stack (Prometheus only useful with metrics)]
    └──required by──> [Runbooks + Alerts (alert rules require metrics to exist)]

[Error Tracking]
    └──required by──> [Runbooks + Alerts (Sentry alert templates require the Sentry adapter)]

[Admin Job Monitor (bull-board)]
    └──independent──  [Ships in parallel; only depends on existing BullMQ + admin auth]

[Health Dashboard Upgrade]
    └──enhances─────> [Runbooks (triage steps reference the health page)]

[Runbooks + Alerts]
    └──requires──> [Local Dev Observability Stack (Grafana alert YAML has no home without Grafana)]
    └──requires──> [Error Tracking + Metrics (the alerting substrates)]

[Local Dev Observability Stack]
    └──requires──> [Metrics + Tracing + Logs (it's the consumer of all three signals)]
```

### Dependency Notes

- **Logging Upgrade is the keystone.** AsyncLocalStorage-backed request context is the foundation for tenant/user/correlation-ID propagation across errors, traces, metrics labels, and logs. Ship this first or retrofit it painfully later.
- **Tracing depends on Logging's ALS.** OTEL's own AsyncLocalStorageContextManager and the app's request-context ALS should be the same instance (or tightly coordinated) so that `trace_id` is available everywhere the `correlation_id` is.
- **Metrics depends on Logging for labels.** You can emit metrics without logging context, but cardinality discipline means the labels come from the same `tenant_id` / `command_name` values already in the logging ALS.
- **Error Tracking needs Tracing to be fully useful.** Errors without `trace_id` force engineers to pivot manually from Sentry to logs to traces; errors with `trace_id` are one click away.
- **Runbooks + Alerts depend on everything else existing.** A runbook that says "check Grafana dashboard X" is hollow if dashboards don't exist; a Grafana alert requires Prometheus scraping metrics; a Sentry alert template requires the Sentry adapter configured.
- **Admin Job Monitor is the most independent.** It touches only BullMQ + existing admin auth. Can ship first or last without affecting any other feature. Good "reward" phase if energy is flagging.
- **Health Dashboard Upgrade is mostly independent** of the OTEL stack — it can read BullMQ + DB + Redis state directly without needing Prometheus. It becomes *better* with metrics (golden signals card) but doesn't require them.
- **Local Dev Stack ships late.** It's the consumer of metrics, traces, logs — it needs all three signals emitting before it's useful. Also where Grafana dashboards + alert YAML live.

---

## MVP Definition

### v1.3 Launch (the whole milestone)

This is a subsequent milestone, not a greenfield MVP — everything listed in `.planning/PROJECT.md` Active is in scope. The table stakes above are the floor. The launch set:

- [x] **Logging upgrade with AsyncLocalStorage + correlation IDs** — foundation for everything else
- [x] **Error tracking with port + Sentry + GlitchTip + Pino-sink adapters** — per the PROJECT.md adapter matrix
- [x] **Metrics with port + OTEL adapter + Noop adapter** — RED for routes + CQRS, USE for DB/Redis, BullMQ queue metrics
- [x] **Distributed tracing with port + OTEL adapter + Noop adapter** — HTTP + DB + BullMQ + CQRS spans, W3C traceparent propagation
- [x] **Admin job monitor embedded in the admin dashboard with RBAC** — bull-board
- [x] **Health dashboard upgrade** — queue depth, worker heartbeat, DB lag, recent errors, per-module status, golden signals card
- [x] **Runbooks directory + alert playbook + Grafana alert YAML + Sentry alert templates** — 8-10 runbooks for this stack's incident classes
- [x] **Local dev observability stack** — docker-compose.observability.yml with OTEL Collector + Tempo + Loki + Prometheus + Grafana + 4 provisioned dashboards

### Differentiators Worth Including in v1.3

Based on ROI for a starter kit (each is low-to-medium complexity but high fork-user value):

- [ ] **CQRS dispatch span + metric + log correlation as a single middleware** — this is what makes observability feel native, not bolted-on
- [ ] **"Recent errors" panel on admin health page** — closes the loop inside the admin UI
- [ ] **Grafana dashboard for CQRS view** — Baseworks-specific, highest differentiator value per hour of work
- [ ] **better-auth session + org context auto-injection to ALS** — reuses existing auth, unlocks every downstream tenant-aware feature
- [ ] **Runbook validation script** — matches existing `scripts/validate-docs.ts` pattern; cheap enforcement

### Defer to v1.4+ (Future Consideration)

- [ ] **Tenant-aware sampling (boost specific tenants to 100%)** — needs a UI for flag management; premature for v1.3
- [ ] **Synthetic incident script (`bun run simulate:incident`)** — high value but large surface area; build after v1.3 patterns settle
- [ ] **In-app alert pipeline** — explicitly deferred per PROJECT.md; revisit "if demand emerges"
- [ ] **Continuous profiling (Pyroscope)** — whole new port/adapter story
- [ ] **Log-based metrics generation** — OTEL Collector already supports this; document the pattern instead of building a custom layer
- [ ] **Multi-region tracing aggregation** — Baseworks doesn't ship multi-region topology; wait until it does

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority | Rationale |
|---------|------------|---------------------|----------|-----------|
| Logging upgrade (AsyncLocalStorage + correlation) | HIGH | LOW-MEDIUM | **P1** | Foundation for everything else; must ship first |
| Error tracking (port + 3 adapters) | HIGH | MEDIUM | **P1** | Most immediate operator value; works standalone |
| Distributed tracing (port + OTEL) | HIGH | MEDIUM-HIGH | **P1** | Bun compat is the main risk; de-risk early |
| Metrics (port + OTEL) | HIGH | MEDIUM | **P1** | RED/USE baseline; feeds health dashboard + alerts |
| Admin job monitor (bull-board) | MEDIUM-HIGH | LOW-MEDIUM | **P1** | High ROI, nearly independent; can ship early for confidence |
| Health dashboard upgrade | MEDIUM-HIGH | MEDIUM | **P1** | Reuses existing admin page; relatively cheap |
| Runbooks + alert YAML templates | HIGH (for fork users) | LOW-MEDIUM | **P1** | Starter-kit value prop; documentation-heavy |
| Local dev observability stack | MEDIUM-HIGH | MEDIUM | **P1** | The demo experience; Grafana dashboards are the hero artifact |
| CQRS correlation middleware (single layer) | HIGH | MEDIUM | **P1** | Differentiator; defines Baseworks' observability story |
| "Recent errors" panel on admin | MEDIUM | LOW | **P2** | Nice in-app UX; works even without Sentry adapter (ring buffer) |
| Grafana CQRS dashboard | MEDIUM | MEDIUM | **P2** | High fork-user value but can ship as a second dashboards PR |
| better-auth context auto-injection | HIGH | LOW | **P1** | Cheap; unlocks tenant-aware everything |
| Runbook validation script | LOW-MEDIUM | LOW | **P2** | Nice-to-have; matches existing patterns |
| Tenant-aware sampling | LOW (today) | MEDIUM | **P3** | Needs flag management; defer to v1.4 |
| Synthetic incident script | MEDIUM | MEDIUM-HIGH | **P3** | High demo value but scope creep for v1.3 |
| In-app alert pipeline | MEDIUM | HIGH | **P3 (deferred)** | Explicitly out of scope per PROJECT.md |

---

## Competitor Feature Analysis

Reference points for what a "complete" observability story looks like in 2026:

| Feature | Next.js Starter (T3) | Medusa Backend | RedwoodJS | Baseworks v1.3 Plan |
|---------|----------------------|----------------|-----------|---------------------|
| Error tracking | Sentry (Next.js SDK only, frontend-focused) | Minimal (console + pino) | Sentry optional | **Port + 3 adapters** (Sentry, GlitchTip, Pino-sink) — swap via env |
| Distributed tracing | None built-in | None built-in | None built-in | **OTEL port + adapter** — API + DB + BullMQ + CQRS |
| Metrics | None built-in | None built-in | None built-in | **OTEL MetricsProvider port + adapter** — RED + USE + queue + CQRS |
| Structured logging | Optional pino | Minimal pino | Winston default | **Pino + ALS + correlation ID + trace/span ID auto-injection** |
| Job monitor | N/A | Medusa has its own admin | N/A | **bull-board embedded in admin with RBAC** |
| Health endpoint | Manual | Basic `/health` | Minimal | **`/health` + `/health/detailed` with golden signals** |
| Runbooks | None | None | None | **8-10 incident runbooks + alert templates** |
| Local observability stack | None | None | None | **docker-compose.observability.yml with 4 pre-built dashboards** |

The competitive insight: **no major SaaS starter ships a complete observability story.** The baseline is "maybe Sentry on the frontend, maybe structured logs, figure out the rest yourself." Baseworks v1.3 is positioned to meaningfully differentiate here — which is exactly why the differentiators matter: they're the evidence that the observability story is native rather than slapped-on.

---

## Bun-Specific Considerations (Flagged Risk)

Three known risk areas for this milestone, all Bun-runtime-related:

1. **OTEL Node SDK auto-instrumentation under Bun.** Bun supports Node's `--require` flag and most Node APIs, but several auto-instrumentation packages rely on deep `require` hooks or `module._resolveFilename` patching that has historically had Bun compat edges. **Mitigation:** Prefer programmatic OTEL SDK initialization (construct SDK + register instrumentations explicitly in a `tracing.ts` file imported first) over `--require @opentelemetry/auto-instrumentations-node`. This is the 2026-current recommended Bun+OTEL pattern per multiple blog sources. Verify per-instrumentation at implementation time (pg, http, elysia plugin, bullmq).

2. **AsyncLocalStorage under Bun.** `node:async_hooks` and `AsyncLocalStorage` are supported in Bun. Broad ecosystem usage (pino, OTEL context manager, better-auth) confirms it works. Low risk; verify with a smoke test early in the milestone.

3. **OTLP exporter wire protocol.** HTTP exporter (`@opentelemetry/exporter-trace-otlp-http`) is lower-risk than gRPC under Bun. Default to HTTP; revisit gRPC only if someone measures the export cost and cares.

These also belong in PITFALLS.md but are flagged here because they shape the complexity column above — HIGH-complexity tracing items are HIGH partly because of Bun compat risk, not just raw scope.

---

## Sources

- [How to Configure OpenTelemetry in Bun Without the Node.js --require Flag (OneUptime, Feb 2026)](https://oneuptime.com/blog/post/2026-02-06-opentelemetry-bun-without-nodejs-require-flag/view)
- [How to Instrument Bun and ElysiaJS Applications with OpenTelemetry (OneUptime, Feb 2026)](https://oneuptime.com/blog/post/2026-02-06-instrument-bun-elysiajs-opentelemetry/view)
- [Is there (or will be a official) opentelemetry provider library for bun? (Bun discussion #7185)](https://github.com/oven-sh/bun/discussions/7185)
- [bull-board GitHub (felixmosh)](https://github.com/felixmosh/bull-board)
- [How to Monitor BullMQ with Bull Board (OneUptime, Jan 2026)](https://oneuptime.com/blog/post/2026-01-21-bullmq-bull-board/view)
- [Trace Errors Through Your Stack Using Unique Identifiers (Sentry blog)](https://blog.sentry.io/trace-errors-through-stack-using-unique-identifiers-in-sentry/)
- [Event Data: Enriching Data in Sentry (Sentry docs)](https://docs.sentry.io/concepts/key-terms/enrich-data/)
- [How to Correlate Sentry Error Events with OpenTelemetry Distributed Traces (OneUptime, Feb 2026)](https://oneuptime.com/blog/post/2026-02-06-correlate-sentry-errors-with-otel-distributed-traces/view)
- [How to Manage Metric Cardinality in Prometheus (OneUptime, Jan 2026)](https://oneuptime.com/blog/post/2026-01-25-prometheus-metric-cardinality/view)
- [How to manage high cardinality metrics (Grafana Labs)](https://grafana.com/blog/how-to-manage-high-cardinality-metrics-in-prometheus-and-kubernetes/)
- [W3C Trace Context specification (w3.org)](https://www.w3.org/TR/trace-context/)
- [OpenTelemetry Context Propagation (opentelemetry.io)](https://opentelemetry.io/docs/concepts/context-propagation/)
- [W3C Trace Context Explained: Traceparent & Tracestate (Dash0)](https://www.dash0.com/knowledge/w3c-trace-context-traceparent-tracestate)
- [Contextual Logging Done Right in Node.js with AsyncLocalStorage (Dash0)](https://www.dash0.com/guides/contextual-logging-in-nodejs)
- [Logging with Pino and AsyncLocalStorage in Node.js (LogRocket)](https://blog.logrocket.com/logging-with-pino-and-asynclocalstorage-in-node-js/)
- [AsyncLocalStorage for API Context in Node.js (1xAPI, 2026)](https://1xapi.com/blog/node-asynclocalstorage-request-context-2026)
- [Incident Response Runbook Template for DevOps (Medium, Jan 2026)](https://medium.com/@sajjasudhakarrao/incident-response-runbook-template-for-devops-a-calm-workflow-that-reduces-mttr-e6f44e26398c)
- [Incident Response Runbook: Best Practices (UptimeLabs)](https://uptimelabs.io/learn/what-is-an-incident-response-runbook/)
- [Runbook Example: A Best Practices Guide (Nobl9)](https://www.nobl9.com/it-incident-management/runbook-example)
- [How to Set Up a Complete Docker Compose Observability Stack (OneUptime, Feb 2026)](https://oneuptime.com/blog/post/2026-02-06-docker-compose-observability-stack/view)
- [Observability Stack: Prometheus, Grafana, and Loki Setup (dasroot.net, Apr 2026)](https://dasroot.net/posts/2026/04/observability-stack-prometheus-grafana-loki/)
- [Quickstart: Grafana Tempo (Grafana docs)](https://grafana.com/docs/tempo/latest/docker-example/)
- `.planning/PROJECT.md` (v1.3 Active section) — milestone scope, adapter matrix, constraints
- `CLAUDE.md` — tech stack constraints (Bun, BullMQ, pino, postgres.js)

---

*Feature research for: v1.3 Observability & Operations (subsequent milestone on existing Baseworks monorepo)*
*Researched: 2026-04-21*
