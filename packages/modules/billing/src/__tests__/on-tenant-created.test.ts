import { beforeEach, describe, expect, mock, test } from "bun:test";

// Spy for the lazily-created provision queue's add().
const queueAdd = mock(async () => ({ id: "job-1" }));
const createQueueSpy = mock(() => ({ add: queueAdd }));
// Spy for the inline-fallback path (no Redis).
const provisionCustomerSpy = mock(async () => {});
const captureExceptionSpy = mock(() => {});

mock.module("@baseworks/config", () => ({
  env: {
    DATABASE_URL: "postgres://test:test@localhost:5432/testdb",
    NODE_ENV: "test",
    REDIS_URL: "redis://localhost:6379",
    PAYMENT_PROVIDER: "stripe",
    STRIPE_SECRET_KEY: "sk_test_123",
    PAGARME_SECRET_KEY: undefined,
  },
}));
mock.module("@baseworks/queue", () => ({ createQueue: createQueueSpy }));
mock.module("@baseworks/observability", () => ({
  getErrorTracker: () => ({ captureException: captureExceptionSpy }),
}));
mock.module("../jobs/provision-customer", () => ({ provisionCustomer: provisionCustomerSpy }));

const { registerBillingHooks } = await import("../hooks/on-tenant-created");

// Capture the handler registerBillingHooks attaches to "tenant.created".
function getHandler(): (data: unknown) => Promise<void> {
  let captured: ((data: unknown) => Promise<void>) | undefined;
  registerBillingHooks({
    on: (event, handler) => {
      if (event === "tenant.created") captured = handler;
    },
  });
  if (!captured) throw new Error("tenant.created handler was not registered");
  return captured;
}

describe("registerBillingHooks — durable provisioning (billing-tenant-created-customer-no-retry)", () => {
  beforeEach(() => {
    queueAdd.mockClear();
    createQueueSpy.mockClear();
    provisionCustomerSpy.mockClear();
    captureExceptionSpy.mockClear();
  });

  test("enqueues billing-provision-customer with a tenant-keyed jobId", async () => {
    const handler = getHandler();
    await handler({ tenantId: "t-123", name: "Acme" });

    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(queueAdd).toHaveBeenCalledWith(
      "billing-provision-customer",
      { tenantId: "t-123", name: "Acme" },
      { jobId: "provision:t-123" },
    );
    // Provider work is deferred to the worker, not done inline.
    expect(provisionCustomerSpy).not.toHaveBeenCalled();
  });

  test("does not enqueue or provision when no provider key is configured", async () => {
    // Re-point config to a keyless provider for this case.
    mock.module("@baseworks/config", () => ({
      env: {
        DATABASE_URL: "postgres://test:test@localhost:5432/testdb",
        NODE_ENV: "test",
        REDIS_URL: "redis://localhost:6379",
        PAYMENT_PROVIDER: "stripe",
        STRIPE_SECRET_KEY: undefined,
        PAGARME_SECRET_KEY: undefined,
      },
    }));
    const { registerBillingHooks: freshRegister } = await import("../hooks/on-tenant-created");
    let captured: ((data: unknown) => Promise<void>) | undefined;
    freshRegister({
      on: (event, handler) => {
        if (event === "tenant.created") captured = handler;
      },
    });
    await captured?.({ tenantId: "t-456", name: "NoKeys" });

    expect(queueAdd).not.toHaveBeenCalled();
    expect(provisionCustomerSpy).not.toHaveBeenCalled();
  });
});
