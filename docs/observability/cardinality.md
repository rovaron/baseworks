# Observability Cardinality Guide

Cardinality is the number of unique values an attribute can take. HIGH-cardinality values create unbounded label spaces in metrics backends — they must NEVER become metric labels. They MAY appear on spans (one trace at a time) and structured logs (one event at a time), but a metric like `requests_total{tenantId="..."}` would explode the metrics backend with one time series per tenant.

---

## Rules

- **Span attributes:** any cardinality is fine. One span instance carries one set of values; the trace store keys by `traceId / spanId`, not by attribute value.
- **Structured log fields:** any cardinality is fine. One log event carries one set of values. The pino mixin auto-injects `requestId / traceId / spanId / tenantId / userId / locale` from the active `obsContext` frame.
- **Metric labels:** LOW or MEDIUM cardinality only. HIGH-cardinality values are forbidden.
- **PII denylist overlap:** every value on the scrubber denylist (`packages/observability/src/lib/scrub-pii.ts:34-52`) is HIGH-cardinality by definition. The two lists are not identical — `requestId` is high-card but not PII.

---

## Scrubber denylist (verbatim — first five entries)

```typescript
// From packages/observability/src/lib/scrub-pii.ts:34-38
export const DEFAULT_DENY_KEYS: readonly string[] = [
  "password",
  "passwd",
  "secret",
  "token",
```

The full 17-key denylist runs through line 52 and is recursively applied through nested objects/arrays. See `packages/observability/src/lib/scrub-pii.ts:34-52` for the canonical list.

---

## Baseworks-specific HIGH-cardinality values

The 9 fields below are HIGH-cardinality in the Baseworks codebase today (D-08). Each is forbidden as a metric label; each is OK on spans/logs.

- **tenantId** — one per tenant; with N tenants per fork, label space = N. Forbidden.
- **userId** — one per user; unbounded.
- **requestId** — generated per-request via `crypto.randomUUID()`; unbounded.
- **email** — one per user; unbounded; ALSO PII (scrubbed in error events via the deny-key `email`).
- **command** — string per CQRS command (e.g., `example.create`). MEDIUM at v1.3 (~50 distinct values), but treated as HIGH out of caution as the surface grows.
- **queryName** — same as command but for queries (`getSubscriptionStatus`, etc.).
- **jobId** — BullMQ-assigned per job; unbounded.
- **stripeCustomerId** — one per Stripe customer; unbounded. On the deny-key list.
- **pagarmeCustomerId** — one per Pagar.me customer; unbounded. Treated identically to `stripeCustomerId`.

---

## Anti-patterns

The following are common cardinality blowups. Each fails review.

- **Concrete URL paths as labels.** `latency_ms{path="/api/users/123"}` explodes — every distinct user id becomes a new time series. Use the matched-route template instead: `latency_ms{route="/api/users/:id"}`. Elysia exposes the route template; the metric label uses that, not `request.url`.
- **Error messages as labels.** `errors_total{message="..."}` explodes because the message often contains tenantId, userId, or DB row ids. Use a stable error code: `errors_total{code="db_connection_failed"}`.
- **Tenant id on counters.** `requests_total{tenantId="..."}` is forbidden. If per-tenant aggregation is required, use a span attribute (so traces remain queryable per-tenant) and aggregate via the trace backend, not the metrics backend.
- **Job names with embedded ids.** `job_duration_ms{name="send-email-tenant_abc"}` explodes. Use the queue name and a separate stable kind tag: `job_duration_ms{queue="email-send", kind="welcome"}`.

---

## Forward-looking: when OTLP wires

When a fork wires the OTEL `MetricsProvider` port to a real OTLP exporter (deferred to v1.4+ per Phase 21 deferral), this guide becomes mechanically enforceable. A Biome GritQL lint rule analogous to Phase 19's `obsContext.enterWith` ban can detect direct uses of HIGH-cardinality fields as metric labels at the call site (`metrics.counter(...).inc({ tenantId })` and similar). Until then, this document is the contract; PR review enforces it.

---

## Cross-references

- [attributes.md](./attributes.md) — the canonical glossary with the Cardinality risk column for every field.
- [trace-propagation.md](./trace-propagation.md) — how `traceId / spanId` flow through the system; both are HIGH-cardinality and never become metric labels.
- [../runbooks/otel-exporter-failing.md](../runbooks/otel-exporter-failing.md) — operator runbook for diagnosing observability egress failures (forward-looking link; Plan 23-03 ships the file).
