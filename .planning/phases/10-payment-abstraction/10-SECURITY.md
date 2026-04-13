---
phase: 10-payment-abstraction
status: secured
threats_total: 10
threats_closed: 10
threats_open: 0
asvs_level: L1
audited: 2026-04-11
last_reverified: 2026-04-12
auditor: gsd-secure-phase (claude-sonnet-4-6)
---

# Phase 10: Payment Abstraction — Security Verification Report

**Phase:** 10 — payment-abstraction
**ASVS Level:** L1
**Audit Date:** 2026-04-11
**Re-verification Date:** 2026-04-12
**Threats Closed:** 10/10
**Threats Open:** 0/10

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
| T-10-06 | Elevation of Privilege | mitigate | CLOSED | commit fe16919 — `on-tenant-created.ts:36-39`: hardcoded `!env.STRIPE_SECRET_KEY` guard replaced with provider-aware `hasProviderKey` check covering both stripe and pagarme branches |
| T-10-07 | Spoofing | mitigate | CLOSED | commit 7d307ce — `pagarme-adapter.ts:198`: `timingSafeEqual` imported from `node:crypto`, dead-code path removed; commit 1ae71f7 — `routes.ts:54`: `x-pagarme-signature` added to header fallback chain |
| T-10-08 | Information Disclosure | mitigate | CLOSED | `pagarme-adapter.ts:56` — key is base64-encoded as Basic Auth header value inside the private `request()` method. No `console.log`, `logger`, or string interpolation of `this.config.secretKey` found in the file |
| T-10-09 | Denial of Service | mitigate | CLOSED | commit 24a70c1 — `env.ts:70-83`: Stripe branch now throws (not warns) when `STRIPE_SECRET_KEY` missing outside `NODE_ENV=test`; symmetric with Pagar.me branch |
| T-10-10 | Tampering | accept | CLOSED | See Accepted Risks section. `provider-factory.ts:19` — `let providerInstance: PaymentProvider | null = null` is module-level singleton. No mutation endpoint exists in routes or any public API |

---

### Previously Open — Now CLOSED

#### T-10-06 — Elevation of Privilege — Cross-tenant billing — CLOSED (commit fe16919)

**Declared mitigation:** All commands scoped to `ctx.tenantId` (existing pattern preserved).

**Re-verification (2026-04-12):**

`on-tenant-created.ts:36-39` now contains a provider-aware guard:

```typescript
const providerName = env.PAYMENT_PROVIDER ?? "stripe";
const hasProviderKey =
  (providerName === "stripe" && !!env.STRIPE_SECRET_KEY) ||
  (providerName === "pagarme" && !!env.PAGARME_SECRET_KEY);
```

The hardcoded `!env.STRIPE_SECRET_KEY` check (prior gap) has been replaced. When `PAYMENT_PROVIDER=pagarme`, the hook checks `PAGARME_SECRET_KEY` and proceeds to customer creation if present. Tenant-to-provider-customer linkage is now correctly established for both providers.

**Status:** CLOSED — commit fe16919, `packages/modules/billing/src/hooks/on-tenant-created.ts:36-39`

---

#### T-10-07 — Spoofing — Pagar.me webhook verification — CLOSED (commits 7d307ce, 1ae71f7)

**Declared mitigation:** HMAC-SHA256 signature verification using `crypto.timingSafeEqual` — never simple string comparison (timing attack).

**Re-verification — CR-01 (dead-code path, commit 7d307ce):**

`pagarme-adapter.ts:198-227` has been rewritten. The unreachable `crypto.subtle.timingSafeEqual` guard and manual fallback loop are gone. The new code imports `timingSafeEqual` directly from `node:crypto` at line 198:

```typescript
const { timingSafeEqual } = await import("node:crypto");
```

HMAC-SHA256 is computed via `crypto.subtle` (Web Crypto API), the expected signature hex string is built at line 214-216, then `Buffer.from(expectedSignature)` and `Buffer.from(params.signature)` are compared with a length check at line 222-225 followed by a direct `timingSafeEqual` call. The secure path is no longer dead code.

**Re-verification — CR-02 (missing header, commit 1ae71f7):**

`routes.ts:52-56` now includes `x-pagarme-signature` in the fallback chain:

```typescript
const sig =
  ctx.request.headers.get("stripe-signature") ||
  ctx.request.headers.get("x-pagarme-signature") ||
  ctx.request.headers.get("x-hub-signature") ||
  "";
```

Pagar.me webhook requests will now pass the header presence check and reach `verifyWebhookSignature` rather than being rejected with 400 at line 58-60.

**Status:** CLOSED — CR-01 commit 7d307ce `pagarme-adapter.ts:198-227`; CR-02 commit 1ae71f7 `routes.ts:54`

---

#### T-10-09 — Denial of Service — Missing env validation — CLOSED (commit 24a70c1)

**Declared mitigation:** validatePaymentProviderEnv() throws on missing provider key at startup. Wired into index.ts and worker.ts.

**Re-verification (2026-04-12):**

`packages/config/src/env.ts:70-83` now throws symmetrically for the Stripe branch outside test environments:

```typescript
if (provider === "stripe" && !env.STRIPE_SECRET_KEY) {
  if (isTest) {
    console.warn("[env] WARNING: STRIPE_SECRET_KEY is not set (NODE_ENV=test).");
  } else {
    throw new Error(
      "STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe. " +
        "Set STRIPE_SECRET_KEY in your environment.",
    );
  }
}
```

The prior warn-only path has been replaced with a throw. Both the Stripe and Pagar.me branches now use an identical throw/warn-in-test pattern (`isTest` check at line 55). Startup with a missing provider key in production or development will terminate with a descriptive error before accepting any traffic.

**Status:** CLOSED — commit 24a70c1, `packages/config/src/env.ts:70-83`

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
| 2026-04-12 | gsd-secure-phase (claude-sonnet-4-6) | Re-verification of 3 OPEN threats after commits 7d307ce, 1ae71f7, fe16919, 24a70c1 | 10 CLOSED, 0 OPEN — status upgraded to SECURED |

#### Re-verification Detail (2026-04-12)

| Threat ID | Fix Commit(s) | Verification Method | Finding |
|-----------|---------------|---------------------|---------|
| T-10-07 (CR-01) | 7d307ce | Read `pagarme-adapter.ts:198-227` | `timingSafeEqual` imported from `node:crypto` at line 198; length check at lines 222-223; direct `timingSafeEqual(expectedBuf, receivedBuf)` call at line 224. Dead-code path confirmed removed. CLOSED. |
| T-10-07 (CR-02) | 1ae71f7 | Read `routes.ts:52-56` | `x-pagarme-signature` present in header fallback chain at line 54, between `stripe-signature` and `x-hub-signature`. Pagar.me requests now reach `verifyWebhookSignature`. CLOSED. |
| T-10-06 (CR-03) | fe16919 | Read `on-tenant-created.ts:36-39` | `hasProviderKey` evaluates `PAGARME_SECRET_KEY` when `PAYMENT_PROVIDER=pagarme`. Hardcoded `!env.STRIPE_SECRET_KEY` check confirmed absent. CLOSED. |
| T-10-09 (WR-05) | 24a70c1 | Read `env.ts:70-83` | Stripe branch throws `Error` when `STRIPE_SECRET_KEY` missing and `NODE_ENV !== "test"`. Symmetric with Pagar.me branch at lines 57-68. Warn-only path confirmed absent. CLOSED. |

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
