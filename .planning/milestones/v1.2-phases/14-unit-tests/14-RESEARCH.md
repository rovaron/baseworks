# Phase 14: Unit Tests - Research

**Researched:** 2026-04-16
**Domain:** Unit testing CQRS handlers, payment adapters, and core infrastructure with bun:test
**Confidence:** HIGH

## Summary

Phase 14 adds behavioral unit tests for all 22 CQRS handlers (8 auth commands, 6 auth queries, 6 billing commands, 2 billing queries), a Stripe adapter conformance test mirroring the existing Pagarme adapter test suite, expanded scoped-db/core infrastructure edge case tests, and config validation tests. The project already has 20 test files using `bun:test` and `bun:mock` with well-established patterns for module mocking and dynamic imports.

The primary challenge is that auth handlers delegate to `auth.api.*` (better-auth) while billing handlers use `ctx.db` (scoped-db) plus `getPaymentProvider()`. These require two distinct mock strategies: auth handlers need `mock.module("../auth")` to intercept better-auth calls, while billing handlers need a mock db object with chainable Drizzle-like query builders plus `setPaymentProvider()` for injecting a mock PaymentProvider.

**Primary recommendation:** Use a shared `createMockContext()` factory that returns a typed HandlerContext with stub db/emit/enqueue, then import handlers directly (not through the module index) to test them in isolation. Auth handlers additionally need `mock.module()` to intercept the `auth` singleton. Billing handlers should use `setPaymentProvider()` (already exported) to inject mocks.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Create a shared `createMockContext()` factory in a test helper file that returns a fully typed HandlerContext with mock db, emit, and session. Each test customizes only what it needs via overrides.
- **D-02:** The mock factory lives in a shared test utilities location accessible to all module test files.
- **D-03:** Each handler gets ~3 tests: 1 success path + 1-2 key error/validation cases. Target ~70 total handler tests, aiming for 80%+ handler coverage.
- **D-04:** Core infrastructure and scoped-db edge case tests can go deeper since those are shared foundations.
- **D-05:** Stripe adapter tests mirror the exact structure and test cases of `pagarme-adapter.test.ts`, adapted for Stripe API shapes.
- **D-06:** One test file per handler (e.g., `create-tenant.test.ts`). Maximum isolation and discoverability.
- **D-07:** Adapter tests keep their own files (already: `pagarme-adapter.test.ts`, new: `stripe-adapter.test.ts`).
- **D-08:** Replace existing registration-style tests with behavioral tests. Delete old registration-only test files.

### Claude's Discretion
- Test data factory design (createTestTenant, createTestUser helpers)
- Result assertion helpers (assertResultOk/assertResultErr)
- Exact mock shapes for external dependencies (Stripe SDK, better-auth session)
- Whether to extract common mock.module() setup into a shared fixture

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEST-01 | Auth command handler unit tests (8 handlers) | Mock strategy for auth.api documented; all 8 handler signatures analyzed |
| TEST-02 | Auth query handler unit tests (6 handlers) | Same auth.api mock pattern; get-profile also needs direct db mock |
| TEST-03 | Billing command handler unit tests (6 handlers) | Mock db builder pattern + setPaymentProvider() documented |
| TEST-04 | Billing query handler unit tests (2 handlers) | Same billing mock pattern; simpler (read-only) |
| TEST-05 | Stripe adapter conformance test parity | Pagarme test structure analyzed (10 tests); Stripe adapter methods mapped 1:1 |
| TEST-06 | Scoped-db edge case tests | Existing integration tests documented; edge cases identified (empty tenant, type coercion) |
| TEST-07 | Core infrastructure test expansion | CqrsBus, EventBus, Registry patterns analyzed; edge cases listed |
| TEST-08 | Config/env validation tests | Existing subprocess-based tests documented; validatePaymentProviderEnv() and assertRedisUrl() need tests |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| bun:test | built-in | Test runner | Already established across 20 test files; `describe/test/expect` API [VERIFIED: codebase] |
| bun:mock | built-in | Mocking | `mock()`, `mock.module()`, `spyOn()` already used throughout [VERIFIED: codebase] |

### Supporting
No additional libraries needed. The existing test infrastructure is complete.

**Installation:** None required. `bun:test` and `bun:mock` are built-in.

## Architecture Patterns

### Handler Test Structure (Two Categories)

**Category A: Auth handlers** -- delegate to `auth.api.*` singleton.

Auth handlers import `auth` from `"../auth"` which is a `betterAuth()` instance. To unit test these, you must intercept the `auth` module before importing the handler.

```typescript
// Source: Codebase analysis of auth/commands/create-tenant.ts
import { describe, test, expect, mock } from "bun:test";

// Must mock the auth module BEFORE importing the handler
mock.module("../auth", () => ({
  auth: {
    api: {
      createOrganization: mock(() => Promise.resolve({ id: "org-1", name: "Test", slug: "test" })),
      // Add other auth.api methods as needed per handler
    },
  },
}));

// Dynamic import AFTER mock setup
const { createTenant } = await import("../commands/create-tenant");

// Use shared mock context factory
const ctx = createMockContext({ userId: "user-1", tenantId: "tenant-1" });

describe("createTenant", () => {
  test("creates tenant and emits event on success", async () => {
    const result = await createTenant({ name: "My Org" }, ctx);
    expect(result.success).toBe(true);
    expect(ctx.emit).toHaveBeenCalledWith("tenant.created", expect.objectContaining({ tenantId: "org-1" }));
  });
});
```

**Category B: Billing handlers** -- use `ctx.db` (scoped-db chainable API) + `getPaymentProvider()`.

Billing handlers query `ctx.db.select().from(table).where(...).limit(1)` and call provider methods. The mock db needs to return chainable objects. The provider can be injected via the existing `setPaymentProvider()` export.

```typescript
// Source: Codebase analysis of billing/commands/create-checkout-session.ts
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { setPaymentProvider, resetPaymentProvider } from "../provider-factory";

// Mock config to prevent env validation crash
mock.module("@baseworks/config", () => ({
  env: { DATABASE_URL: "postgres://test@localhost/test", NODE_ENV: "test" },
}));

// Mock the Stripe SDK to prevent constructor crash
mock.module("stripe", () => ({ default: class MockStripe {} }));

const { createCheckoutSession } = await import("../commands/create-checkout-session");

describe("createCheckoutSession", () => {
  beforeEach(() => resetPaymentProvider());

  test("returns error when no billing customer exists", async () => {
    const ctx = createMockContext({
      db: mockDb({ select: [] }), // returns empty array
    });
    const result = await createCheckoutSession(
      { priceId: "price_1", successUrl: "https://x.co/ok", cancelUrl: "https://x.co/cancel" },
      ctx,
    );
    expect(result).toEqual({ success: false, error: "BILLING_NOT_CONFIGURED" });
  });
});
```

### Recommended Mock Context Factory

```typescript
// packages/modules/__test-utils__/mock-context.ts
import { mock } from "bun:mock";
import type { HandlerContext } from "@baseworks/shared";

/**
 * Create a mock HandlerContext with sensible defaults.
 * Each test can override specific fields.
 */
export function createMockContext(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    tenantId: "test-tenant-id",
    userId: "test-user-id",
    db: createMockDb(),
    emit: mock(() => {}),
    enqueue: mock(() => Promise.resolve()),
    ...overrides,
  };
}

/**
 * Create a mock db that mimics ScopedDb's chainable API.
 * Override return values per test via the `results` parameter.
 */
export function createMockDb(results: { select?: any[]; insert?: any[]; update?: any; delete?: any } = {}) {
  const selectResult = results.select ?? [];
  return {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => Promise.resolve(selectResult)),
        })),
      })),
    })),
    insert: mock(() => ({
      values: mock(() => Promise.resolve(results.insert ?? [])),
    })),
    update: mock(() => ({
      set: mock(() => Promise.resolve(results.update ?? {})),
    })),
    delete: mock(() => Promise.resolve(results.delete)),
    tenantId: "test-tenant-id",
    raw: {},
  };
}
```

### Recommended Result Assertion Helpers

```typescript
// packages/modules/__test-utils__/assert-result.ts
import { expect } from "bun:test";
import type { Result } from "@baseworks/shared";

export function assertResultOk<T>(result: Result<T>): asserts result is { success: true; data: T } {
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(`Expected success but got error: ${result.error}`);
}

export function assertResultErr(result: Result<unknown>, expectedError?: string): void {
  expect(result.success).toBe(false);
  if (!result.success && expectedError) {
    expect(result.error).toContain(expectedError);
  }
}
```

### Mock PaymentProvider Factory

```typescript
// packages/modules/__test-utils__/mock-payment-provider.ts
import { mock } from "bun:mock";
import type { PaymentProvider } from "../billing/src/ports/payment-provider";

export function createMockPaymentProvider(overrides: Partial<PaymentProvider> = {}): PaymentProvider {
  return {
    name: "mock",
    createCustomer: mock(() => Promise.resolve({ providerCustomerId: "cus_mock" })),
    createSubscription: mock(() => Promise.resolve({ providerSubscriptionId: "sub_mock", status: "active", priceId: "price_mock", currentPeriodEnd: new Date() })),
    cancelSubscription: mock(() => Promise.resolve()),
    changeSubscription: mock(() => Promise.resolve({ providerSubscriptionId: "sub_mock", status: "active", priceId: "price_new", currentPeriodEnd: new Date() })),
    getSubscription: mock(() => Promise.resolve(null)),
    createOneTimePayment: mock(() => Promise.resolve({ sessionId: "sess_mock", url: "https://mock.co/checkout" })),
    createCheckoutSession: mock(() => Promise.resolve({ sessionId: "sess_mock", url: "https://mock.co/checkout" })),
    createPortalSession: mock(() => Promise.resolve({ url: "https://mock.co/portal" })),
    verifyWebhookSignature: mock(() => Promise.resolve({ id: "evt_mock", type: "test", data: {} })),
    normalizeEvent: mock(() => ({ type: "checkout.completed" as any, providerEventId: "evt_mock", providerCustomerId: "cus_mock", data: {}, occurredAt: new Date(), raw: {} as any })),
    getInvoices: mock(() => Promise.resolve([])),
    reportUsage: mock(() => Promise.resolve({ providerUsageRecordId: "ur_mock" })),
    ...overrides,
  };
}
```

### Recommended Project Structure for New Test Files

```
packages/modules/
  __test-utils__/              # Shared test utilities (D-02)
    mock-context.ts            # createMockContext(), createMockDb()
    assert-result.ts           # assertResultOk(), assertResultErr()
    mock-payment-provider.ts   # createMockPaymentProvider()
  auth/src/__tests__/
    create-tenant.test.ts      # NEW (replaces tenant-crud.test.ts)
    update-tenant.test.ts      # NEW
    delete-tenant.test.ts      # NEW
    update-profile.test.ts     # NEW
    create-invitation.test.ts  # NEW (replaces invitation.test.ts)
    accept-invitation.test.ts  # NEW
    cancel-invitation.test.ts  # NEW
    reject-invitation.test.ts  # NEW
    get-tenant.test.ts         # NEW
    list-tenants.test.ts       # NEW
    get-profile.test.ts        # NEW
    list-members.test.ts       # NEW
    get-invitation.test.ts     # NEW
    list-invitations.test.ts   # NEW
    auth-setup.test.ts         # KEEP (module definition tests are not registration-only)
    tenant-crud.test.ts        # DELETE (D-08)
    invitation.test.ts         # DELETE (D-08)
    profile.test.ts            # CHECK if registration-only; delete if so
    tenant-session.test.ts     # CHECK if registration-only; delete if so
  billing/src/__tests__/
    create-checkout-session.test.ts  # NEW
    cancel-subscription.test.ts      # NEW
    change-subscription.test.ts      # NEW
    create-one-time-payment.test.ts  # NEW
    create-portal-session.test.ts    # NEW
    record-usage.test.ts             # NEW
    get-subscription-status.test.ts  # NEW
    get-billing-history.test.ts      # NEW
    stripe-adapter.test.ts           # NEW (D-05, D-07)
    billing.test.ts                  # KEEP (or replace with per-handler tests)
    pagarme-adapter.test.ts          # KEEP (reference)
    provider-factory.test.ts         # KEEP
    webhook-normalization.test.ts    # KEEP
apps/api/src/core/__tests__/
    cqrs.test.ts                     # EXPAND (D-04, TEST-07)
    event-bus.test.ts                # EXPAND (D-04, TEST-07)
    registry.test.ts                 # EXPAND (D-04, TEST-07)
packages/db/src/__tests__/
    scoped-db.test.ts                # EXPAND (D-04, TEST-06)
packages/config/src/__tests__/
    env.test.ts                      # EXPAND (TEST-08)
```

### Anti-Patterns to Avoid
- **Testing through the module index:** Import handlers directly (e.g., `from "../commands/create-tenant"`) not through `../index`. The module index triggers all module initialization which requires extensive mocking. [VERIFIED: billing.test.ts already does this and it is verbose]
- **Mocking after import:** `mock.module()` MUST be called BEFORE the `await import()` of the module that uses it. Bun resolves mocks at import time. [VERIFIED: billing.test.ts, provider-factory.test.ts patterns]
- **Shared mock state bleeding between tests:** Use `beforeEach` to reset mocks. For billing, call `resetPaymentProvider()` before each test. [VERIFIED: provider-factory.test.ts]
- **Testing implementation details:** Test the Result contract (success/error) and emitted events, not internal method calls. Handlers are thin wrappers; verify behavior, not structure.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Mock HandlerContext | Creating ad-hoc ctx objects in each test file | Shared `createMockContext()` factory | Consistent shape, less duplication, easy to update when HandlerContext changes |
| Mock db chainable API | Manual `{ select: () => ({ from: () => ... }) }` per test | Shared `createMockDb()` with configurable results | ScopedDb has 4-level chain; error-prone to repeat |
| Mock PaymentProvider | Inline mock objects per billing test | Shared `createMockPaymentProvider()` | 13+ methods; tedious to re-mock and maintain |
| Result assertions | `expect(result.success).toBe(true); if (result.success) expect(result.data)...` | `assertResultOk(result)` type narrowing helper | Cleaner tests, better error messages |

## Common Pitfalls

### Pitfall 1: Auth Module Import Side Effects
**What goes wrong:** Importing any auth handler triggers `import { auth } from "../auth"` which calls `betterAuth()` and `createDb(env.DATABASE_URL)`, crashing in test environments without a database.
**Why it happens:** better-auth's `betterAuth()` initializes immediately at module load time.
**How to avoid:** Use `mock.module("../auth", ...)` BEFORE the dynamic `await import()` of any auth handler. The mock replaces the `auth` object so `betterAuth()` never runs.
**Warning signs:** Errors like "DATABASE_URL is invalid" or "connection refused" during test setup.

### Pitfall 2: Billing Config Import Side Effects
**What goes wrong:** Billing modules import `@baseworks/config` which validates env vars with Zod at module load time.
**Why it happens:** `createEnv()` from `@t3-oss/env-core` runs validation immediately.
**How to avoid:** Always `mock.module("@baseworks/config", ...)` before importing billing code. Pattern is already established in `billing.test.ts`.
**Warning signs:** Zod validation errors mentioning missing DATABASE_URL.

### Pitfall 3: ScopedDb Mock Chain Depth
**What goes wrong:** Billing handlers do `ctx.db.select().from(table).where(eq(...)).limit(1)` which is a 4-level chain. Missing any level causes "is not a function" errors.
**Why it happens:** Drizzle's chainable API requires each method to return an object with the next method.
**How to avoid:** Use the `createMockDb()` factory which handles the full chain. The factory returns arrays by default (matching `.limit(1)` destructuring).
**Warning signs:** "TypeError: ctx.db.select(...).from is not a function".

### Pitfall 4: getPaymentProvider() Singleton Cache
**What goes wrong:** `getPaymentProvider()` caches the provider instance. Tests that set different provider configurations interfere with each other.
**Why it happens:** Singleton pattern in `provider-factory.ts`.
**How to avoid:** Call `resetPaymentProvider()` in `beforeEach`, then use `setPaymentProvider(mockProvider)` to inject the mock. Both are already exported from `provider-factory.ts`.
**Warning signs:** Tests pass individually but fail when run together.

### Pitfall 5: Auth Handler ctx.headers Access
**What goes wrong:** `acceptInvitation` and `rejectInvitation` access `ctx.headers ?? new Headers()`. Tests that don't include `headers` in the mock context get an empty Headers object which may not match expected behavior.
**Why it happens:** These handlers forward headers to better-auth for session resolution.
**How to avoid:** The `createMockContext()` factory should not include `headers` by default (since HandlerContext doesn't define it), but auth handler tests that use accept/reject should add it manually. Note: `headers` is not in the HandlerContext interface but is accessed via `ctx.headers` -- this is an extended property.
**Warning signs:** Tests pass but with unexpected behavior in better-auth mock calls.

### Pitfall 6: get-profile Uses Direct DB, Not ctx.db
**What goes wrong:** `get-profile.ts` creates its own `db = createDb(env.DATABASE_URL)` at module level, bypassing `ctx.db`.
**Why it happens:** Auth tables are not tenant-scoped (Pitfall 6 from codebase docs), so get-profile queries the user table directly.
**How to avoid:** Mock `@baseworks/config` and `@baseworks/db` module to intercept the `createDb` call and the `user` table import. Or mock the entire module's db connection.
**Warning signs:** "connection refused" errors specifically in get-profile tests.

## Code Examples

### Auth Command Handler Test (Complete Pattern)

```typescript
// packages/modules/auth/src/__tests__/create-tenant.test.ts
// Source: Derived from codebase patterns in billing.test.ts + handler analysis
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { createMockContext } from "../../__test-utils__/mock-context";
import { assertResultOk, assertResultErr } from "../../__test-utils__/assert-result";

const mockCreateOrganization = mock(() =>
  Promise.resolve({ id: "org-1", name: "Test Org", slug: "test-org" }),
);

mock.module("../auth", () => ({
  auth: {
    api: {
      createOrganization: mockCreateOrganization,
    },
  },
}));

const { createTenant } = await import("../commands/create-tenant");

describe("createTenant", () => {
  beforeEach(() => {
    mockCreateOrganization.mockClear();
  });

  test("creates tenant and emits tenant.created event", async () => {
    const ctx = createMockContext();
    const result = await createTenant({ name: "My Company" }, ctx);

    assertResultOk(result);
    expect(result.data).toEqual({ id: "org-1", name: "Test Org", slug: "test-org" });
    expect(ctx.emit).toHaveBeenCalledWith("tenant.created", {
      tenantId: "org-1",
      createdBy: "test-user-id",
    });
  });

  test("returns error when auth.api throws", async () => {
    mockCreateOrganization.mockRejectedValueOnce(new Error("Slug already taken"));
    const ctx = createMockContext();
    const result = await createTenant({ name: "Duplicate" }, ctx);

    assertResultErr(result, "Slug already taken");
  });

  test("auto-generates slug from name", async () => {
    const ctx = createMockContext();
    await createTenant({ name: "My Company!" }, ctx);

    expect(mockCreateOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ slug: "my-company" }),
      }),
    );
  });
});
```

### Billing Handler Test (Complete Pattern)

```typescript
// packages/modules/billing/src/__tests__/cancel-subscription.test.ts
// Source: Derived from codebase patterns in provider-factory.test.ts + handler analysis
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { createMockContext, createMockDb } from "../../__test-utils__/mock-context";
import { createMockPaymentProvider } from "../../__test-utils__/mock-payment-provider";
import { assertResultOk, assertResultErr } from "../../__test-utils__/assert-result";

mock.module("@baseworks/config", () => ({
  env: { DATABASE_URL: "postgres://test@localhost/test", NODE_ENV: "test" },
}));
mock.module("stripe", () => ({ default: class {} }));

const { setPaymentProvider, resetPaymentProvider } = await import("../provider-factory");
const { cancelSubscription } = await import("../commands/cancel-subscription");

describe("cancelSubscription", () => {
  const mockProvider = createMockPaymentProvider();

  beforeEach(() => {
    resetPaymentProvider();
    setPaymentProvider(mockProvider);
    (mockProvider.cancelSubscription as any).mockClear();
  });

  test("cancels subscription at period end", async () => {
    const ctx = createMockContext({
      db: createMockDb({
        select: [{ providerSubscriptionId: "sub_123", currentPeriodEnd: new Date("2026-05-01") }],
      }),
    });

    const result = await cancelSubscription({}, ctx);
    assertResultOk(result);
    expect(result.data.cancelledAt).toBe("period_end");
    expect(mockProvider.cancelSubscription).toHaveBeenCalledWith({
      providerSubscriptionId: "sub_123",
      cancelAtPeriodEnd: true,
    });
  });

  test("returns error when no active subscription", async () => {
    const ctx = createMockContext({ db: createMockDb({ select: [{}] }) });
    const result = await cancelSubscription({}, ctx);
    assertResultErr(result, "NO_ACTIVE_SUBSCRIPTION");
  });
});
```

### Stripe Adapter Test (Mirroring Pagarme)

```typescript
// packages/modules/billing/src/__tests__/stripe-adapter.test.ts
// Source: Mirrors pagarme-adapter.test.ts structure [VERIFIED: codebase]
import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock the Stripe SDK
const mockCustomersCreate = mock(() => Promise.resolve({ id: "cus_stripe_123" }));
const mockSubscriptionsCreate = mock(() => Promise.resolve({
  id: "sub_stripe_789", status: "active",
  items: { data: [{ price: { id: "price_abc" } }] },
  current_period_end: 1700000000,
}));
// ... more mock methods matching each StripeAdapter method

mock.module("stripe", () => ({
  default: class MockStripe {
    customers = { create: mockCustomersCreate };
    subscriptions = { create: mockSubscriptionsCreate, retrieve: mock(), update: mock() };
    checkout = { sessions: { create: mock() } };
    billingPortal = { sessions: { create: mock() } };
    invoices = { list: mock() };
    subscriptionItems = { createUsageRecord: mock() };
    webhooks = { constructEvent: mock() };
  },
}));

const { StripeAdapter } = await import("../adapters/stripe/stripe-adapter");

describe("StripeAdapter", () => {
  let adapter: InstanceType<typeof StripeAdapter>;

  beforeEach(() => {
    adapter = new StripeAdapter({
      secretKey: "sk_test_stripe_123",
      webhookSecret: "whsec_test_stripe_456",
    });
  });

  test("has name 'stripe'", () => {
    expect(adapter.name).toBe("stripe");
  });

  test("createCustomer calls Stripe customers.create", async () => {
    const result = await adapter.createCustomer({ tenantId: "tenant_abc", name: "Test" });
    expect(result.providerCustomerId).toBe("cus_stripe_123");
    expect(mockCustomersCreate).toHaveBeenCalledTimes(1);
  });
  // ... mirrors all 10 Pagarme adapter tests
});
```

## Handler Inventory and Test Counts

### Auth Commands (8 handlers, ~24 tests)
| Handler | Key Dependencies | Test Cases |
|---------|-----------------|------------|
| create-tenant | auth.api.createOrganization | success + emits event, auth throws, slug auto-generation |
| update-tenant | auth.api.updateOrganization | success, auth throws |
| delete-tenant | auth.api.deleteOrganization | success + emits event, auth throws |
| update-profile | auth.api.updateUser, auth.api.changePassword | basic update, password change, auth throws |
| create-invitation | auth.api.createInvitation, nanoid | email mode success + event, link mode generates @internal email, auth throws |
| accept-invitation | auth.api.acceptInvitation | success + emits event, auth throws |
| cancel-invitation | auth.api.cancelInvitation | success + emits event, auth throws |
| reject-invitation | auth.api.rejectInvitation | success + emits event, auth throws |

### Auth Queries (6 handlers, ~18 tests)
| Handler | Key Dependencies | Test Cases |
|---------|-----------------|------------|
| get-tenant | auth.api.getFullOrganization | success, not found, auth throws |
| list-tenants | auth.api.listOrganizations | success (returns orgs), empty list, auth throws |
| get-profile | direct db query (user table) | success, not authenticated (no userId), user not found |
| list-members | auth.api.getFullOrganization | success, tenant not found, auth throws |
| get-invitation | auth.api.getInvitation | success, not found, auth throws |
| list-invitations | auth.api.listInvitations | success, empty list, auth throws |

### Billing Commands (6 handlers, ~18 tests)
| Handler | Key Dependencies | Test Cases |
|---------|-----------------|------------|
| create-checkout-session | ctx.db, getPaymentProvider().createCheckoutSession | success, no billing customer, provider throws |
| cancel-subscription | ctx.db, getPaymentProvider().cancelSubscription | success (period end), no active sub, provider throws |
| change-subscription | ctx.db, getPaymentProvider().changeSubscription | success, no active sub, provider throws |
| create-one-time-payment | ctx.db, getPaymentProvider().createOneTimePayment | success, no billing customer, provider throws |
| create-portal-session | ctx.db, getPaymentProvider().createPortalSession | success, no billing customer, portal not supported |
| record-usage | ctx.db.insert(usageRecords) | success (recorded=true), validates metric/quantity |

### Billing Queries (2 handlers, ~6 tests)
| Handler | Key Dependencies | Test Cases |
|---------|-----------------|------------|
| get-subscription-status | ctx.db | with record (active), no record (inactive defaults), db throws |
| get-billing-history | ctx.db, getPaymentProvider().getInvoices | success with invoices, no customer (empty array), provider throws |

### Stripe Adapter (~12 tests, mirroring Pagarme's 10 + extras)
| Test | Pagarme Parity |
|------|---------------|
| has name 'stripe' | Yes |
| createCustomer calls Stripe | Yes (maps to createCustomer endpoint test) |
| createSubscription calls Stripe | Yes |
| cancelSubscription calls update with cancel_at_period_end | Yes (differs: Pagarme uses DELETE, Stripe uses update) |
| createPortalSession returns session URL | Yes (differs: Pagarme returns null) |
| getSubscription returns null on error | Yes |
| verifyWebhookSignature uses constructEvent | Yes |
| normalizeEvent delegates to mapStripeEvent | Yes |
| getInvoices maps to ProviderInvoice format | Yes |
| reportUsage creates usage record | Extra (Stripe-specific) |
| changeSubscription retrieves then updates | Extra (Stripe-specific) |
| createOneTimePayment creates payment-mode session | Extra (Stripe-specific) |

### Core Infrastructure Edge Cases (TEST-07)
| Target | New Tests |
|--------|-----------|
| CqrsBus | duplicate registration warning, handler throws -> error result, concurrent execution |
| EventBus | multiple subscribers same event, unsubscribe/off, emit with no subscribers |
| Registry | duplicate module load, module with missing commands/queries |

### Scoped-db Edge Cases (TEST-06)
| Target | New Tests |
|--------|-----------|
| scopedDb | empty string tenantId behavior, null tenantId behavior, raw property exposes underlying db |

### Config/Env Tests (TEST-08)
| Target | New Tests |
|--------|-----------|
| validatePaymentProviderEnv | throws for pagarme without key (non-test), throws for stripe without key (non-test), warns in test mode |
| assertRedisUrl | throws for worker role without URL, throws for all role without URL, passes for api role without URL |

**Estimated total: ~85-90 tests across ~30 new/expanded files.**

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Registration-only tests | Behavioral handler tests | This phase | Tests verify actual behavior, not just module structure |
| Ad-hoc mock objects per file | Shared mock factory (createMockContext) | This phase | Consistent, maintainable mock setup |
| Testing through module index | Direct handler imports | Established in pagarme-adapter.test.ts | Less mocking overhead, faster test execution |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `mock.module()` with relative paths like `"../auth"` works to intercept auth handler imports | Architecture Patterns | Would need to use absolute package path or different mock strategy |
| A2 | Billing handler `ctx.db.select().from(table).where(eq(...)).limit(1)` destructuring pattern `const [customer] = await ...` means `.limit(1)` returns an array | Code Examples | Mock db must return arrays, not single objects |
| A3 | `profile.test.ts` and `tenant-session.test.ts` are registration-only tests that should be deleted per D-08 | Architecture Patterns | Need to verify content before deleting |

**A1 detail:** `mock.module()` in bun uses the exact module specifier. Auth handlers import `"../auth"` which is a relative path. The mock must match the exact specifier used by the importing module. If bun resolves to an absolute path internally, the relative mock may not intercept. This needs empirical validation in Wave 0. [ASSUMED]

**A2 detail:** Verified by reading handler code -- all billing handlers use `const [customer] = await ctx.db.select().from(...).where(...).limit(1)` which destructures the first element of an array. [VERIFIED: codebase]

## Open Questions

1. **mock.module() with relative path resolution**
   - What we know: `mock.module("@baseworks/config", ...)` works with package-style paths (verified in existing tests). Auth handlers use relative import `"../auth"`.
   - What's unclear: Whether `mock.module("../auth", ...)` inside a test file at `__tests__/create-tenant.test.ts` correctly intercepts the `"../auth"` import in `commands/create-tenant.ts` when paths resolve differently.
   - Recommendation: Test this in Wave 0 with a single auth handler. If relative paths don't work, alternative is to mock at the package level using the workspace path (e.g., `mock.module("@baseworks/modules-auth/auth", ...)`).

2. **Which existing test files to delete vs keep**
   - What we know: `tenant-crud.test.ts` and `invitation.test.ts` are clearly registration-only (verified).
   - What's unclear: Whether `profile.test.ts` and `tenant-session.test.ts` have behavioral tests worth keeping.
   - Recommendation: Read these files during execution; delete if registration-only, refactor if they have behavioral content.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | bun:test (built-in, Bun 1.1+) |
| Config file | None (bun:test uses zero config) |
| Quick run command | `bun test --bail packages/modules/auth/src/__tests__/create-tenant.test.ts` |
| Full suite command | `bun test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-01 | Auth command handlers behavioral tests | unit | `bun test packages/modules/auth/src/__tests__/{handler}.test.ts` | Wave 0 |
| TEST-02 | Auth query handlers behavioral tests | unit | `bun test packages/modules/auth/src/__tests__/{handler}.test.ts` | Wave 0 |
| TEST-03 | Billing command handlers behavioral tests | unit | `bun test packages/modules/billing/src/__tests__/{handler}.test.ts` | Wave 0 |
| TEST-04 | Billing query handlers behavioral tests | unit | `bun test packages/modules/billing/src/__tests__/{handler}.test.ts` | Wave 0 |
| TEST-05 | Stripe adapter conformance tests | unit | `bun test packages/modules/billing/src/__tests__/stripe-adapter.test.ts` | Wave 0 |
| TEST-06 | Scoped-db edge cases | integration | `bun test packages/db/src/__tests__/scoped-db.test.ts` | Existing (expand) |
| TEST-07 | Core infrastructure edge cases | unit | `bun test apps/api/src/core/__tests__/*.test.ts` | Existing (expand) |
| TEST-08 | Config/env validation | unit | `bun test packages/config/src/__tests__/env.test.ts` | Existing (expand) |

### Sampling Rate
- **Per task commit:** `bun test --bail {changed_test_file}`
- **Per wave merge:** `bun test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `packages/modules/__test-utils__/mock-context.ts` -- shared mock factory
- [ ] `packages/modules/__test-utils__/assert-result.ts` -- result assertion helpers
- [ ] `packages/modules/__test-utils__/mock-payment-provider.ts` -- mock PaymentProvider
- [ ] Validate `mock.module("../auth")` relative path interception works

## Security Domain

Not applicable to this phase. Unit tests do not introduce new attack surface. Tests should not contain real secrets (all mock values use `sk_test_*` / `whsec_test_*` prefixes). [VERIFIED: existing test patterns use test prefixes]

## Sources

### Primary (HIGH confidence)
- Codebase analysis of all 22 handler source files in `packages/modules/auth/src/commands/*.ts`, `queries/*.ts`, `packages/modules/billing/src/commands/*.ts`, `queries/*.ts`
- Codebase analysis of existing test files: `pagarme-adapter.test.ts`, `billing.test.ts`, `provider-factory.test.ts`, `webhook-normalization.test.ts`, `cqrs.test.ts`, `event-bus.test.ts`, `registry.test.ts`, `scoped-db.test.ts`, `env.test.ts`
- `packages/shared/src/types/cqrs.ts` -- HandlerContext interface and defineCommand/defineQuery
- `packages/db/src/helpers/scoped-db.ts` -- ScopedDb interface and chainable API
- `packages/modules/billing/src/provider-factory.ts` -- setPaymentProvider/resetPaymentProvider exports
- `packages/modules/billing/src/ports/payment-provider.ts` -- PaymentProvider interface

### Secondary (MEDIUM confidence)
- bun:mock `mock.module()` relative path behavior [ASSUMED -- needs Wave 0 validation]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- bun:test already established, no new dependencies
- Architecture: HIGH -- all handler patterns analyzed, mock strategies derived from existing tests
- Pitfalls: HIGH -- identified from actual codebase import chains and side effects
- mock.module relative paths: MEDIUM -- needs empirical validation

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (stable -- bun:test API unlikely to change)
