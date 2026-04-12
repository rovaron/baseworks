---
phase: 10-payment-abstraction
status: OPEN_THREATS
threats_total: 10
threats_closed: 7
threats_open: 3
asvs_level: L1
audited: 2026-04-11
auditor: gsd-secure-phase (claude-sonnet-4-6)
---

# Phase 10: Payment Abstraction — Security Verification Report

**Phase:** 10 — payment-abstraction
**ASVS Level:** L1
**Audit Date:** 2026-04-11
**Threats Closed:** 7/10
**Threats Open:** 3/10

---

## Threat Verification

### CLOSED Threats

| Threat ID | Category | Disposition | Verdict | Evidence |
|-----------|----------|-------------|---------|----------|
| T-10-01 | Tampering | accept | CLOSED | See Accepted Risks section. Migration file exists with non-destructive RENAME COLUMN statements only. `packages/db/migrations/0001_rename_stripe_to_provider.sql:5-10` |
| T-10-02 | Spoofing | mitigate | CLOSED | `stripe-adapter.ts:148-158` — `this.stripe.webhooks.constructEvent(params.rawBody, params.signature, this.webhookSecret)`. SDK-managed verification; throws on invalid signature; caller catches and returns 400 at `routes.ts:66-71` |
| T-10-03 | Tampering | mitigate | CLOSED | DB idempotency check at `routes.ts:79-86` — selects from `webhookEvents` by `providerEventId` and returns early if found. BullMQ jobId dedup at `routes.ts:105` — `{ jobId: normalizedEvent.providerEventId }` |
| T-10-04 | Tampering | mitigate | CLOSED | `process-webhook.ts:158-169` — `handleSubscriptionUpdated` queries `existing.lastEventAt` and skips if `eventTime <= existing.lastEventAt`. Pattern confirmed present and active |
| T-10-05 | Information Disclosure | mitigate | CLOSED | `stripe-adapter.ts:39-43` — secret keys stored in `this.stripe` (SDK instance) and `this.webhookSecret` (private field), not logged. `pagarme-adapter.ts:39,56` — secret key used only in `Authorization` header construction inside private `request()`. No log statement references either key across both adapter files |
| T-10-08 | Information Disclosure | mitigate | CLOSED | `pagarme-adapter.ts:56` — key is base64-encoded as Basic Auth header value inside the private `request()` method. No `console.log`, `logger`, or string interpolation of `this.config.secretKey` found in the file |
| T-10-10 | Tampering | accept | CLOSED | See Accepted Risks section. `provider-factory.ts:19` — `let providerInstance: PaymentProvider | null = null` is module-level singleton. No mutation endpoint exists in routes or any public API |

---

### OPEN Threats

#### T-10-06 — Elevation of Privilege — Cross-tenant billing — OPEN (PARTIAL)

**Declared mitigation:** All commands scoped to `ctx.tenantId` (existing pattern preserved).

**Verification:** Tenant-scoped commands themselves use `ctx.tenantId` correctly. However, `on-tenant-created.ts:35` contains the following guard:

```typescript
if (!env.STRIPE_SECRET_KEY) {
```

When `PAYMENT_PROVIDER=pagarme`, this condition is `true` (Stripe key is absent by design), so the hook silently returns without creating any billing customer record for the new tenant. All subsequent billing commands for that tenant will fail to find a `billingCustomers` row and will be unable to scope billing to the tenant. The hook does not check the active provider's key — it hardcodes a Stripe-specific check regardless of `env.PAYMENT_PROVIDER`.

**Impact:** Every tenant created while `PAYMENT_PROVIDER=pagarme` has no `billing_customers` row. This means subsequent operations in commands (checkout, cancel, etc.) that look up `billingCustomers` by `tenantId` will return no customer and execute no billing. Elevated-privilege operations (e.g., billing for a different tenant) are not possible, but correct tenant billing isolation is broken for Pagar.me deployments.

**Status:** OPEN — mitigation pattern is present for Stripe but absent for Pagar.me. Matches code review finding CR-03.

**Files searched:** `packages/modules/billing/src/hooks/on-tenant-created.ts:35`

---

#### T-10-07 — Spoofing — Pagar.me webhook verification — OPEN (CRITICAL)

**Declared mitigation:** HMAC-SHA256 signature verification using `crypto.timingSafeEqual` — never simple string comparison (timing attack).

**Verification — finding 1 (dead code path for timingSafeEqual):**

`pagarme-adapter.ts:244-274` contains the following condition:

```typescript
if (
  expectedBuffer.byteLength !== receivedBuffer.byteLength ||
  !crypto.subtle.timingSafeEqual
) {
```

`crypto.subtle` is the Web Crypto API SubtleCrypto object. `timingSafeEqual` is a method on the Node.js `crypto` module, not on `crypto.subtle`. `crypto.subtle.timingSafeEqual` is always `undefined`, making `!crypto.subtle.timingSafeEqual` always `true`. The `else` branch at lines 263-274 (the branch that calls `node:crypto`'s `timingSafeEqual`) is **unreachable dead code**. Every execution falls through to the manual loop at lines 248-261.

The fallback loop is structured correctly for constant-time comparison (no early-return on mismatch), so signatures are not vulnerable to a timing attack via the loop logic itself. However:
- The intent (use Node's native `timingSafeEqual`) is never fulfilled.
- The declared mitigation — "crypto.timingSafeEqual" — is never invoked.
- The fallback operates on UTF-8-encoded hex strings (`encoder.encode(hexString)`) rather than raw bytes, which adds an encoding step not present in the declared design.

**Verification — finding 2 (webhook signature never provided for Pagar.me):**

`routes.ts:52-55`:

```typescript
const sig =
  ctx.request.headers.get("stripe-signature") ||
  ctx.request.headers.get("x-hub-signature") ||
  "";
```

Pagar.me sends webhook signatures in a header named `x-pagarme-signature` (or similar provider-specific header). Neither `stripe-signature` nor `x-hub-signature` will be present in a Pagar.me webhook request. The `sig` variable will always be an empty string for Pagar.me requests. The route then immediately returns `400 "Missing webhook signature header"` at line 57-59.

**Result:** Pagar.me webhook signature verification is **never invoked**. All Pagar.me webhooks are rejected at the header-check stage before reaching `verifyWebhookSignature`. T-10-07's declared mitigation — timing-safe HMAC comparison — is unreachable for two independent reasons.

**Status:** OPEN (CRITICAL) — Matches code review findings CR-01 and CR-02.

**Files searched:** `packages/modules/billing/src/adapters/pagarme/pagarme-adapter.ts:244-274`, `packages/modules/billing/src/routes.ts:52-55`

---

#### T-10-09 — Denial of Service — Missing env validation — OPEN (PARTIAL)

**Declared mitigation:** Zod superRefine enforces PAGARME_SECRET_KEY when PAYMENT_PROVIDER=pagarme. validatePaymentProviderEnv() wired into index.ts and worker.ts at startup.

**Verification — wiring (CLOSED):**

- `apps/api/src/index.ts:1,22` — imports `validatePaymentProviderEnv` from `@baseworks/config` and calls it before module registry creation. Confirmed present.
- `apps/api/src/worker.ts:1,15` — imports `validatePaymentProviderEnv` and calls it after `assertRedisUrl` and before DB init. Confirmed present.

**Verification — function behavior for Stripe (GAP):**

`packages/config/src/env.ts:59-64`:

```typescript
if (provider === "stripe" && !env.STRIPE_SECRET_KEY) {
  console.warn(
    "[env] WARNING: STRIPE_SECRET_KEY is not set. Billing operations will fail.",
  );
}
```

When `PAYMENT_PROVIDER=stripe` (the default — covers the vast majority of deployments) and `STRIPE_SECRET_KEY` is absent, the function logs a warning and **allows startup to proceed**. The application starts, accepts traffic, and fails only on the first billing operation with a runtime error rather than a startup error. The DoS vector (service starts but billing is broken) remains open for the default provider.

The Pagar.me path correctly throws (line 52-57), but the Stripe path (default) only warns.

**Note:** This gap was previously flagged as WR-05 in the code review. The wiring itself (index.ts and worker.ts) is present and correct. The function's behavior for the default Stripe case does not satisfy the declared fail-fast intent of T-10-09.

**Status:** OPEN (Pagar.me branch: CLOSED via throw; Stripe branch: OPEN via warn-only).

**Files searched:** `packages/config/src/env.ts:49-65`, `apps/api/src/index.ts:1,22`, `apps/api/src/worker.ts:1,15`

---

## Accepted Risks

### T-10-01 — Tampering — DB Migration Column Rename

**Disposition:** accept

**Rationale:** The migration at `packages/db/migrations/0001_rename_stripe_to_provider.sql` uses only `ALTER TABLE ... RENAME COLUMN` statements. No data is dropped, transformed, or rewritten. The migration was declared as non-destructive in the plan and confirmed as such by inspection. The migration must be reviewed before application to production databases, which is the standard operational control applied here.

**Residual risk:** Negligible. A rename that fails mid-transaction rolls back automatically. No data loss vector exists.

---

### T-10-10 — Tampering — Provider Switch at Runtime

**Disposition:** accept

**Rationale:** `provider-factory.ts:19` declares `providerInstance` as a module-level `let` initialized to `null`. Once set by `getPaymentProvider()`, it is never reassigned by application code (only by test helpers `resetPaymentProvider` and `setPaymentProvider` which are not reachable from HTTP routes). No API endpoint, event handler, or scheduled job can trigger a provider switch at runtime. Switching providers requires a process restart, which is an acceptable operational constraint for a SaaS platform.

**Residual risk:** Negligible in production. The test helpers could become an attack surface if accidentally exposed through a route, but no such exposure exists.

---

## Unregistered Threat Flags

No `## Threat Flags` section was present in any SUMMARY.md for this phase. No unregistered flags to report.

---

## Audit Trail

| Date | Auditor | Action | Result |
|------|---------|--------|--------|
| 2026-04-11 | gsd-secure-phase (claude-sonnet-4-6) | Initial security verification of Phase 10 (plans 01-04) | 7 CLOSED, 3 OPEN |

### Files Inspected

- `.planning/phases/10-payment-abstraction/10-01-PLAN.md`
- `.planning/phases/10-payment-abstraction/10-02-PLAN.md`
- `.planning/phases/10-payment-abstraction/10-03-PLAN.md`
- `.planning/phases/10-payment-abstraction/10-04-PLAN.md`
- `.planning/phases/10-payment-abstraction/10-01-SUMMARY.md`
- `.planning/phases/10-payment-abstraction/10-02-SUMMARY.md`
- `.planning/phases/10-payment-abstraction/10-03-SUMMARY.md`
- `.planning/phases/10-payment-abstraction/10-04-SUMMARY.md`
- `.planning/phases/10-payment-abstraction/10-REVIEW.md`
- `packages/modules/billing/src/ports/payment-provider.ts`
- `packages/modules/billing/src/adapters/stripe/stripe-adapter.ts`
- `packages/modules/billing/src/adapters/stripe/stripe-webhook-mapper.ts`
- `packages/modules/billing/src/adapters/pagarme/pagarme-adapter.ts`
- `packages/modules/billing/src/adapters/pagarme/pagarme-webhook-mapper.ts`
- `packages/modules/billing/src/routes.ts`
- `packages/modules/billing/src/jobs/process-webhook.ts`
- `packages/modules/billing/src/provider-factory.ts`
- `packages/modules/billing/src/hooks/on-tenant-created.ts`
- `packages/config/src/env.ts`
- `apps/api/src/index.ts`
- `apps/api/src/worker.ts`
- `packages/db/migrations/0001_rename_stripe_to_provider.sql`
