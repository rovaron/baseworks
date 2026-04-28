# Observability Attributes Glossary

This guide is the canonical reference for context attributes that flow through Baseworks's observability ports. Every value listed here lives on at least one of: a span (OTEL), a structured log (pino), or a metric (forward-looking — Phase 21+). The Cardinality risk column is decisive: HIGH-cardinality values must NEVER become metric labels (see [cardinality.md](./cardinality.md)).

---

## General Rules

- **Source of truth:** the `ObservabilityContext` interface at `packages/observability/src/context.ts:43-51`. New fields land there first; this glossary is updated in the same PR.
- **No PII in metric labels:** see [cardinality.md](./cardinality.md) and the scrubber denylist at `packages/observability/src/lib/scrub-pii.ts:34-52`.
- **Lives-on convention:** `span` = OTEL span attribute, `log` = pino structured log field (auto-injected from `obsContext` mixin), `metric` = OTEL metric label (forward-looking).
- **Type column:** TypeScript type (matches the source interface).
- **Cardinality risk:** `LOW` (≤ ~10 distinct values), `MEDIUM` (≤ ~1000), `HIGH` (unbounded). HIGH = forbidden as metric label, OK on span/log.

---

## ObservabilityContext interface (verbatim from source)

```typescript
// From packages/observability/src/context.ts:43-51
export interface ObservabilityContext {
  requestId: string;
  traceId: string;
  spanId: string;
  locale: Locale;
  tenantId: string | null;
  userId: string | null;
  inboundCarrier?: Record<string, string>;
}
```

---

## Glossary

| Name | Lives on | Type | Example value | Cardinality risk |
| --- | --- | --- | --- | --- |
| requestId | span, log | string | req_a8f3b1 | HIGH |
| traceId | span, log | string (W3C) | 4bf92f3577b34da6a3ce929d0e0e4736 | HIGH |
| spanId | span, log | string (W3C) | 00f067aa0ba902b7 | HIGH |
| tenantId | span, log | string | tenant_abc123 | HIGH |
| userId | span, log | string | user_xyz789 | HIGH |
| locale | span, log | string | pt-BR | LOW |
| command | span | string | example.create | MEDIUM |
| queryName | span | string | getSubscriptionStatus | MEDIUM |
| jobId | span, log | string | bull_q1_4567 | HIGH |
| stripeCustomerId | log | string | cus_test_xxxx | HIGH |
| pagarmeCustomerId | log | string | pagarme_cust_xxxx | HIGH |

Example values are synthetic placeholders. No real customer or internal data appears in this document.

---

## Field notes

- **requestId** — generated per-request via `crypto.randomUUID()` at the Bun.serve fetch boundary, or read from a validated inbound `x-request-id` header (regex `^[A-Za-z0-9_-]{1,128}$` per Phase 20.1 H-02). Available on every span and log line for the request's lifetime, including any worker jobs enqueued during the request (carrier field `_requestId` on `job.data`).
- **traceId / spanId** — W3C trace-context fields. The fetch wrapper synthesizes an OTel SpanContext seeded with the obsContext traceId so that producer-side logs, the BullMQ carrier `traceparent`, and the consumer-side worker logs all share a single traceId end-to-end (Phase 20.1 D-11). Cardinality is unbounded, but the value is the trace's primary key — never a label.
- **tenantId / userId** — null at seed time, populated after `auth.api.getSession()` resolves in `tenantMiddleware` via `setTenantContext`. Span attributes write `""` for null values (`tenant.id` / `user.id` on producer / consumer spans).
- **locale** — one of the `Locale` union values from `@baseworks/i18n` (currently `pt-BR | en`). LOW cardinality: a fork's supported-locale set is bounded.
- **command / queryName** — CQRS dispatch labels set by `wrapCqrsBus` on the `cqrs.dispatch <Name>` span. v1.3 surface is ~50 distinct names, so MEDIUM today, but treated as HIGH-equivalent by `cardinality.md` to defend against future growth.
- **jobId** — BullMQ-assigned per job. The producer span attaches `messaging.message.id` on its post-`origAdd` step (`packages/observability/src/wrappers/wrap-queue.ts:87-89`); the consumer span receives the same id via `propagation.extract`.
- **stripeCustomerId / pagarmeCustomerId** — billing-module fields. Live on logs only; the scrubber's deny-key list (`packages/observability/src/lib/scrub-pii.ts:34-52`) keeps them out of error envelopes shipped to upstream trackers (`stripeCustomerId` is on the denylist directly; `pagarmeCustomerId` is structurally analogous and treated identically by Baseworks's deny rules — see cardinality.md).

---

## Cross-references

- [cardinality.md](./cardinality.md) — HIGH-cardinality enforcement and the 9 Baseworks-specific values that are forbidden as metric labels.
- [trace-propagation.md](./trace-propagation.md) — How `traceId / spanId / requestId` flow from HTTP → CQRS → DB → enqueue → worker.
