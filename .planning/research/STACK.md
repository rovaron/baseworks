# Stack Research: v1.3 Observability & Operations

**Domain:** Observability (errors, metrics, traces, logs) + ops tooling for a Bun/Elysia/BullMQ monorepo
**Researched:** 2026-04-21
**Confidence:** HIGH for Bun/OTEL/Sentry/bull-board baseline; MEDIUM for exact Docker image tags (verify at pin-time); HIGH for what to avoid
**Scope:** Additions/changes only. All v1.2 baseline stack (Bun 1.1+, Elysia 1.1+, Drizzle, postgres.js, BullMQ 5, ioredis 5, pino 9, better-auth 1.2, Next.js 15, Vite 6, shadcn, Tailwind 4, Zod, @t3-oss/env-core) is taken as given and NOT re-researched.

---

## Executive Decision

| Decision | Choice | Reason |
|----------|--------|--------|
| OTEL SDK | `@opentelemetry/sdk-node` (NOT `@opentelemetry/sdk-trace-web` or custom-per-runtime) | Bun implements enough of `node:*` to run the Node SDK. Community posts (Feb 2026) confirm it works with programmatic init. |
| OTEL init style | Programmatic, NOT `--require`/`-r` | Bun's module loader does not respect Node's `--require` for auto-instrumentation hooks. Must call `sdk.start()` before any instrumented module is imported. |
| OTEL exporter | OTLP **HTTP/protobuf** (`@opentelemetry/exporter-*-otlp-proto`) | gRPC exporter (`@grpc/grpc-js`) has native-addon quirks under Bun. HTTP/protobuf is the documented Bun path in every 2026 write-up. |
| Sentry SDK | `@sentry/bun` (NOT `@sentry/node`) | First-class Bun SDK; `@sentry/profiling-node` native addon does not run in Bun. |
| GlitchTip adapter | Same `@sentry/bun` client — DSN swap only | GlitchTip 6 (Feb 2026) implements Sentry wire protocol; no second SDK required. |
| BullMQ instrumentation | `@appsignal/opentelemetry-instrumentation-bullmq` | Jennifer's original package is minimally maintained; AppSignal fork is the actively developed successor called out in OTEL community docs. |
| Job monitor | `@bull-board/elysia` (7.x) + `@bull-board/api` + `@bull-board/ui` | Native Elysia adapter exists — no custom mount needed. Mount behind admin RBAC middleware. |
| Metrics | OTEL SDK metrics only — NO `prom-client` | OTEL `MeterProvider` produces OTLP metrics; collector converts to Prometheus remote-write or scrape. Adding `prom-client` would be double-booking. |
| AsyncLocalStorage | Bun native `node:async_hooks` | Implemented in Bun, supports `run`/`enterWith`/`snapshot`. Caveat: avoid NAPI addons inside ALS scopes (known Bun issue). |
| Log shipping | OTEL Logs via `@opentelemetry/instrumentation-pino` + collector | Promtail EOL March 2026. Pino instrumentation injects trace_id/span_id and emits to collector which routes to Loki. Alloy as fallback if not using collector. |
| Local dev stack | Grafana Alloy OR OTEL Collector Contrib as the single ingress, fanning to Prometheus / Tempo / Loki / Grafana | One collector per compose file — simpler than three agents. |

---

## Recommended Stack

### New Core Packages

| Package | Version | Purpose | Bun Compat | Plug-in Point |
|---------|---------|---------|------------|---------------|
| `@opentelemetry/api` | ^1.9.0 | Tracing/metrics/context API surface used by app code | HIGH — pure JS, no native deps | Import in every module that creates custom spans; CQRS dispatcher wraps command/query in `tracer.startActiveSpan` |
| `@opentelemetry/sdk-node` | ^0.215.0 | Aggregate SDK: `NodeSDK` bootstrap for traces + metrics + logs | HIGH — runs under Bun with programmatic init (verified in community posts Feb 2026) | `apps/api/src/telemetry/bootstrap.ts` — first import before Elysia |
| `@opentelemetry/resources` | ^1.30.0 | Resource attributes (service.name, service.version) | HIGH | `bootstrap.ts` |
| `@opentelemetry/semantic-conventions` | ^1.30.0 | Standard attribute keys | HIGH | Wherever attributes are set |
| `@opentelemetry/sdk-trace-node` | ^1.30.0 | Node-targeted tracer provider (used by sdk-node internally; pin explicitly for span processors) | HIGH | `bootstrap.ts` |
| `@opentelemetry/sdk-metrics` | ^1.30.0 | `MeterProvider`, `PeriodicExportingMetricReader` | HIGH | `bootstrap.ts`; MetricsProvider port Grafana adapter uses it |
| `@opentelemetry/sdk-logs` | ^0.215.0 | `LoggerProvider` for OTLP logs | HIGH | `bootstrap.ts` when log-via-OTLP mode is selected |
| `@opentelemetry/exporter-trace-otlp-proto` | ^0.215.0 | OTLP/HTTP+protobuf trace exporter | HIGH — pure fetch, no gRPC | `bootstrap.ts` |
| `@opentelemetry/exporter-metrics-otlp-proto` | ^0.215.0 | OTLP/HTTP+protobuf metrics exporter | HIGH | `bootstrap.ts` |
| `@opentelemetry/exporter-logs-otlp-proto` | ^0.215.0 | OTLP/HTTP+protobuf logs exporter | HIGH | `bootstrap.ts` |
| `@opentelemetry/auto-instrumentations-node` | ^0.60.0 | Bundle of HTTP/pg/ioredis/http/graphql/etc. auto-instrumentations | MEDIUM — most subset works under Bun; disable any that fail with `getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-xxx': { enabled: false } })` | `bootstrap.ts` — preferred over hand-picking each one |
| `@opentelemetry/instrumentation-pg` | ^0.56.0 | postgres driver instrumentation (auto-injected via auto-instrumentations-node, but postgres.js may need patch — see pitfalls) | MEDIUM | Included in bundle |
| `@opentelemetry/instrumentation-ioredis` | ^0.58.0 | ioredis instrumentation — covers BullMQ Redis ops at the driver level | HIGH | Included in bundle |
| `@opentelemetry/instrumentation-pino` | ^0.47.0 | Injects trace_id/span_id into pino log records + optional OTLP log emission | HIGH | Included in bundle; pair with `@opentelemetry/sdk-logs` for full log export |
| `@opentelemetry/instrumentation-http` | ^0.58.0 | Node `http`/`https` client spans (outbound HTTP from app) | HIGH | Included in bundle |
| `@appsignal/opentelemetry-instrumentation-bullmq` | ^0.7.x (verify exact at install) | BullMQ Worker/Queue span creation + context propagation across enqueue→process boundary | MEDIUM — pure JS wrapping BullMQ hooks, expected to work; smoke-test in Phase 0 | Register manually alongside auto-instrumentations |
| `@sentry/bun` | ^10.32+ | Error tracking: errors, unhandled rejections, breadcrumbs, performance | HIGH — first-party Bun SDK | `apps/api/src/telemetry/sentry.ts`, ErrorTracker Sentry + GlitchTip adapters share this client |
| `@bull-board/api` | ^7.0.0 | Core bull-board API | HIGH | Workers server (or API process) registers queues |
| `@bull-board/elysia` | ^7.0.0 | Native Elysia server adapter for bull-board | HIGH — published 2026-04 | Mount at `/admin/queues` behind admin RBAC; or in admin-dashboard-backend process |
| `@bull-board/ui` | ^7.0.0 | Pre-built UI bundle served by the Elysia adapter | HIGH | Auto-served by elysia adapter |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:async_hooks` (built-in) | — | `AsyncLocalStorage` for request-scoped correlation context | Request middleware enters ALS scope with `{ correlationId, tenantId, userId, traceId }`; scope propagates into async handlers and BullMQ enqueue calls |
| `nanoid` | ^5.0+ (already installed) | Correlation ID generation when no `x-request-id` / `traceparent` is provided | Reuse existing dependency — do not add `uuid` |

### Docker Images — `docker-compose.observability.yml`

| Image | Pinned Tag | Purpose | Notes |
|-------|-----------|---------|-------|
| `otel/opentelemetry-collector-contrib` | `0.127.0` (or latest 0.150.0 — pin at implementation time) | Single ingress for OTLP traces/metrics/logs, fans out to Tempo/Prometheus/Loki | Contrib flavor needed for Loki + Prometheus remote-write exporters |
| `grafana/tempo` | `2.10.4` | Trace storage (OTLP ingest) | v2.8+ changed default http-listen-port to 3200 — update any hard-coded configs |
| `prom/prometheus` | `v3.10.0` (or latest `v3` tag) | Metrics storage, scraping + remote-write receiver | Prefer `-distroless` variant for production compose; `v3` for dev |
| `grafana/loki` | `3.7.1` | Log storage (OTLP ingest via collector, no Promtail) | Single-binary mode via `-config.file` is fine for dev |
| `grafana/grafana` | `12.4.3` (or `13.0.1` if stable feedback received) | Dashboards, alerting | Starting v12.4.0, `grafana/grafana-oss` repo is frozen; use `grafana/grafana` |
| `grafana/alloy` | latest stable | Optional replacement for OTEL Collector Contrib if teams prefer Grafana-native agent | Promtail EOL 2026-03-02; Alloy is the migration target — but the OTEL collector is vendor-neutral and is the default recommendation |

Pre-provisioned Grafana datasources + dashboards are shipped as JSON in `infra/grafana/provisioning/`.

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Bun `--inspect` + OTEL dev exporter | Local trace inspection | `OTEL_TRACES_EXPORTER=console` during unit development to debug span shape without running the stack |
| `bull-board` standalone (same packages) | Local queue inspection outside admin | Optional — `apps/api` `/admin/queues` mount covers the use case |

---

## Installation

```bash
# Backend (apps/api) — telemetry bootstrap + instrumentations
bun add \
  @opentelemetry/api@^1.9 \
  @opentelemetry/sdk-node@^0.215 \
  @opentelemetry/sdk-trace-node@^1.30 \
  @opentelemetry/sdk-metrics@^1.30 \
  @opentelemetry/sdk-logs@^0.215 \
  @opentelemetry/resources@^1.30 \
  @opentelemetry/semantic-conventions@^1.30 \
  @opentelemetry/exporter-trace-otlp-proto@^0.215 \
  @opentelemetry/exporter-metrics-otlp-proto@^0.215 \
  @opentelemetry/exporter-logs-otlp-proto@^0.215 \
  @opentelemetry/auto-instrumentations-node@^0.60 \
  @appsignal/opentelemetry-instrumentation-bullmq

# Error tracking
bun add @sentry/bun

# Job monitor (can live in apps/api OR a dedicated admin backend package)
bun add @bull-board/api @bull-board/elysia @bull-board/ui

# NO new dev dependencies required. Existing bun test / vitest stack is sufficient.
```

All packages resolve under Bun workspaces without additional config.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `@opentelemetry/sdk-node` | `@opentelemetry/sdk-trace-base` + hand-wired providers | Only if auto-instrumentations cause crashes under Bun and we need surgical control. Default is auto. |
| OTLP HTTP/protobuf exporter | OTLP HTTP/JSON (`exporter-*-otlp-http`) | Slightly slower but human-debuggable on wire. Use temporarily for collector troubleshooting. |
| OTLP HTTP/protobuf exporter | OTLP gRPC (`exporter-*-otlp-grpc` + `@grpc/grpc-js`) | DO NOT use. `@grpc/grpc-js` has native-addon edge cases under Bun; no benefit at our scale. |
| `@sentry/bun` | `@sentry/node` | Never. Profiling addon fails; use `@sentry/bun` unconditionally. |
| `@appsignal/opentelemetry-instrumentation-bullmq` | `@jenniferplusplus/opentelemetry-instrumentation-bullmq` (original) | Only to cross-check span shape. Original is minimally maintained per OTEL-contrib docs. |
| `@bull-board/elysia` | Hand-rolling Express adapter behind Elysia proxy | Never — native adapter exists. |
| OTEL metrics SDK | `prom-client` + `/metrics` scrape endpoint | Only if a specific dashboard requires a metric that OTEL cannot express. Default: do not mix. |
| OTEL Collector Contrib | Grafana Alloy | If team is Grafana-stack-only AND wants one binary that owns both shipping + config-via-Grafana-Cloud. Alloy is a vendor-neutral OTEL distribution — functionally equivalent for our needs. |
| `pino` + `@opentelemetry/instrumentation-pino` | `pino-opentelemetry-transport` | Transport approach runs in a Pino worker thread. Prefer the instrumentation approach so trace_id injection happens in the main thread and OTLP log export is controlled by the same SDK as traces/metrics. |
| GlitchTip via `@sentry/bun` + DSN swap | Dedicated GlitchTip SDK | There is no separate SDK — DSN swap is the intended path. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@sentry/node` in apps/api | Profiling is a native addon, fails under Bun; Sentry docs explicitly route Bun users elsewhere | `@sentry/bun` |
| `@sentry/profiling-node` | Does not load under Bun (tracked in oven-sh/bun#19230) | Skip profiling, or rely on OTEL spans for perf insight |
| `@grpc/grpc-js` + OTLP gRPC exporter | Native-dep quirks under Bun, no throughput benefit at this scale | OTLP HTTP/protobuf |
| `prom-client` | Would duplicate metrics pipeline — we already have OTEL metrics + collector | OTEL `@opentelemetry/sdk-metrics` |
| `winston` / `bunyan` | pino is already the canonical logger across the codebase | pino (already installed) |
| OTEL `--require` / `-r` bootstrap | Bun does not honor Node's require hook for auto-instrumentation | Programmatic `sdk.start()` as first import |
| `promtail` | EOL 2026-03-02, no future updates | OTEL Collector Contrib OR Grafana Alloy |
| `newrelic` / `dd-trace` / `elastic-apm-node` full-fat vendor agents | Pull in vendor-specific native addons, break Bun, defeat port/adapter pattern | OTEL SDK + collector; route to vendor via collector exporter if needed |
| `express` / `koa` adapters for bull-board | We use Elysia | `@bull-board/elysia` |
| `opentracing` / `jaeger-client-node` | Superseded by OpenTelemetry since 2022 | OpenTelemetry |
| Custom UUID lib for correlation IDs | `nanoid` already installed | `nanoid` |

---

## Stack Patterns by Variant

**If fork user opts for Sentry SaaS (ErrorTracker = "sentry"):**
- Set `SENTRY_DSN` to Sentry-hosted DSN. No further changes — `@sentry/bun` handles it.

**If fork user opts for self-hosted GlitchTip (ErrorTracker = "glitchtip"):**
- Set `SENTRY_DSN` to GlitchTip DSN. Same SDK, same code path.
- Disable Sentry-only features the adapter exposes (no Session Replay, no full Distributed Tracing visualization inside Sentry UI — tracing goes to Tempo instead).

**If fork user opts for no external error tracker (ErrorTracker = "pino-sink" / "noop"):**
- Skip `@sentry/bun` init. ErrorTracker adapter writes errors to pino at `level: error` with structured fields. Zero external dependency.

**If fork user opts for OTEL off (MetricsProvider = "noop", Tracer = "noop"):**
- `NodeSDK` is not started. `@opentelemetry/api` no-op providers take over by default. Cost: near-zero overhead when off.

**If running under Node instead of Bun (future-proofing):**
- Replace `@sentry/bun` with `@sentry/node` + optional `@sentry/profiling-node`. Everything else is identical. The port/adapter pattern already encapsulates this.

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@opentelemetry/sdk-node@0.215` | `@opentelemetry/api@^1.9` | SDK peer-depends on 1.9+; lock to avoid 2.x jump |
| `@opentelemetry/auto-instrumentations-node@0.60` | `@opentelemetry/sdk-node@0.21x` | Keep SDK + auto-instrumentations on matching minor release cadence |
| `@appsignal/opentelemetry-instrumentation-bullmq` | BullMQ 2.x–5.x | We are on BullMQ 5 — supported |
| `@sentry/bun@10.x` | Bun 1.1+ | Matches our runtime floor |
| `@bull-board/elysia@7.0.0` | `@bull-board/api@7.0.0`, Elysia 1.x | Major versions must match across `@bull-board/*` packages |
| Grafana 12.4+ | Tempo 2.8+, Loki 3.x, Prometheus 3.x | All 2026 versions interoperate cleanly |
| OTEL Collector Contrib 0.127+ | OTLP/HTTP protobuf from our exporters | HTTP/protobuf stable since 2024 |
| Bun `node:async_hooks` | `AsyncLocalStorage` + context propagation | Avoid NAPI addon calls inside ALS scope (oven-sh/bun#13638) |

---

## Environment Schema Additions (@t3-oss/env-core)

Extend the existing backend env schema in `apps/api/src/env.ts`:

```ts
// Error tracking
ERROR_TRACKER: z.enum(["sentry", "glitchtip", "pino-sink", "noop"]).default("noop"),
SENTRY_DSN: z.string().url().optional(),               // required when ERROR_TRACKER in ("sentry","glitchtip")
SENTRY_ENVIRONMENT: z.string().default("development"),
SENTRY_RELEASE: z.string().optional(),                 // CI sets to git sha
SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

// OTEL tracing + metrics
OTEL_ENABLED: z.coerce.boolean().default(false),
OTEL_SERVICE_NAME: z.string().default("baseworks-api"),
OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().default("http://localhost:4318"),
OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),     // k=v,k=v — e.g., auth token for SaaS collectors
OTEL_TRACES_SAMPLER: z.enum(["always_on","always_off","parentbased_always_on","traceidratio","parentbased_traceidratio"]).default("parentbased_traceidratio"),
OTEL_TRACES_SAMPLER_ARG: z.coerce.number().min(0).max(1).default(0.1),
OTEL_METRICS_ENABLED: z.coerce.boolean().default(false),
OTEL_LOGS_ENABLED: z.coerce.boolean().default(false),

// Job monitor
BULL_BOARD_ENABLED: z.coerce.boolean().default(true),  // toggle mount; RBAC check still applies
BULL_BOARD_BASE_PATH: z.string().default("/admin/queues"),
```

Add a cross-field refine so `SENTRY_DSN` is required when `ERROR_TRACKER` selects Sentry or GlitchTip. Mirror the OTEL env names from the spec exactly (`OTEL_EXPORTER_OTLP_ENDPOINT` etc.) — those are standard and the SDK picks some up automatically.

Worker process (`apps/api/src/worker.ts`) reuses the same schema — must read the identical OTEL config so trace context propagates and job spans land in the same service graph (distinct `OTEL_SERVICE_NAME=baseworks-worker`).

---

## Bun Compatibility Scorecard

| Concern | Status | Workaround |
|---------|--------|-----------|
| `AsyncLocalStorage` | NATIVE — supported in `node:async_hooks` | None |
| `@opentelemetry/sdk-node` boot | WORKS with programmatic init | Do not use `--require`; import and `sdk.start()` as the very first statement in the entrypoint |
| OTLP HTTP/protobuf exporter | WORKS | None |
| OTLP gRPC exporter | AVOID | Use HTTP/protobuf instead |
| `@opentelemetry/auto-instrumentations-node` | WORKS for HTTP, pg, ioredis, pino | Disable any instrumentation that errors via `getNodeAutoInstrumentations({ '<name>': { enabled: false } })`. Smoke-test each in Phase 0. |
| `@opentelemetry/instrumentation-pg` + postgres.js | PARTIAL — this package instruments `pg`; postgres.js is a different driver | Rely on manual Drizzle spans in the Tracer port adapter (wrap query execution in `tracer.startActiveSpan`) OR evaluate `@opentelemetry/instrumentation-postgres` alternatives at implementation time. Flag for phase-level deep research. |
| `@sentry/bun` | FIRST-CLASS | None |
| `@sentry/profiling-node` | BROKEN under Bun | Do not install; skip profiling |
| `@appsignal/opentelemetry-instrumentation-bullmq` | EXPECTED TO WORK (pure-JS hook wrapping) | Smoke-test in Phase 0; if it fails, fall back to manual span creation inside CQRS job dispatcher |
| `@bull-board/elysia` | WORKS (2026-04 release targets Elysia + Bun) | None |
| Bun single-file executable (`bun build --compile`) | BREAKS OTEL auto-instrumentation + Sentry auto-instrumentation | Do not use `--compile` for the production API image. Current Docker strategy runs `bun run src/index.ts` which is correct. |
| NAPI addon inside `AsyncLocalStorage.run()` | KNOWN BUN BUG (oven-sh/bun#13638) | None of our planned deps are NAPI addons; do not add one later without re-testing |

---

## Integration Points

| Code path | Package inserted | Why |
|-----------|------------------|-----|
| `apps/api/src/index.ts` — line 1 | `./telemetry/bootstrap` import | Must run before Elysia, Drizzle, BullMQ are imported |
| `apps/api/src/telemetry/bootstrap.ts` | `NodeSDK` from `@opentelemetry/sdk-node` | Configures exporters + samplers + resource + instrumentations |
| `apps/api/src/telemetry/sentry.ts` | `@sentry/bun` | Called from bootstrap when `ERROR_TRACKER=sentry|glitchtip` |
| `apps/api/src/middleware/request-context.ts` (new) | `AsyncLocalStorage` | Enters scope per Elysia request; stores correlationId + tenantId + userId + active span |
| `apps/api/src/core/cqrs/dispatcher.ts` | `@opentelemetry/api` + ErrorTracker port | Wraps each command/query in an active span; on error, calls ErrorTracker.capture |
| `packages/db` — query wrapper | `@opentelemetry/api` | Manual spans for Drizzle operations (postgres.js driver — see pitfalls) with SQL statement as attribute |
| `apps/api/src/worker.ts` | `NodeSDK` init (worker flavor) + `@appsignal/opentelemetry-instrumentation-bullmq` | Worker trace context continues from enqueue span |
| `apps/api/src/modules/<job>/handler.ts` | BullMQ instrumentation auto-wraps | Plus app-level spans inside job handlers |
| `apps/api/src/admin/bull-board.ts` (new) | `@bull-board/elysia` | Mounted under admin RBAC guard |
| `apps/admin/src/pages/jobs.tsx` | iframe/link to `/admin/queues` | Simpler than re-embedding the UI inside the React admin |
| `apps/api/src/routes/health.ts` | Pure code changes; no new dep | Reuse Drizzle ping + ioredis ping + BullMQ queue depth |
| `infra/observability/docker-compose.observability.yml` | Images listed above | Local dev stack |
| `infra/observability/otel-collector.yml` | — | OTLP HTTP receiver → Tempo/Prometheus-RW/Loki exporters |
| `infra/grafana/provisioning/*` | — | Pre-built dashboards + Tempo/Prometheus/Loki datasources |
| `docs/runbooks/*.md` | — | On-call playbooks (no deps) |

---

## Sources

- Bun `node:async_hooks` reference — https://bun.com/reference/node/async_hooks/AsyncLocalStorage — HIGH (official)
- Bun + Elysia + OTEL integration guide (Feb 2026) — https://oneuptime.com/blog/post/2026-02-06-instrument-bun-elysiajs-opentelemetry/view — MEDIUM (community)
- OTEL Bun bootstrap without `--require` (Feb 2026) — https://oneuptime.com/blog/post/2026-02-06-opentelemetry-bun-without-nodejs-require-flag/view — MEDIUM (community)
- Sentry Bun docs — https://docs.sentry.io/platforms/javascript/guides/bun/ — HIGH (official)
- `@sentry/profiling-node` Bun incompat — https://github.com/oven-sh/bun/issues/19230 — HIGH
- `@bull-board/elysia` npm (v7.0.0, 2026-04) — https://www.npmjs.com/package/@bull-board/elysia — HIGH
- `@bull-board/api` npm (v7.0.0) — https://www.npmjs.com/package/@bull-board/api — HIGH
- `@opentelemetry/sdk-node` npm (v0.215.0, 2026-04) — https://www.npmjs.com/package/@opentelemetry/sdk-node — HIGH
- `@opentelemetry/auto-instrumentations-node` npm — https://www.npmjs.com/package/@opentelemetry/auto-instrumentations-node — HIGH
- `@opentelemetry/instrumentation-pg` npm — https://www.npmjs.com/package/@opentelemetry/instrumentation-pg — HIGH
- `@opentelemetry/instrumentation-ioredis` npm — https://www.npmjs.com/package/@opentelemetry/instrumentation-ioredis — HIGH
- AppSignal BullMQ OTEL instrumentation — https://github.com/appsignal/opentelemetry-instrumentation-bullmq — MEDIUM
- Pino + OTEL (instrumentation vs transport) — https://www.npmjs.com/package/@opentelemetry/instrumentation-pino — HIGH
- Grafana Tempo 2.8/2.10 release notes — https://grafana.com/docs/tempo/latest/release-notes/ — HIGH
- Grafana Loki 3.7.1 release — https://github.com/grafana/loki/releases/tag/v3.7.1 — HIGH
- Prometheus 3.10.0 release — https://github.com/prometheus/prometheus/releases/tag/v3.10.0 — HIGH
- Grafana 12.4.3/13.0.1 (Apr 2026) — https://github.com/grafana/grafana/releases — HIGH
- OTEL Collector Contrib Docker — https://hub.docker.com/r/otel/opentelemetry-collector-contrib — HIGH
- GlitchTip Sentry SDK compat — https://glitchtip.com/sdkdocs/ — HIGH
- Promtail EOL + Alloy migration — https://grafana.com/docs/alloy/latest/set-up/migrate/from-promtail/ — HIGH
- `node:async_hooks` + NAPI bug — https://github.com/oven-sh/bun/issues/13638 — MEDIUM (known issue, not blocking our deps)

---

## Confidence Summary

| Area | Confidence | Notes |
|------|------------|-------|
| OTEL package set + versions | HIGH | Verified via npm (Apr 2026) |
| Bun compatibility of OTEL SDK | HIGH | Multiple 2026 community guides + OTEL docs confirming programmatic-init path |
| `@sentry/bun` as correct SDK | HIGH | Official Sentry docs + Bun ecosystem guide |
| GlitchTip DSN-swap compat | HIGH | GlitchTip docs explicit |
| `@bull-board/elysia` readiness | HIGH | Published 2026-04, native Elysia adapter |
| BullMQ OTEL instrumentation | MEDIUM | Two packages exist; AppSignal fork is the maintained one but smoke-test in Phase 0 |
| postgres.js vs `instrumentation-pg` | MEDIUM — flag for phase-research | `instrumentation-pg` targets `pg`; postgres.js is different. Plan a manual Drizzle tracing wrapper as the reliable path |
| Grafana stack image tags | MEDIUM | Versions verified, but pin at implementation time — image tags rev weekly |
| AsyncLocalStorage under Bun | HIGH | Native, documented, avoid NAPI-in-scope |
| Env schema extensions | HIGH | Standard OTEL env var names + project conventions |

---

*Stack research for: v1.3 Observability & Operations — additions only*
*Researched: 2026-04-21*
