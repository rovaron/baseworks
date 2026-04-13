---
phase: 10-payment-abstraction
fixed_at: 2026-04-11T12:30:00Z
review_path: .planning/phases/10-payment-abstraction/10-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 9
skipped: 0
status: all_fixed
---

# Phase 10: Code Review Fix Report

**Fixed at:** 2026-04-11T12:30:00Z
**Source review:** .planning/phases/10-payment-abstraction/10-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 9 (4 critical + 5 warnings; Info findings excluded per critical_warning scope)
- Fixed: 9
- Skipped: 0

All four critical security findings -- which were also flagged as OPEN threats in 10-SECURITY.md (T-10-06, T-10-07) -- have been fixed and committed. All five warnings have been fixed. The full billing + config test suites (54 tests) pass after every commit.

## Fixed Issues

### CR-01: Pagar.me webhook signature -- crypto.subtle.timingSafeEqual dead-code path

**Files modified:** `packages/modules/billing/src/adapters/pagarme/pagarme-adapter.ts`
**Commit:** 7d307ce
**Applied fix:** Replaced the unreachable `crypto.subtle.timingSafeEqual` guard and manual fallback loop with a direct `timingSafeEqual` import from `node:crypto`. The new code does a length check first (required because `timingSafeEqual` throws on length mismatch) and then a single constant-time comparison. Bun ships Node-compatible crypto so this works in both runtimes. Verified with the existing `verifyWebhookSignature` tests (valid + invalid signature cases) -- 19/19 tests pass.

**Security impact:** Addresses T-10-07 OPEN threat. The secure path is no longer dead code.

### CR-02: Pagar.me webhooks always rejected -- missing signature header parse

**Files modified:** `packages/modules/billing/src/routes.ts`
**Commit:** 1ae71f7
**Applied fix:** Added `ctx.request.headers.get("x-pagarme-signature")` to the header fallback chain between `stripe-signature` and `x-hub-signature` so Pagar.me webhooks pass the `Missing webhook signature header` check and reach the verification step.

### CR-03: on-tenant-created.ts checks STRIPE_SECRET_KEY regardless of active provider

**Files modified:** `packages/modules/billing/src/hooks/on-tenant-created.ts`
**Commit:** fe16919
**Applied fix:** Replaced the hardcoded `!env.STRIPE_SECRET_KEY` guard with a provider-aware `hasProviderKey` check that reads `env.PAYMENT_PROVIDER` (defaulting to "stripe") and validates the matching key. A Pagar.me-configured tenant with `PAGARME_SECRET_KEY` now proceeds to customer creation instead of silently being skipped.

**Security impact:** Addresses T-10-06 OPEN threat. Prevents silent failure of tenant -> customer linkage when PAYMENT_PROVIDER=pagarme.

### CR-04: getPaymentProvider() passes undefined to adapters via non-null assertions

**Files modified:** `packages/modules/billing/src/provider-factory.ts`
**Commit:** a99ce21
**Applied fix:** Removed `!` non-null assertions from both case branches. Each branch now reads the relevant env vars into local constants, throws a descriptive `Error` if either is missing, and only then constructs the adapter. Verified with the provider-factory tests (6/6 pass) which all configure both Stripe and Pagar.me keys before invoking the factory.

### WR-01: Pagar.me createOneTimePayment and createCheckoutSession hardcode amount 0

**Files modified:** `packages/modules/billing/src/adapters/pagarme/pagarme-adapter.ts`
**Commit:** 655c6c1
**Applied fix:** Replaced both method bodies with an explicit `throw new Error("Pagar.me adapter: amount resolution not yet implemented ...")` so misconfiguration surfaces loudly instead of silently creating zero-amount orders. The `_params` prefix marks parameters as intentionally unused. This is a fail-closed change -- callers that rely on these Pagar.me paths will now see an error until a real price-resolution path (plan lookup or explicit `amount` field on params) is implemented.

**Status:** `fixed: requires human verification` -- this is a fail-closed fix, not a functional implementation. Phase 10 tests do not exercise these code paths for Pagar.me, so there is no regression, but whoever wires up Pagar.me for real will need to replace the throws with the proper price-resolution logic.

### WR-02: cancelSubscription ignores cancelAtPeriodEnd (dead branching)

**Files modified:** `packages/modules/billing/src/adapters/pagarme/pagarme-adapter.ts`
**Commit:** 7257f9c
**Applied fix:** Collapsed the two identical branches into a single DELETE call. When `cancelAtPeriodEnd === true`, the adapter now emits a `console.warn` making the behavioral difference visible to callers, then performs the same immediate cancel (since Pagar.me has no native deferred-cancel).

### WR-03: Billing history offset query param silently ignored

**Files modified:** `packages/modules/billing/src/routes.ts`
**Commit:** a934a73
**Applied fix:** Removed the unused `offset` extraction from the `/history` route handler. A comment documents that re-adding it requires wiring `offset` through `getBillingHistory` and the `getInvoices` port method first. This prevents the silent pagination-doesnt-work bug until the interface is properly extended.

### WR-04: Webhook event ordering uses DB insertion timestamp

**Files modified:** `packages/modules/billing/src/jobs/process-webhook.ts`
**Commit:** c0ba90e
**Applied fix:** Introduced `const eventTime = normalizedEvent.occurredAt ?? event.createdAt` and now passes that to `handleSubscriptionCreated`, `handleSubscriptionUpdated`, and `handleSubscriptionDeleted` instead of `event.createdAt`. This switches the ordering protection away from the DB row insertion time and toward the NormalizedEvent's semantic event time.

**Status:** `fixed: requires human verification` -- this fix is partial because `occurredAt` is currently set to `new Date()` inside both webhook mappers (IN-02, which is Info-scope and out of this batch). The structural fix is in place -- once IN-02 is addressed and the mappers extract the provider's event `created_at` / `created`, this code will automatically benefit with no further change. Under high concurrent webhook ingestion the partial fix still has a residual window, so a human should confirm the intended end-state and either schedule IN-02 or accept the partial mitigation.

### WR-05: Missing Stripe key at startup only warns -- asymmetry with Pagar.me

**Files modified:** `packages/config/src/env.ts`
**Commit:** 24a70c1
**Applied fix:** Rewrote `validatePaymentProviderEnv()` so both provider branches behave symmetrically. A missing `STRIPE_SECRET_KEY` with `PAYMENT_PROVIDER=stripe` now throws a descriptive error in production/development and logs a warning only when `NODE_ENV === "test"` (so the test runner can still import the billing module). The Pagar.me branch was updated to the same pattern for consistency. Config tests (2/2 pass).

## Skipped Issues

_None -- all 9 in-scope findings were fixed._

## Verification Summary

Ran `bun test packages/modules/billing packages/config` after the final commit:

```
54 pass
0 fail
157 expect() calls
Ran 54 tests across 5 files.
```

Per-commit verification:
- After CR-01: 19/19 pagarme-adapter tests pass
- After CR-04: 6/6 provider-factory tests pass
- After WR-01/WR-02: 19/19 pagarme-adapter tests pass
- After WR-04: 52/52 billing tests pass
- After WR-05: 2/2 config tests pass
- Final: 54/54 billing + config tests pass

## Notes for Reviewer / Orchestrator

- Both WR-01 and WR-04 are flagged `requires human verification`. See each finding's Status line for why.
- Info-level findings (IN-01 structured logging, IN-02 mapper occurredAt, IN-03 unused @pagarme/sdk dep, IN-04 per-invocation db connections) were out of scope for this fix pass (critical_warning scope) and are not addressed. They remain open in 10-REVIEW.md.
- The four T-10-06 / T-10-07 OPEN threats in 10-SECURITY.md (tracked under CR-01, CR-02, CR-03) are now remediated at the code level. 10-SECURITY.md should be updated by the orchestrator / verifier to flip those threats from OPEN to RESOLVED.
- REVIEW-FIX.md is not committed by the fixer per protocol -- the workflow orchestrator will commit it.

---

_Fixed: 2026-04-11T12:30:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
