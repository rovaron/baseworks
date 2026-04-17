import { describe, test, expect, mock, beforeEach } from "bun:test";
import { createMockContext, createMockDb } from "../../../__test-utils__/mock-context";
import { createMockPaymentProvider } from "../../../__test-utils__/mock-payment-provider";
import { assertResultOk, assertResultErr } from "../../../__test-utils__/assert-result";

mock.module("@baseworks/config", () => ({
  env: {
    DATABASE_URL: "postgres://test@localhost/test",
    NODE_ENV: "test",
  },
}));
mock.module("stripe", () => ({ default: class {} }));

const { setPaymentProvider, resetPaymentProvider } = await import("../provider-factory");
const { createPortalSession } = await import("../commands/create-portal-session");

describe("createPortalSession", () => {
  let mockProvider: ReturnType<typeof createMockPaymentProvider>;

  beforeEach(() => {
    resetPaymentProvider();
    mockProvider = createMockPaymentProvider();
    setPaymentProvider(mockProvider);
  });

  test("creates portal session", async () => {
    const mockDb = createMockDb({
      select: [{ providerCustomerId: "cus_123" }],
    });
    const ctx = createMockContext({ db: mockDb });

    const result = await createPortalSession(
      { returnUrl: "https://example.com/billing" },
      ctx,
    );
    const data = assertResultOk(result);

    expect(data.url).toBeDefined();
    expect(mockProvider.createPortalSession).toHaveBeenCalledWith({
      providerCustomerId: "cus_123",
      returnUrl: "https://example.com/billing",
    });
  });

  test("returns error when no billing customer", async () => {
    const mockDb = createMockDb({ select: [] });
    const ctx = createMockContext({ db: mockDb });

    const result = await createPortalSession(
      { returnUrl: "https://example.com/billing" },
      ctx,
    );
    const error = assertResultErr(result);

    expect(error).toBe("BILLING_NOT_CONFIGURED");
  });

  test("returns error when portal not supported", async () => {
    const mockDb = createMockDb({
      select: [{ providerCustomerId: "cus_123" }],
    });
    mockProvider.createPortalSession = mock(() => Promise.resolve(null));
    const ctx = createMockContext({ db: mockDb });

    const result = await createPortalSession(
      { returnUrl: "https://example.com/billing" },
      ctx,
    );
    const error = assertResultErr(result);

    expect(error).toBe("PORTAL_NOT_SUPPORTED");
  });
});
