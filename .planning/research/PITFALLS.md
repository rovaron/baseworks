# Pitfalls Research — v1.3 Observability & Operations

**Domain:** Production observability for a Bun + Elysia + BullMQ + Drizzle + PostgreSQL + Redis SaaS stack
**Researched:** 2026-04-21
**Confidence:** MEDIUM-HIGH (OTEL/Sentry docs and recent 2026 guides verified; Bun-specific nuances cross-checked against upstream issues; no past incident data — guidance is forward-looking)

This document catalogues the pitfalls most likely to bite v1.3 given the existing Baseworks stack. Every pitfall is mapped to an expected v1.3 phase (see `Pitfall-to-Phase Mapping` at the end) and includes an actionable pattern or checklist — not "be careful."

## Critical Pitfalls

### Pitfall 1: OTEL SDK init ordering — required modules loaded before tracer provider registers

**What goes wrong:**
`@opentelemetry/auto-instrumentations-node` patches modules at import time. If `pg`, `ioredis`, `http`, `drizzle`, `bullmq`, or `pino` are imported anywhere (even transitively through `packages/shared`) before `NodeSDK.start()` runs, those modules are already bound to their un-patched implementations and will never emit spans. On Bun the usual `--require` / `NODE_OPTIONS` preload trick does not work the same way as Node.js, which makes this failure mode far more common than on Node.

**Why it happens:**
- Bun does not honour `NODE_OPTIONS="--require ./telemetry.ts"` the way Node.js does; developers copy Node OTEL setup guides 1:1 and see zero spans.
- Elysia entrypoints usually import the module registry at the very top — the registry transitively imports Drizzle and BullMQ before any telemetry code runs.
- Tests pass because test fixtures often bypass HTTP/DB instrumentation entirely.

**How to avoid:**
- Create a dedicated `apps/api/src/telemetry.ts` and `apps/worker/src/telemetry.ts` that call `sdk.start()` synchronously.
- Make it the **first** import in `apps/api/src/index.ts` and `apps/worker/src/index.ts` — before the module registry, before `@baseworks/shared`, before anything.
- Pattern:
  ```ts
  // index.ts — line 1, no exceptions
  import "./telemetry";          // must be first
  import { app } from "./app";   // everything else after
  ```
- Add a startup self-test: emit a synthetic span + outbound HTTP call during boot; log `otel-selftest: ok` with the resulting trace ID. If the trace does not show in the backend, the deploy is broken.
- Disable `@opentelemetry/instrumentation-fs` explicitly — it is the single most common source of noise and hangs on Bun.

**Warning signs:**
- Spans exist for outbound fetch but none for DB queries or BullMQ.
- `pino` logs show no `trace_id` / `span_id` fields even when a request is clearly in flight.
- Bun startup logs show OTEL messages *after* "api listening on :3000".

**Phase to address:** Phase 1 (MetricsProvider + Tracer port + OTEL adapter bootstrap).

---

### Pitfall 2: BullMQ trace context not injected — every worker span is an orphan

**What goes wrong:**
Auto-instrumentations for HTTP/Drizzle create spans on the API side, but when the API calls `queue.add(...)` and the worker picks up the job, the worker either (a) has no parent context and creates a brand-new trace, or (b) attaches to a stale trace from a previous job on the same worker. Result: every async pipeline appears as two disconnected traces, defeating the main distributed-tracing goal of the milestone.

**Why it happens:**
BullMQ is not in the default `@opentelemetry/auto-instrumentations-node` bundle. The community adapter `@appsignal/opentelemetry-instrumentation-bullmq` exists but is not universally adopted, and "everyone writes their own" is common. Developers forget that unlike HTTP, the queue has no headers — traceparent must be explicitly serialized into job data.

**How to avoid:**
- Pick one approach and stick with it:
  - **Preferred:** use `@appsignal/opentelemetry-instrumentation-bullmq` if it works under Bun (test on Bun 1.1+ explicitly in Phase 1).
  - **Fallback:** hand-written propagation via the W3C propagator:
    ```ts
    // producer
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    await queue.add(name, { ...payload, _otel: carrier });

    // consumer (worker)
    const parentCtx = propagation.extract(context.active(), job.data._otel ?? {});
    await context.with(parentCtx, async () => {
      const span = tracer.startSpan(`job ${job.name}`, { kind: SpanKind.CONSUMER });
      // ... process
    });
    ```
- Bake this into a single `enqueue()` helper and a single `processJob()` wrapper in `packages/shared/queue`. No module should import `queue.add` directly.
- Add a `job.traceparent` field to the correlation-ID helper so pino log lines from the worker also carry the producer's trace ID.
- Verify with a literal test: enqueue a job from an HTTP handler, assert that the worker span's `trace_id` equals the API request's `trace_id`.

**Warning signs:**
- Trace backend shows "Producer" spans with no corresponding "Consumer" children.
- Worker logs contain a `trace_id` but it differs from the originating request.
- CQRS dispatch shows a span but its downstream job is on a new trace.

**Phase to address:** Phase 2 (Distributed tracing + BullMQ context propagation + AsyncLocalStorage correlation).

---

### Pitfall 3: AsyncLocalStorage leaking context across requests and into jobs

**What goes wrong:**
Two failure modes, both frequently observed when adding ALS to an existing server:
1. **Context bleed:** developer calls `als.enterWith(ctx)` instead of `als.run(ctx, fn)` at request entry — the context is set on the current async task and is inherited by *every* subsequent async operation scheduled on the event loop, including the next request that reuses the same task. Symptom: tenant A sees tenant B's data in logs, or worse, in queries if tenantId is pulled from ALS.
2. **Worker reuse:** BullMQ workers process many jobs on the same long-lived Node/Bun process. If the worker wrapper uses `enterWith` or forgets to scope ALS per-job, job N+1 inherits correlation IDs from job N.

Bun's ALS implementation also historically had O(n²) cloning behaviour in debug builds (release builds are fine, per upstream #24324), which can masquerade as "the observability stack made prod slow."

**Why it happens:**
- `enterWith` is documented as a convenience but is almost never what you want in a server context.
- Developers copy middleware from Express/Koa tutorials that predate clean ALS patterns.
- Tests run sequentially, so leaks never reproduce locally.

**How to avoid:**
- **Rule:** only `als.run(ctx, fn)` is allowed in this codebase. Add a Biome lint rule or grep-based phase-close check forbidding `AsyncLocalStorage#enterWith`.
- Wrap every Elysia request in exactly one `als.run({ requestId, tenantId, userId, traceparent }, next)` at the outermost middleware.
- Wrap every BullMQ processor with a `withJobContext(job, fn)` helper that does `als.run({ jobId, queueName, traceparent: job.data._otel }, fn)`.
- Do **not** store large objects in ALS (no full request, no DB client). Store IDs only. Anything heavier is a retention risk and inflates per-hop clone cost.
- Benchmark ALS on vs off in Phase 2; accept up to ~5–10 % throughput cost but treat anything over 15 % as a bug.

**Warning signs:**
- Log lines for one tenant carry another tenant's `tenant_id` under load.
- Job logs show the `requestId` of a recently completed request.
- p99 latency climbs steeply after enabling tracing (suggests ALS misuse, not OTEL itself).

**Phase to address:** Phase 2 (AsyncLocalStorage correlation carrier).

---

### Pitfall 4: High-cardinality metric labels — `user_id` / `tenant_id` / URL path as metric dimensions

**What goes wrong:**
Adding `user_id` as a metric label for 1M users produces 1M time series per metric; combined with `status_code` and `route` the cardinality becomes billions. Prometheus blows its memory budget; Grafana Cloud-style managed backends will bill or throttle; the collector OOMs. This is the #1 source of "we had to tear out OTEL" post-mortems.

**Why it happens:**
- OTEL makes labelling easy (any attribute on a counter becomes a dimension).
- Auto-instrumentation for HTTP includes raw URL path by default — `/api/users/:id` is emitted as `/api/users/9f4e...` producing one series per user seen.
- "We'll need per-user metrics for debugging" — no, you need per-user *traces* and *logs*. That is what they are for.

**How to avoid:**
- Hard rule — these go on **spans/logs**, not metrics:
  - `user.id`, `tenant.id` (if tenant count > ~200), `request.id`, `job.id`, email, any UUID, raw URL path, any free text.
- These are safe metric labels (bounded cardinality):
  - `route.template` (`/api/users/:id`, not the concrete path), `http.method`, `http.status_class` (2xx/4xx/5xx), `module`, `queue.name`, `job.name`, `error.type` (bounded enum), `tenant.plan` (free/pro/enterprise — bounded).
- Configure an OTEL `View` with an `AttributeSelector` that drops the dangerous attributes from histograms/counters at SDK level:
  ```ts
  new View({
    instrumentName: "http.server.duration",
    attributeKeys: ["http.route", "http.method", "http.status_class"],
  });
  ```
- Set an explicit cardinality limit (default 2000) per metric and alert on "cardinality limit reached" events — that is the early warning.
- In the collector, add a `transform` or `filter` processor that drops any attribute matching UUID regex before export to Prometheus.

**Warning signs:**
- Prometheus memory usage growing 5–10 % per day with no traffic change.
- `up{}` series count for the API increasing monotonically.
- Grafana queries timing out on dashboards they used to render instantly.

**Phase to address:** Phase 1 (MetricsProvider port) and Phase 6 (local Grafana stack — verify collector filters).

---

### Pitfall 5: Sampling configured to lose the traces you actually need

**What goes wrong:**
Three common misconfigurations:
1. **100 % head sampling in prod** — storage cost explodes, Tempo/backends throttle, dashboards slow to a crawl.
2. **1 % head sampling in prod** — you drop the 1 error trace per 100 before knowing it was an error; incident triage becomes impossible because you have a stack trace in Sentry but no corresponding distributed trace in Tempo.
3. **Tail sampling misconfigured** — `num_traces` too low (collector drops mid-trace), wait time too short (long requests get fragmented), or spans for one trace spread across multiple collector replicas without a load-balancing exporter in front.

**Why it happens:**
- Defaults in quickstart docs are "keep everything" (good for demos, bad for prod).
- Tail sampling requires a two-tier collector topology that isn't obvious from single-node examples.
- Dev uses 100 % sampling; prod switchover is "we'll tune it later" and never happens.

**How to avoid:**
- Ship with this default policy, not "100 %":
  - Head sampling: 10 % of normal traffic, **parent-based** so downstream decisions match.
  - Tail sampling in the collector with explicit policies:
    - `always_sample` for `status.code == ERROR` or `http.status_code >= 500`
    - `always_sample` for `duration > 1s`
    - `probabilistic` 10 % otherwise
  - `num_traces: 50000`, `decision_wait: 10s` as starting values (tune after one week of traffic).
- If using multiple collector replicas, put a `loadbalancingexporter` in front that hashes on `trace_id`. Document this explicitly in the runbook.
- Dev defaults: keep 100 % sampling (no volume concerns) but use the same processor pipeline so configs don't diverge between dev and prod.

**Warning signs:**
- Sentry shows 10 errors/minute but Tempo shows 0 error traces.
- Trace search returns partial traces missing the DB spans.
- Collector logs warn `dropping trace: num_traces limit reached`.

**Phase to address:** Phase 2 (tracing) and Phase 6 (docker-compose observability — ensure the shipped config is production-like).

---

### Pitfall 6: Sentry / GlitchTip PII leaks — default scrubbers don't cover your data

**What goes wrong:**
Default Sentry scrubbers catch things named `password`, `authorization`, `cookie`, `csrf` and similar. They do **not** catch: Stripe/Pagar.me webhook payloads (full customer data), better-auth session tokens in JSON bodies, spoofed `X-Tenant-Id` headers, raw error messages built via `` `failed for user ${email}` `` (email ends up in the title, bypassing body scrubbing), or custom headers. Once a PII payload lands in Sentry cloud, "deleting" it is a support ticket not a code change.

**Why it happens:**
- Sentry's `sendDefaultPii: true` is enticing because debugging is easier.
- Developers assume "it has a scrubber, I'm fine."
- PII sneaks in via `breadcrumbs` (the request body capture of the failing HTTP call) rather than the error itself.
- Team members add new fields over time; the denylist was written once and not revisited.

**How to avoid:**
- Set `sendDefaultPii: false` hard-coded.
- Write a `beforeSend` (and `beforeBreadcrumb`) hook that:
  1. Redacts well-known fields by key (`password`, `token`, `authorization`, `stripeCustomerId`, `sessionId`, `email`, `cpf`, `cnpj` — add Brazilian PII for Pagar.me).
  2. Drops the entire event if `error.message` matches a known PII pattern (email regex, SSN/CPF regex).
  3. Strips `request.data` for routes matching `/api/webhooks/**` (never send webhook bodies to Sentry).
- Configure server-side scrubbing in Sentry/GlitchTip project settings **in addition** to SDK scrubbing — defence in depth.
- Add a conformance test for the `ErrorTracker` port: feed each adapter a payload with a dozen known PII shapes, assert the emitted event has them redacted.
- Never put user input into the Sentry `message` or `fingerprint` — use tags or extras (which are scrubbable).

**Warning signs:**
- Sentry issue titles containing `@` characters, long hex strings, or customer names.
- Breadcrumb request bodies visible in a sample of issues.
- Issues with 100 % unique fingerprints (usually means user input in the message).

**Phase to address:** Phase 1 (ErrorTracker port + adapters).

---

### Pitfall 7: pino ↔ OTEL log correlation only half-wired

**What goes wrong:**
Two variants:
1. `@opentelemetry/instrumentation-pino` not installed — logs have no `trace_id`, breaking the main "click trace → see logs" UX.
2. Instrumentation installed but the request-scoped logger is a `pino.child()` created **before** OTEL starts the request span, so it captures the context at child-creation time (none) and never updates.

**Why it happens:**
- The existing codebase already has `pino` with request tracing (v1.0). Layering OTEL on top requires refactoring how child loggers are created.
- `instrumentation-pino` supports pino >=5.14 <11 and only supports "log sending" in pino v7+. Version pinning matters.
- On Bun, `instrumentation-pino` works but only if OTEL is initialized before pino — see Pitfall 1.

**How to avoid:**
- Install `@opentelemetry/instrumentation-pino` and register it in the auto-instrumentations array.
- Do **not** create long-lived child loggers with captured context. Use `logger.info({ ...als.getStore() }, "msg")`, or create the child **inside** the `als.run` scope.
- Add a smoke test: hit an endpoint, grep the resulting log line for `trace_id`; fail CI if missing.
- Align the log field names with what the backend expects (Grafana Loki / OTEL semantic conventions): `trace_id`, `span_id`, `trace_flags`.
- For the `Pino-sink` `ErrorTracker` adapter (the noop fallback for local dev), ensure it writes structured fields including the trace context so local debugging still benefits from correlation.

**Warning signs:**
- Log lines have no `trace_id` but traces clearly exist in Tempo.
- Some log lines have `trace_id`, others don't, for the same request.
- Worker job logs missing the producer's `trace_id`.

**Phase to address:** Phase 2 (tracing + correlation upgrade).

---

### Pitfall 8: bull-board shipped without auth, with destructive actions enabled

**What goes wrong:**
bull-board exposes a UI with buttons for `remove`, `retry`, `promote`, and `clean` (remove all jobs in a state). Mounted under the admin dashboard, it is often behind "just the same login" — but:
- bull-board has no CSRF protection on its mutation endpoints by default.
- It exposes job **data**, which frequently contains PII (email payloads, webhook bodies).
- The admin SPA uses cookie-based session auth; a malicious tab could trigger `remove-all` via a forged form submission.
- In monorepos, it often ends up mounted on the **API** origin rather than the admin origin, bypassing any admin-specific auth checks.

**Why it happens:**
- README examples show zero-auth mounting (`app.use("/admin/queues", serverAdapter.getRouter())`) and it "just works."
- Express-level basic auth is a common retrofit but interacts poorly with better-auth sessions.
- Developers treat it as "internal tooling" and apply no threat model.

**How to avoid:**
- Mount bull-board only on the admin dashboard origin, never the public API origin.
- Guard it with the same better-auth session middleware used by the admin app, plus an explicit role check: `requireRole('platform_admin')` (NOT just tenant admin — bull-board shows ALL tenants' jobs).
- Mount it read-only by default. Destructive actions (`remove`, `clean`, `empty`) require either:
  - A separate `platform_superadmin` role, or
  - An additional confirmation step wired through the admin app (not bull-board's native UI).
- Add CSRF protection: either set `SameSite=Strict` on the admin session cookie, or front bull-board with an Elysia route that requires a CSRF header before proxying.
- Scrub job data before display: wrap `Queue.getJob` to redact `data.password`, `data.token`, webhook bodies. bull-board pulls straight from Redis; the only scrubbing point is before it leaves the server.
- Log every bull-board mutation with actor + target job ID + action — this is audit-log-worthy.

**Warning signs:**
- `/admin/queues` loads without hitting an auth check.
- bull-board URL works from a different origin (CORS misconfig).
- Job payloads visible in the UI contain plaintext emails/tokens.

**Phase to address:** Phase 3 (bull-board embed + RBAC-gated admin job monitor).

---

### Pitfall 9: Auto-instrumentation of DB drivers doubles latency in hot paths

**What goes wrong:**
`@opentelemetry/instrumentation-pg` wraps every query to create a span. For a high-QPS endpoint making 5–20 DB calls per request, span creation + context switching can add 20–40 % latency. `instrumentation-ioredis` has similar properties for session lookups on every request. On Bun specifically, some instrumentations use Node's `async_hooks` which are already slightly slower under Bun than native Node.

**Why it happens:**
- `@opentelemetry/auto-instrumentations-node` turns everything on by default.
- Developers don't measure before/after.
- "All-the-spans" is the default mental model; "only spans you'll look at" is not.

**How to avoid:**
- Enable the full auto-instrumentation bundle in staging. Benchmark the top 5 endpoints (p50, p95, p99) with instrumentation on vs off. Record the delta in `.planning/PROJECT.md` as a decision artefact.
- In prod, disable these explicitly unless they pull their weight:
  - `instrumentation-fs` (always disable — noise, infinite spans).
  - `instrumentation-dns` (rarely useful, high volume).
  - `instrumentation-net` (covered by higher-level HTTP spans).
- For very hot paths, use manual spans at the handler boundary only, skip the DB-level spans, and rely on DB metrics (query count, query duration histogram by template) rather than per-query spans.
- For the `better-auth` session lookup path (every request), consider short-TTL in-process caching so not every request hits Redis — this removes a hot path from instrumentation entirely.

**Warning signs:**
- p99 regresses after enabling OTEL.
- Worker throughput drops measurably with OTEL on.
- CPU profile shows significant time in `@opentelemetry/context-async-hooks`.

**Phase to address:** Phase 2 (tracing rollout — include perf budget) and Phase 7 (health dashboard — expose p99 latency regression as an alert).

---

### Pitfall 10: Multi-tenant observability — wrong dimensional model

**What goes wrong:**
Three sub-mistakes specific to Baseworks' shared-DB multitenancy model:
1. `tenant.id` stored as an OTEL **resource attribute** (set once at process start) — it's the same across all tenants served by the process, so it ends up as an empty or misleading field.
2. `tenant.id` stored as a **metric label** with thousands of tenants — cardinality explosion (see Pitfall 4).
3. Tracing inadvertently captures user data (emails, names) as span attributes, making the trace store itself GDPR-covered PII storage (and LGPD, given Pagar.me → Brazil users).

**How to avoid:**
- Dimensional model:
  - **Spans / logs:** `tenant.id` and `user.id` are span attributes and log fields. Useful for filtering, scoped by trace retention (typically 7–14 days).
  - **Metrics:** NEVER `user.id`. `tenant.id` only if bounded (< 200 tenants), otherwise use `tenant.plan` or `tenant.tier` as a proxy.
  - **Resource attributes:** only `service.name`, `service.version`, `deployment.environment`, `host.name`. Nothing tenant-scoped.
- Publish a one-pager "what attributes go where" doc in `docs/runbooks/observability-attributes.md`. Reference it in code review.
- For GDPR/LGPD: set tracer retention to <= 14 days by default in docker-compose.observability.yml; document that production retention must align with the privacy policy. Use OTEL processors to redact PII attribute keys (`user.email`, `user.name`) before export — keep only IDs.
- If a tenant requests data deletion under GDPR/LGPD Article 17, document the procedure to purge their trace/log data (typically: rely on retention + log a record of the request). Putting this in a runbook before the first request is far cheaper than post-hoc.

**Warning signs:**
- Grafana queries with `tenant_id=` in a metric predicate timing out.
- Traces containing user email addresses.
- Inability to answer a GDPR erasure request because traces retain identifiable data.

**Phase to address:** Phase 2 (tracing attributes model) and Phase 5 (runbooks — privacy/retention policy).

---

### Pitfall 11: Alert fatigue — noisy alerts from deploy rollouts, slow startup, and symptom-based rules

**What goes wrong:**
Initial alert templates typically fire on:
- `error_rate > 1 %` during a rolling deploy when new pods haven't warmed up.
- `p99_latency > 500ms` during the first 60 s after a pod comes up (cold caches).
- `queue_depth > 100` when a legitimate batch job kicks off.
- Every 5xx individually (should be aggregated).

Result: within a week, on-call silences the alerts wholesale, and the *real* outage comes with the alert already in "snoozed" state.

**Why it happens:**
- Default Grafana alert rules in community templates are optimized for "it alerts" not "it alerts usefully."
- Nobody tunes for deploy noise because nobody runs a deploy before shipping the alerts.
- Symptom-based alerting ("latency high") instead of cause-based ("downstream DB saturating") produces duplicates — DB saturation fires the DB alert, the API latency alert, the error-rate alert, and the queue-depth alert simultaneously.

**How to avoid:**
- SLO-based alerting from day one. Define one SLO per user-facing journey (login, create tenant, checkout) with a target (e.g., "99 % of login requests succeed within 500 ms over 30 days"). Alert on **burn rate** (fast burn: 2 % budget in 1 h → page; slow burn: 10 % in 6 h → ticket), not raw metrics.
- Every alert rule MUST have:
  - A runbook link in its description (`runbook_url` annotation).
  - A `for: 5m` (or more) window to avoid transient noise.
  - An owner (team or person).
- Deploy-aware: gate alerts on `deployment.environment == "prod" AND time_since_deploy > 10m`.
- Track two second-order metrics:
  - Alert precision (fraction of alerts that led to action). Target > 70 %.
  - Mean time to acknowledge. If > 30 min consistently, the alert is not actually urgent and should be a ticket.
- Ship **fewer** templates, not more. 8 well-tuned alerts beat 40 noisy ones.

**Warning signs:**
- Slack alert channel has muted notifications.
- On-call runbook says "usually safe to ignore."
- The same alert fires every deploy.

**Phase to address:** Phase 5 (runbooks + alert playbook templates).

---

### Pitfall 12: Source maps / release tracking missing — stack traces unreadable

**What goes wrong:**
Bun compiles TS natively but production deploys typically use `bun build --minify` or ship Next.js bundles. Without source maps uploaded to Sentry/GlitchTip, every prod error looks like `at a (main.min.js:1:48273)`. The error tracker is effectively useless for the thing it exists for.

**Why it happens:**
- Source map upload is an extra CI step that's easy to skip.
- Debug IDs (new-style) require sentry-cli >2.17 or JS bundler plugin >2.0; older tutorials use the legacy `release` + `dist` matching which is fragile.
- Release/version association is forgotten — issues don't link to commits, regressions can't be pinned to a deploy.

**How to avoid:**
- CI step (non-negotiable in `packages/release-ci`):
  1. Build with source maps enabled (`bun build --sourcemap=external`, Next.js `productionBrowserSourceMaps: true` for the customer app, keep them server-side for the admin).
  2. Upload via `sentry-cli sourcemaps upload` (Debug ID variant) for all three apps (api, worker, admin) and the Next.js app.
  3. Do **not** publish source maps with the built app. Upload to Sentry only.
- Set `release` to the git SHA in SDK init (`Sentry.init({ release: process.env.GIT_SHA })`) so every issue ties to a commit.
- Verify post-deploy: hit a known-failing test endpoint, confirm the issue in Sentry has demangled frames before calling the deploy done.
- Do not use `source-map-support` — it rewrites stack traces in a way that breaks Sentry's mapper.
- For GlitchTip: same flow works (Sentry SDK-compatible) but test specifically; GlitchTip 6 improved source map reliability but has had historical redirect-following bugs. Add the assertion to CI.

**Warning signs:**
- Sentry issues have frames pointing to files named `index-abc123.js`.
- No "Release" sidebar in Sentry issues.
- Regressions can't be traced to a specific deploy.

**Phase to address:** Phase 1 (ErrorTracker) + Phase 6 (release CI wiring, possibly rolled into existing deploy flow).

---

### Pitfall 13: docker-compose.observability.yml eats the dev laptop

**What goes wrong:**
Running Grafana + Prometheus + Tempo + Loki + OTEL Collector locally alongside Postgres + Redis + API + worker + admin + Next.js can push RAM past 4 GB, cause slow startups, and create port conflicts with existing dev containers (9090 for Prometheus collides with alternate services; 3000 is classic Grafana/Next.js collision). Developers then run `docker-compose down` on the observability stack "just while I work" and forget to turn it back on.

**Why it happens:**
- Quickstart compose files set no memory limits.
- Loki and Tempo have default ingester configs tuned for prod, not dev (heavy WAL, aggressive retention).
- Port defaults collide with Next.js 3000, Vite 5173, Grafana 3000 — overlap is immediate.

**How to avoid:**
- Dev-tuned compose file, not the quickstart:
  - `mem_limit` per service (Grafana 256 MB, Prometheus 256 MB, Tempo 512 MB, Loki 256 MB, OTEL Collector 128 MB).
  - Remap Grafana to 3030 (not 3000 — it collides with Next.js).
  - Shorten retention: `retention_period: 24h` for Loki, `block_retention: 24h` for Tempo.
  - Use single-binary / monolithic mode for Loki + Tempo (not microservices mode).
  - Explicit volume names so `docker volume prune` doesn't wipe yesterday's traces.
- Make it opt-in, not default: separate `docker-compose.yml` (always-on — Postgres + Redis) and `docker-compose.observability.yml` (on-demand — full o11y stack). Developers start the o11y stack only when debugging o11y itself.
- Document expected RAM footprint up-front (~1.5 GB total for o11y stack) so nobody is surprised.
- Provide a `bun run observability:up` / `:down` script — lower friction than remembering compose flags.

**Warning signs:**
- `docker stats` shows o11y containers using > 2 GB combined.
- Dev reports "my machine got slow after v1.3 setup."
- Port conflict errors on compose up.
- Developers silently stop using the stack.

**Phase to address:** Phase 6 (local dev observability stack).

---

## Moderate Pitfalls

### Pitfall 14: GlitchTip / Sentry-compatible backends drift from Sentry SDK

**What goes wrong:**
GlitchTip aims to be Sentry API compatible, but the Sentry SDK ships new envelope features (profiling, session replay, attachments, Span V2, performance monitoring changes) continuously. A feature works under Sentry and silently no-ops (or errors) under GlitchTip, breaking the adapter parity promised by the port. Source map upload has also historically had redirect-follow bugs under GlitchTip.

**How to avoid:**
- Treat the Sentry-feature surface as a **subset**, not the union. The `ErrorTracker` port should expose only features both backends support: capture exception, capture message, add breadcrumb, set user, set tag, set extra, scrub. Do NOT expose profiling, session replay, or performance monitoring through the port.
- Conformance test suite (shared across adapters): emit N well-known error shapes, verify they land in both backends with identical redactions, fingerprints, and tags.
- Pin the Sentry SDK to a version GlitchTip's release notes explicitly say they support. Re-verify at every GlitchTip major release.
- In runbooks, label each feature with its adapter support matrix.

**Phase to address:** Phase 1 (ErrorTracker port design + adapter parity tests).

---

### Pitfall 15: Runbook decay — docs go stale after first draft

**What goes wrong:**
Runbooks committed on day one are accurate; six months later, half the commands reference deprecated scripts and the alert descriptions point to deleted dashboards. On-call relies on them, finds them wrong, stops trusting them, reverts to tribal knowledge.

**How to avoid:**
- Every alert has a `runbook_url` pointing to a specific `docs/runbooks/<alert-slug>.md` file — not a wiki, not Notion, in-repo.
- Post-incident template enforces a "runbook delta": what did the runbook miss? Add it now. Without this, runbooks drift monotonically.
- Quarterly runbook drill: pick 3 random runbooks, have someone other than the author follow them against staging, record failures.
- Embed runbook links in alert descriptions such that broken links break alert tests in CI.
- Keep runbooks short — a stale 200-line runbook is worse than a stale 20-line one. Structure: symptoms → first checks → escalation.

**Phase to address:** Phase 5 (runbooks). Make the review cadence part of the deliverable, not an afterthought.

---

### Pitfall 16: Health dashboard shows everything green while the product is broken

**What goes wrong:**
Health endpoints check "can I connect to the DB?" and "is Redis alive?" — both return OK while a bad migration means every `SELECT` fails, or Redis is alive but OOM-evicting sessions causing random logouts. Synthetic smoke tests of real user journeys would catch these; pure-infra health checks will not.

**How to avoid:**
- Tiered health checks:
  - `/health/live`: only "is the process alive?" — used by Kubernetes/Docker liveness probe, must be fast.
  - `/health/ready`: dependencies reachable — used for load balancer readiness.
  - `/health/deep`: runs a canary query (`SELECT 1 FROM tenants LIMIT 1`), a canary Redis GET, a BullMQ queue ping. Called by an external synthetic monitor, not the LB.
- Synthetic journey tests (can be as simple as 3 BullMQ jobs scheduled every minute): login → create tenant → enqueue an email. Each step reports a Prometheus gauge. This is your real SLO signal.
- Display the synthetic results on the admin health dashboard next to infra checks — never only one or the other.

**Phase to address:** Phase 4 (health dashboard upgrade).

---

### Pitfall 17: Metrics collected but never reviewed — dead telemetry

**What goes wrong:**
Adding 200 metrics is easy. Reviewing which of them actually changed behaviour after an alert is hard. Over months, 80 % of metrics become noise; they still cost storage and query time but nobody looks.

**How to avoid:**
- Ship v1.3 with a small, curated set: ~15–20 metrics (not 200). Each metric must have either an alert or a dashboard panel pointing at it. Unused metrics are deleted, not kept "just in case."
- Use OTEL semantic conventions (`http.server.duration`, `db.client.connections.usage`, etc.) rather than bespoke names — makes it easier to swap backends and aligns with community tooling.
- Every metric defined in code must have a code comment linking to the dashboard/alert that consumes it.

**Phase to address:** Phase 1 (MetricsProvider) and Phase 7 (dashboards).

---

## Minor Pitfalls

### Pitfall 18: Instrumentation noise — fs, dns, net spans drowning useful traces

Disable `@opentelemetry/instrumentation-fs`, `-dns`, `-net` by default. They rarely help and frequently hide the traces you actually want. Re-enable per-case if a specific investigation needs them.

**Phase to address:** Phase 1.

---

### Pitfall 19: Forgetting to pass through CORS for the OTEL Collector endpoint

If the customer Next.js app (browser) ever sends telemetry directly (not recommended initially — backend-only is simpler), the OTEL Collector needs CORS configured. Symptom: silent zero traces from the browser.

**Phase to address:** Defer to Phase 6 only if browser telemetry is in scope; otherwise skip.

---

### Pitfall 20: BullMQ job data size bloat from tracing

Injecting the full traceparent/tracestate carrier into every job's data inflates Redis memory, especially if jobs are queued in bulk. Keep the carrier to the minimum W3C fields (`traceparent`, optional `tracestate`). Do not inject all baggage.

**Phase to address:** Phase 2.

---

### Pitfall 21: Sentry's automatic request body capture in Elysia

When `sendDefaultPii` is true or the Elysia/Node integration captures request bodies, POST/PUT payloads land in breadcrumbs verbatim. Webhooks (Stripe, Pagar.me, better-auth callbacks) will leak. Turn off automatic body capture; capture selectively via middleware with explicit scrubbing.

**Phase to address:** Phase 1.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip source map upload initially | Faster deploy, one less CI step | Every prod error is unreadable; regressions can't be diagnosed | Never — wire it into Phase 1 or Phase 6 |
| Head sampling at 100 % "for now" | No tuning work | Storage cost blows up in first real traffic spike; panic un-tuning mid-incident | Dev only; prod must ship with a real policy |
| `user.id` as a metric label (temporarily) | Easy per-user dashboards during debug | Cardinality explosion within weeks; expensive backfill to remove | Never for unbounded user sets |
| Single shared Sentry project for API + worker + admin + web | One DSN, one dashboard | Impossible to tune alerts per service; noise from one masks another | Only if < 50 errors/day total; split before volume grows |
| bull-board mounted with "internal network only" security | Zero auth wiring | SSRF, insider threat, misconfigured reverse proxy exposes it | Never — always require session + role check |
| One giant runbook "operations.md" | Easy to find things initially | Decays wholesale, no owner per section, hard to link from alerts | Never — split per alert/scenario from the start |
| Capture everything in Sentry, filter later server-side | Don't miss anything | PII leakage, paid ingestion quota burned on noise | Never — filter in SDK first |
| `AsyncLocalStorage.enterWith` instead of `.run` | Simpler call sites | Cross-request context bleed under load | Never in a server; OK in short-lived scripts |

## Integration Gotchas

Specific to this stack's external integrations.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Bun + OTEL SDK | Using `NODE_OPTIONS=--require ./telemetry.ts` (doesn't work on Bun) | Import `./telemetry.ts` as line 1 of the entrypoint |
| Bun + `instrumentation-fs` | Leaving enabled — hangs or spams on Bun | Disable explicitly in the instrumentations array |
| BullMQ + OTEL | Assuming auto-instrumentations cover it | Install `@appsignal/opentelemetry-instrumentation-bullmq` or hand-wire propagation |
| pino + OTEL | Child loggers created before the span | Install `@opentelemetry/instrumentation-pino`; pull context at log time, not child creation |
| better-auth + OTEL | Session lookup creates a span on every request (hot path) | Cache the session briefly in ALS; instrument only auth failures, not lookups |
| Drizzle + OTEL | Expecting spans to show actual SQL | Depends on driver instrumentation (`instrumentation-pg` via postgres.js); verify spans include `db.statement` and bind params are scrubbed |
| Stripe / Pagar.me webhooks + Sentry | Request body captured by default — full customer record leaks | Exclude webhook routes from request-body capture; redact in `beforeBreadcrumb` |
| Elysia + bull-board | Mounting bull-board as an Elysia route using its Express adapter | Use `@bull-board/elysia` if available; otherwise run bull-board behind the admin Vite app via Express sub-app with explicit session verification |
| GlitchTip + Sentry SDK v9+ | Using new envelope features (replay, profiling) that GlitchTip doesn't yet ingest | Stick to error + message + breadcrumb; defer advanced features |
| Grafana + Tempo | Running Tempo in microservices mode for dev | Use monolithic mode (single binary) for dev-compose |
| Prometheus + OTEL | Assuming OTLP metrics work natively | Use the OTEL Collector with `prometheusremotewrite` exporter, or Prometheus' native OTLP receiver (Prometheus 2.47+) |
| Next.js + Sentry | SSR errors double-reported (server SDK + client SDK both capture) | Use the official `@sentry/nextjs` integration which deduplicates; do NOT hand-wire both sides |

## Performance Traps

Patterns that work locally but break in production.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Auto-instrumentation on every module | 20–40 % p99 latency regression on hot paths | Disable fs/dns/net; benchmark before/after in staging | Any endpoint > 100 RPS |
| High-cardinality metric labels (user.id) | Prometheus OOM, slow dashboards | Views + collector filters + cardinality limits | > 10k unique label values |
| 100 % head sampling | Storage cost, backend throttling | Parent-based + tail sampling with error preservation | > 10 RPS sustained |
| Large payloads in span attributes | Per-span size > 64 KB triggers dropping | Attribute value length limit (default 128 chars) | Any span that attaches full request body |
| ALS with large objects stored | Per-request clone cost, GC pressure | Store only IDs in ALS; fetch details on demand | > 50 RPS with complex contexts |
| Synchronous Sentry capture in hot path | Error capture blocks the event loop | Use async `captureException`; never `await Sentry.close()` on the hot path | Any burst of errors during an incident |
| Unbounded job data for tracing | Redis memory growth, slow job enqueues | Inject only traceparent + tracestate (minimal W3C fields), not full baggage | > 1k jobs/minute |
| bull-board rendering thousands of jobs | UI hang, browser OOM | Paginate; set max-jobs-displayed; don't fetch completed/failed > 1k | Any queue > 10k historical jobs |
| OTEL Collector memory limit not set | Collector OOM during traffic spike kills trace pipeline entirely | Set `memory_limiter` processor with hard/soft limits | Sustained traffic spike |

## Security Mistakes

Domain-specific security issues beyond OWASP basics.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Sentry `sendDefaultPii: true` on backend | Emails, IPs, headers shipped to third party (or self-hosted with weak access control) | `sendDefaultPii: false`; explicit opt-in per field |
| bull-board without role check | Platform-wide job data visible to any authenticated tenant admin | Require `platform_admin` role, not tenant role; audit all mutations |
| Trace data contains full user objects | Traces become GDPR/LGPD PII stores | Only IDs as span attributes; scrub email/name in OTEL processor |
| Error messages include user input (`failed for ${email}`) | PII in issue titles bypasses body scrubbing | Never interpolate user input into error messages; use tags/extras |
| Collector endpoint exposed to internet | Anyone can flood trace data, DoS the backend | Collector on private network only; auth at ingress if public |
| Webhook bodies captured in breadcrumbs | Full Stripe/Pagar.me customer data in Sentry | Exclude webhook routes from breadcrumb request capture |
| Source maps published with built assets | Reverses minification for anyone fetching the bundle | Upload to Sentry only; set build output to exclude `.map` files |
| Health `/health/deep` exposed publicly | Info disclosure about internal topology, queue names, DB presence | Require auth for deep health; keep `/health/live` and `/health/ready` public-but-minimal |
| Trace context headers accepted from untrusted clients | Client-controlled `traceparent` can pollute prod trace trees | Strip `traceparent` from incoming public requests; re-inject server-side |
| OTEL log sending captures log content verbatim | Password reset links, tokens in logs → trace backend | Never log secrets; prefer structured fields + an explicit redact list |

## UX Pitfalls (Operator UX)

The "users" here are on-call operators and developers debugging incidents.

| Pitfall | Operator Impact | Better Approach |
|---------|-----------------|-----------------|
| Alert with no runbook link | On-call paged, no idea what to do | Every alert has `runbook_url` annotation, linking to a versioned in-repo MD file |
| Dashboard without a "last deploy" marker | Can't tell if a regression is a deploy or traffic | Annotate Grafana with deploy events; label deploys with git SHA |
| Trace search requires knowing the trace ID | Can't find "slow requests for tenant X last hour" | Expose a query interface using tenant_id span attribute; document common queries |
| bull-board shows every job identically | Can't tell which are critical vs. routine | Colour/label queues by criticality; put billing + email in a "critical" section |
| Error tracker fingerprints every stack trace as unique | 1000 issues, same root cause, can't triage | Tune fingerprinting per error class; group by `error.type` not by message |
| No "recent errors" view on health dashboard | Operator has to open Sentry in a separate tab | Embed last 20 errors summary on the health page (read-only) |
| Alerts fire for individual jobs failing | Hundreds of pages for a transient Redis blip | Alert on job failure rate per queue, not per job |

## "Looks Done But Isn't" Checklist

Things that commonly appear complete but are missing critical pieces.

- [ ] **ErrorTracker port:** Sentry + GlitchTip + Pino-sink all pass the conformance test with identical redaction behaviour.
- [ ] **OTEL init:** Verified via startup self-test (synthetic span emitted and seen in backend) — not just "the SDK loaded."
- [ ] **BullMQ propagation:** Automated test asserts parent API span's `trace_id` == worker job span's `trace_id`.
- [ ] **ALS correlation:** Under concurrent load (100 RPS mixed tenants), log lines show correct `tenantId` for their request — no bleed.
- [ ] **Pino ↔ trace correlation:** Every log line emitted during an HTTP request includes `trace_id` and `span_id`.
- [ ] **Metric cardinality:** Each custom metric has a declared max cardinality; CI check fails if a PR adds a new dimension without a cap.
- [ ] **Sampling:** Prod config preserves 100 % of error traces and slow traces; verified by running an error + slow request and checking backend.
- [ ] **Sentry scrubbing:** Conformance test payload with passwords/tokens/emails/CPFs comes back redacted.
- [ ] **bull-board RBAC:** Unauthenticated fetch returns 401; authenticated non-admin returns 403; admin gets read-only unless superadmin.
- [ ] **Health `/health/deep`:** Actually runs a DB query and Redis check — doesn't just check a cached status.
- [ ] **Source maps:** Known-failing endpoint produces a demangled stack in the error tracker post-deploy.
- [ ] **Release tagging:** Every issue in the error tracker has `release: <git-sha>` tag.
- [ ] **Runbooks:** Every alert template includes a `runbook_url` that resolves to an in-repo MD file.
- [ ] **docker-compose.observability.yml:** Starts under 2 GB RAM; documents expected footprint; ports don't collide with existing dev servers.
- [ ] **Dashboards:** Every metric referenced on a dashboard is also referenced in at least one alert (or marked explicitly as "info-only").
- [ ] **GDPR/LGPD:** A documented procedure exists for erasing a user's trace/log data on request.
- [ ] **Webhook bodies:** No Stripe/Pagar.me payloads in Sentry breadcrumbs (verified by dev test with a sample payload).

## Recovery Strategies

When pitfalls occur despite prevention.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| OTEL init ordering broken (Pitfall 1) | LOW | Move `import "./telemetry"` to line 1; restart; verify self-test span |
| BullMQ orphan spans (Pitfall 2) | MEDIUM | Wrap enqueue and processor helpers; roll out behind a feature flag; old traces are lost but go-forward works |
| ALS context bleed (Pitfall 3) | HIGH | Immediate — replace all `enterWith` with `run`; hotfix deploy; audit log entries for the bleed window for incident disclosure |
| Metric cardinality explosion (Pitfall 4) | MEDIUM-HIGH | Drop the offending label via OTEL View; configure Prometheus relabelling to drop historical series; purge TSDB for the affected metric |
| Bad sampling (Pitfall 5) | LOW | Roll the collector config forward; past sampled-out traces are gone but future traffic recovers immediately |
| PII leaked to Sentry/GlitchTip (Pitfall 6) | HIGH | Emergency: use Sentry "delete events matching" feature; file a data processor incident ticket; review disclosure obligations under GDPR/LGPD |
| bull-board exposed (Pitfall 8) | MEDIUM-HIGH | Take bull-board offline immediately; review access logs for unauthorised mutations; reset any jobs that may have been tampered with |
| Auto-instr perf regression (Pitfall 9) | LOW-MEDIUM | Disable non-critical instrumentations; measure; re-enable selectively |
| Missing source maps (Pitfall 12) | LOW | Upload retroactively via sentry-cli for the offending release; future releases fixed by CI wiring |
| docker-compose.observability ate the laptop (Pitfall 13) | LOW | Tune mem_limit; shorten retention; remap ports |
| Runbook decay (Pitfall 15) | MEDIUM | Run a runbook audit sprint (1 day); deprecate unused runbooks; re-link alerts |

## Pitfall-to-Phase Mapping

Assumes a phase structure roughly aligned with the v1.3 target-features list. Exact phase numbering belongs to the roadmapper — these are logical groupings.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. OTEL SDK init ordering under Bun | Phase 1 (Tracer/Metrics port bootstrap) | Startup self-test span visible in Tempo |
| 2. BullMQ trace context propagation | Phase 2 (Distributed tracing + ALS) | Assertion test: API span trace_id == worker span trace_id |
| 3. AsyncLocalStorage context leak | Phase 2 (ALS correlation) | Concurrent load test: tenant_id correctness in logs |
| 4. High-cardinality metric labels | Phase 1 (MetricsProvider) + Phase 6 (collector config) | CI check on metric definitions; Prometheus series count baseline |
| 5. Sampling configured wrong | Phase 2 (tracing) + Phase 6 (local stack mirrors prod) | Trigger error + slow request; verify both preserved in backend |
| 6. Sentry/GlitchTip PII leaks | Phase 1 (ErrorTracker adapters) | Adapter conformance test with known-PII payloads |
| 7. pino ↔ OTEL correlation gaps | Phase 2 (tracing + log correlation) | Log smoke test: every log line has trace_id during a request |
| 8. bull-board without auth | Phase 3 (admin job monitor RBAC gate) | Unauth fetch → 401; non-admin → 403 |
| 9. Auto-instr perf regression | Phase 2 (rollout with benchmark gate) | Before/after p99 benchmark documented |
| 10. Multi-tenant observability model | Phase 2 (attribute model doc) + Phase 5 (privacy runbook) | `docs/runbooks/observability-attributes.md` shipped |
| 11. Alert fatigue / bad SLOs | Phase 5 (alert playbook templates) | SLO-based alerts; deploy-aware `for:` windows |
| 12. Source maps missing | Phase 1 (ErrorTracker) + Phase 6 (CI wiring) | Post-deploy demangled stack trace in error tracker |
| 13. docker-compose observability RAM | Phase 6 (local stack) | Startup under 2 GB RAM verified |
| 14. GlitchTip / Sentry SDK drift | Phase 1 (ErrorTracker port design) | Adapter conformance tests run on both backends in CI |
| 15. Runbook decay | Phase 5 (runbooks) | Runbook review cadence documented; stale links break CI |
| 16. Health dashboard green while broken | Phase 4 (health dashboard upgrade) | Synthetic journey metrics on the dashboard |
| 17. Dead telemetry | Phase 1 + Phase 7 (dashboards) | Every metric has an alert or dashboard consumer |
| 18. Instrumentation noise | Phase 1 | fs/dns/net disabled in instrumentation config |
| 19. Collector CORS (if browser telemetry) | Phase 6 (if in scope) | Browser trace smoke test |
| 20. BullMQ job data bloat | Phase 2 | Job size budget (< 1 KB added for tracing) |
| 21. Elysia request body auto-capture | Phase 1 | Webhook payload scrubbing test |

## Sources

- [OpenTelemetry Bun without Node.js --require flag — OneUptime (2026-02)](https://oneuptime.com/blog/post/2026-02-06-opentelemetry-bun-without-nodejs-require-flag/view)
- [Instrument Bun and ElysiaJS with OpenTelemetry — OneUptime (2026-02)](https://oneuptime.com/blog/post/2026-02-06-instrument-bun-elysiajs-opentelemetry/view)
- [Elysia OpenTelemetry plugin documentation](https://elysiajs.com/plugins/opentelemetry)
- [oven-sh/bun issue #3775 — OTel and Bun](https://github.com/oven-sh/bun/issues/3775)
- [oven-sh/bun issue #24324 — Linked AsyncContextFrame for ALS perf](https://github.com/oven-sh/bun/issues/24324)
- [appsignal/opentelemetry-instrumentation-bullmq](https://github.com/appsignal/opentelemetry-instrumentation-bullmq)
- [OpenTelemetry context propagation concepts](https://opentelemetry.io/docs/concepts/context-propagation/)
- [@opentelemetry/instrumentation-pino (npm)](https://www.npmjs.com/package/@opentelemetry/instrumentation-pino)
- [Handle high-cardinality metrics in OpenTelemetry — OneUptime (2026-02)](https://oneuptime.com/blog/post/2026-02-06-handle-high-cardinality-metrics-opentelemetry/view)
- [Implement cardinality limits to prevent metric explosions — OneUptime (2026-02)](https://oneuptime.com/blog/post/2026-02-06-cardinality-limits-prevent-metric-explosions/view)
- [OpenTelemetry tail-based sampling overview](https://opentelemetry.io/blog/2022/tail-sampling/)
- [opentelemetry-collector-contrib tailsamplingprocessor README](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/tailsamplingprocessor/README.md)
- [Tail-based sampling with OpenTelemetry — OneUptime (2026-01)](https://oneuptime.com/blog/post/2026-01-25-tail-based-sampling-opentelemetry/view)
- [Missing or incomplete traces due to collector sampling — Elastic Docs](https://www.elastic.co/docs/troubleshoot/ingest/opentelemetry/edot-collector/misconfigured-sampling-collector)
- [Sentry data scrubbing — Sensitive Data (JS)](https://docs.sentry.io/platforms/javascript/data-management/sensitive-data/)
- [Sentry server-side data scrubbing](https://docs.sentry.io/security-legal-pii/scrubbing/server-side-scrubbing/)
- [Sentry source maps — Bun](https://docs.sentry.io/platforms/javascript/guides/bun/sourcemaps/)
- [Sentry source maps troubleshooting — Bun](https://docs.sentry.io/platforms/javascript/guides/bun/sourcemaps/troubleshooting_js/)
- [GlitchTip Sentry SDK compatibility docs](https://glitchtip.com/sdkdocs/)
- [GlitchTip 6 release notes (2026-02)](https://glitchtip.com/blog/2026-02-03-glitchtip-6-released/)
- [bull-board — Express auth example](https://github.com/felixmosh/bull-board/tree/master/examples/with-express-auth)
- [Monitor BullMQ with bull-board — OneUptime (2026-01)](https://oneuptime.com/blog/post/2026-01-21-bullmq-bull-board/view)
- [The Hidden Cost of Async Context in Node.js — Platformatic blog](https://blog.platformatic.dev/the-hidden-cost-of-context)
- [nodejs/node issue #34493 — ALS performance](https://github.com/nodejs/node/issues/34493)
- [Grafana Tempo — Deploy with Docker Compose](https://grafana.com/docs/tempo/latest/set-up-for-tracing/setup-tempo/deploy/locally/docker-compose/)
- [Grafana Loki — Docker install](https://grafana.com/docs/loki/latest/setup/install/docker/)
- [OpenTelemetry traces concepts](https://opentelemetry.io/docs/concepts/signals/traces/)
- [OpenTelemetry propagators API spec](https://opentelemetry.io/docs/specs/otel/context/api-propagators/)

---
*Pitfalls research for: v1.3 Observability & Operations on Bun + Elysia + BullMQ + Drizzle + PostgreSQL*
*Researched: 2026-04-21*
