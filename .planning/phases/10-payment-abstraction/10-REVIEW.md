---
phase: 10-payment-abstraction
reviewed: 2026-04-11T00:00:00Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - apps/api/src/routes/admin.ts
  - packages/config/src/env.ts
  - packages/db/migrations/0001_rename_stripe_to_provider.sql
  - packages/db/src/schema/billing.ts
  - packages/modules/billing/src/adapters/pagarme/pagarme-adapter.ts
  - packages/modules/billing/src/adapters/pagarme/pagarme-webhook-mapper.ts
  - packages/modules/billing/src/adapters/stripe/stripe-adapter.ts
  - packages/modules/billing/src/adapters/stripe/stripe-webhook-mapper.ts
  - packages/modules/billing/src/commands/cancel-subscription.ts
  - packages/modules/billing/src/commands/change-subscription.ts
  - packages/modules/billing/src/commands/create-checkout-session.ts
  - packages/modules/billing/src/commands/create-one-time-payment.ts
  - packages/modules/billing/src/commands/create-portal-session.ts
  - packages/modules/billing/src/commands/record-usage.ts
  - packages/modules/billing/src/hooks/on-tenant-created.ts
  - packages/modules/billing/src/jobs/process-webhook.ts
  - packages/modules/billing/src/jobs/sync-usage.ts
  - packages/modules/billing/src/ports/payment-provider.ts
  - packages/modules/billing/src/ports/types.ts
  - packages/modules/billing/src/provider-factory.ts
  - packages/modules/billing/src/queries/get-billing-history.ts
  - packages/modules/billing/src/queries/get-subscription-status.ts
  - packages/modules/billing/src/routes.ts
findings:
  critical: 4
  warning: 5
  info: 4
  total: 13
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-04-11T00:00:00Z
**Depth:** standard
**Files Reviewed:** 23
**Status:** issues_found

## Summary

This phase introduces a payment provider abstraction layer that adds Pagar.me alongside the existing Stripe adapter. The port/adapter pattern is well-structured and the schema migration is non-destructive. However, four critical bugs were found that would prevent Pagar.me webhooks from working at all, silently skip customer creation for Pagar.me tenants, and leave the timing-safe webhook signature path as unreachable dead code. There are also several warnings around a hardcoded zero-amount in Pagar.me orders, the `cancelAtPeriodEnd` flag being ignored, and an offset parameter silently dropped from billing history pagination.

---

## Critical Issues

### CR-01: Pagar.me webhook signature — `crypto.subtle.timingSafeEqual` does not exist; secure path is dead code

**File:** `packages/modules/billing/src/adapters/pagarme/pagarme-adapter.ts:244-274`

**Issue:** The condition `!crypto.subtle.timingSafeEqual` is always `true` because `timingSafeEqual` is a method on `node:crypto`, not on `crypto.subtle`. As a result the `else` branch (lines 263-274) is unreachable dead code and every webhook request falls through to the manual fallback loop. The fallback loop itself is correct (it does not short-circuit on mismatch), but the intent was to use the Node/Bun native `timingSafeEqual` for constant-time comparison and only fall back when unavailable. The fallback is a string-encoded hex comparison rather than a raw-bytes comparison, which adds marginal (though negligible) risk.

**Fix:** Remove the `crypto.subtle.timingSafeEqual` guard. Import `timingSafeEqual` from `node:crypto` directly at the top of the method and use it unconditionally, since Bun ships Node-compatible crypto:

```typescript
async verifyWebhookSignature(params: VerifyWebhookParams): Promise<RawProviderEvent> {
  const { timingSafeEqual } = await import("node:crypto");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(this.config.webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBytes = await crypto.subtle.sign("HMAC", key, encoder.encode(params.rawBody));
  const expectedHex = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (
    expectedHex.length !== params.signature.length ||
    !timingSafeEqual(Buffer.from(expectedHex), Buffer.from(params.signature))
  ) {
    throw new Error("Invalid Pagar.me webhook signature");
  }

  const event = JSON.parse(params.rawBody);
  return { id: event.id ?? event.data?.id ?? crypto.randomUUID(), type: event.type, data: event.data };
}
```

---

### CR-02: Pagar.me webhooks always rejected — missing Pagar.me signature header in webhook route

**File:** `packages/modules/billing/src/routes.ts:52-58`

**Issue:** The webhook route reads the signature from only two headers: `stripe-signature` and `x-hub-signature`. Pagar.me sends webhook signatures in the `x-pagarme-signature` header. When `PAYMENT_PROVIDER=pagarme`, `sig` will always be an empty string and the route returns `400 "Missing webhook signature header"`. No Pagar.me webhook will ever be processed.

**Fix:** Add the Pagar.me header to the lookup chain:

```typescript
const sig =
  ctx.request.headers.get("stripe-signature") ||
  ctx.request.headers.get("x-pagarme-signature") ||
  ctx.request.headers.get("x-hub-signature") ||
  "";
```

---

### CR-03: `on-tenant-created.ts` checks `STRIPE_SECRET_KEY` regardless of active provider — Pagar.me customer creation silently skipped

**File:** `packages/modules/billing/src/hooks/on-tenant-created.ts:35`

**Issue:** The guard `if (!env.STRIPE_SECRET_KEY)` will cause customer creation to be silently skipped whenever `PAYMENT_PROVIDER=pagarme`, even if `PAGARME_SECRET_KEY` is correctly configured. Every new tenant will be missing a billing customer record, causing all subsequent billing operations to return `BILLING_NOT_CONFIGURED`.

**Fix:** Gate on the active provider's key:

```typescript
const providerName = env.PAYMENT_PROVIDER ?? "stripe";
const hasProviderKey =
  (providerName === "stripe" && !!env.STRIPE_SECRET_KEY) ||
  (providerName === "pagarme" && !!env.PAGARME_SECRET_KEY);

if (!hasProviderKey) {
  console.log(
    `[BILLING] Skipping payment provider customer creation for tenant ${tenantId} (no payment keys configured)`,
  );
  return;
}
```

---

### CR-04: `getPaymentProvider()` passes `undefined` to adapter constructors with non-null assertion — no runtime guard

**File:** `packages/modules/billing/src/provider-factory.ts:27-35`

**Issue:** Both adapter constructors receive `env.STRIPE_SECRET_KEY!` and `env.PAGARME_SECRET_KEY!`. TypeScript's `!` operator is erased at runtime. If `validatePaymentProviderEnv()` was not called at startup (it is an exported function that must be called manually — nothing enforces it), both adapters will silently receive `undefined` as their secret key. For Stripe, the SDK constructor will throw immediately. For Pagar.me, `undefined` will be base64-encoded in the `Authorization` header, producing incorrect credentials and opaque 401 errors on first API call.

**Fix:** Add explicit runtime guards inside `getPaymentProvider()`:

```typescript
case "stripe": {
  const secretKey = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe");
  if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is required when PAYMENT_PROVIDER=stripe");
  providerInstance = new StripeAdapter({ secretKey, webhookSecret });
  break;
}
case "pagarme": {
  const secretKey = env.PAGARME_SECRET_KEY;
  const webhookSecret = env.PAGARME_WEBHOOK_SECRET;
  if (!secretKey) throw new Error("PAGARME_SECRET_KEY is required when PAYMENT_PROVIDER=pagarme");
  if (!webhookSecret) throw new Error("PAGARME_WEBHOOK_SECRET is required when PAYMENT_PROVIDER=pagarme");
  providerInstance = new PagarmeAdapter({ secretKey, webhookSecret });
  break;
}
```

---

## Warnings

### WR-01: Pagar.me `createOneTimePayment` and `createCheckoutSession` hardcode `amount: 0`

**File:** `packages/modules/billing/src/adapters/pagarme/pagarme-adapter.ts:164,188`

**Issue:** Both order creation calls set `amount: 0` in the line items with a comment "Amount comes from the plan/price in a real integration." A zero-amount order will either be rejected by Pagar.me's API, silently create a free order, or result in an incorrect charge. This is not a placeholder that can be deferred — it will cause real money issues in production.

**Fix:** `CreateOneTimePaymentParams` and `CreateCheckoutSessionParams` do not currently carry an `amount` field. Either add an `amount` field to these param interfaces, or document that the Pagar.me adapter requires a plan ID that maps to a server-side price (and fetch that price from a Pagar.me plan endpoint). At minimum, replace the silent `0` with a thrown error so misconfiguration is visible:

```typescript
// In createOneTimePayment:
if (!params.amount) {
  throw new Error("Pagar.me adapter requires 'amount' in CreateOneTimePaymentParams (centavos)");
}
items: [{ amount: params.amount, ... }]
```

---

### WR-02: `cancelSubscription` ignores `cancelAtPeriodEnd` — both branches call identical DELETE

**File:** `packages/modules/billing/src/adapters/pagarme/pagarme-adapter.ts:100-113`

**Issue:** The `if (params.cancelAtPeriodEnd)` / `else` branches are identical — both call `DELETE /subscriptions/:id` immediately. While the comment acknowledges Pagar.me lacks native period-end cancellation, the structural bug means there's no behavioral difference, and the conditional is dead branching. Callers that pass `cancelAtPeriodEnd: false` expecting immediate cancellation and callers that pass `true` expecting deferred cancellation get identical behavior with no indication either way.

**Fix:** Collapse to a single call and document the behavioral difference prominently at the adapter level:

```typescript
async cancelSubscription(params: CancelSubscriptionParams): Promise<void> {
  // Pagar.me does not support cancel_at_period_end -- always cancels immediately.
  // The caller (cancel-subscription.ts) passes cancelAtPeriodEnd: true which
  // has no effect here. Consider informing the tenant of immediate cancellation.
  await this.request("DELETE", `/subscriptions/${params.providerSubscriptionId}`);
}
```

---

### WR-03: Billing history `offset` query parameter silently ignored

**File:** `packages/modules/billing/src/routes.ts:198-205`

**Issue:** The `/history` route reads `offset` from the query string (`const offset = Number(ctx.query?.offset) || 0`) but never passes it to `getBillingHistory`. The `getBillingHistory` command also does not accept an `offset` parameter. Pagination is therefore broken — requesting any page beyond the first always returns the same first page.

**Fix:** Either remove the `offset` extraction (since the command doesn't use it), or add `offset` support through to `getInvoices` on the `PaymentProvider` interface and pass it through. Stripe's `invoices.list` supports a `starting_after` cursor which is more appropriate than numeric offset, but at minimum the unused variable should be removed to avoid confusion:

```typescript
// Remove the dead offset variable:
const limit = Number(ctx.query?.limit) || 20;
const result = await getBillingHistory({ limit }, ctx.handlerCtx);
```

---

### WR-04: Webhook event ordering uses DB insertion timestamp (`event.createdAt`) instead of provider event timestamp

**File:** `packages/modules/billing/src/jobs/process-webhook.ts:59,65,68`

**Issue:** `handleSubscriptionCreated` and `handleSubscriptionUpdated` receive `event.createdAt` as `eventTime`, which is the timestamp when the row was inserted into `webhook_events` by the API process. This is a local wall-clock time, not the payment provider's event timestamp. The out-of-order protection in `handleSubscriptionUpdated` (line 164: `eventTime <= existing.lastEventAt`) compares two local DB insertion times rather than the provider-side event creation times. A stale event that arrived late but was inserted after a newer event will pass the ordering check and incorrectly overwrite the newer state.

**Fix:** Store the provider's event timestamp in `webhook_events` and use it for ordering. Add a `providerCreatedAt` column to `webhook_events`, populate it from `normalizedEvent.occurredAt` in `routes.ts`, and pass it through to the process job. Note that `occurredAt` itself is currently set to `new Date()` (see IN-02 and IN-03), so that field also needs fixing at the mapper level.

---

### WR-05: Missing Stripe key at startup only warns — inconsistent with Pagar.me validation that throws

**File:** `packages/config/src/env.ts:59-64`

**Issue:** When `PAYMENT_PROVIDER=stripe` (the default) and `STRIPE_SECRET_KEY` is absent, `validatePaymentProviderEnv()` only logs a `console.warn` and allows startup to continue. When `PAYMENT_PROVIDER=pagarme` and `PAGARME_SECRET_KEY` is absent, it throws and prevents startup. This asymmetry means a production deployment with `PAYMENT_PROVIDER=stripe` (default) and no `STRIPE_SECRET_KEY` will start successfully but fail on first billing operation with a cryptic error.

**Fix:** Throw for both cases:

```typescript
if (provider === "stripe" && !env.STRIPE_SECRET_KEY) {
  throw new Error(
    "STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe. " +
      "Set STRIPE_SECRET_KEY in your environment.",
  );
}
```

If test environments need to run without Stripe, detect them via `NODE_ENV === "test"` inside the check.

---

## Info

### IN-01: `on-tenant-created.ts` uses `console.log` / `console.error` instead of structured logger

**File:** `packages/modules/billing/src/hooks/on-tenant-created.ts:36,57,62`

**Issue:** The hook uses raw `console.log` and `console.error` while the rest of the backend uses `pino` for structured logging. This produces unstructured output that cannot be filtered or correlated with request context in production.

**Fix:** Import and use the module-level pino logger:

```typescript
import pino from "pino";
const logger = pino({ name: "billing:on-tenant-created" });
// Replace console.log(...) with logger.info({ tenantId }, "message")
// Replace console.error(..., err) with logger.error({ tenantId, err }, "message")
```

---

### IN-02 & IN-03: Both webhook mappers set `occurredAt: new Date()` — event timestamp is lost

**Files:**
- `packages/modules/billing/src/adapters/pagarme/pagarme-webhook-mapper.ts:56`
- `packages/modules/billing/src/adapters/stripe/stripe-webhook-mapper.ts:56`

**Issue:** Both mappers set `occurredAt: new Date()` which captures the processing time, not the payment provider's event creation time. For Stripe, the event's `created` Unix timestamp is available on the raw event object. For Pagar.me, `event.created_at` is available on the payload. Using processing time means `occurredAt` cannot be used for reliable event ordering (also see WR-04).

**Fix for Stripe mapper:**
```typescript
occurredAt: rawEvent.created ? new Date(rawEvent.created * 1000) : new Date(),
```

**Fix for Pagar.me mapper:**
```typescript
occurredAt: data?.created_at ? new Date(data.created_at) : new Date(),
```

---

### IN-04: `process-webhook.ts` job creates a new DB connection on every invocation

**File:** `packages/modules/billing/src/jobs/process-webhook.ts:35`

**Issue:** `const db = createDb(env.DATABASE_URL)` runs on every job invocation. If `createDb` does not pool connections internally (depends on postgres.js implementation), high webhook throughput will exhaust the PostgreSQL connection limit. The same pattern appears in `sync-usage.ts:21` and `on-tenant-created.ts:43`.

**Fix:** Pass a shared `db` instance via the job context or module-level initialization, similar to how `getPaymentProvider()` uses a singleton:

```typescript
// Module-level singleton
const db = createDb(env.DATABASE_URL);
export async function processWebhook(data: unknown): Promise<void> {
  // use module-level db
}
```

Note: postgres.js does pool connections by default, so this is a code quality concern more than an immediate runtime failure — but the pattern is inconsistent with how the rest of the codebase manages the DB instance.

---

_Reviewed: 2026-04-11T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
