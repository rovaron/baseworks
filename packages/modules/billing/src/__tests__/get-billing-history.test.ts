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
const { getBillingHistory } = await import("../queries/get-billing-history");

describe("getBillingHistory", () => {
  let mockProvider: ReturnType<typeof createMockPaymentProvider>;

  beforeEach(() => {
    resetPaymentProvider();
    mockProvider = createMockPaymentProvider();
    setPaymentProvider(mockProvider);
  });

  test("returns invoices when customer exists", async () => {
    const mockDb = createMockDb({
      select: [{ providerCustomerId: "cus_123" }],
    });
    mockProvider.getInvoices = mock(() =>
      Promise.resolve([
        {
          id: "inv_1",
          amount: 1000,
          currency: "USD",
          status: "paid",
          created: 1700000000,
          invoiceUrl: "https://stripe.com/inv/1",
          pdfUrl: null,
        },
      ]),
    );
    const ctx = createMockContext({ db: mockDb });

    const result = await getBillingHistory({ limit: 10 }, ctx);
    const data = assertResultOk(result);

    expect(data.invoices).toHaveLength(1);
    expect(data.invoices[0].id).toBe("inv_1");
    expect(data.invoices[0].amount).toBe(1000);
    expect(data.invoices[0].status).toBe("paid");
    expect(mockProvider.getInvoices).toHaveBeenCalledWith("cus_123", 10);
  });

  test("returns empty array when no billing customer", async () => {
    const mockDb = createMockDb({ select: [] });
    const ctx = createMockContext({ db: mockDb });

    const result = await getBillingHistory({}, ctx);
    const data = assertResultOk(result);

    expect(data.invoices).toEqual([]);
  });

  test("returns error when provider throws", async () => {
    const mockDb = createMockDb({
      select: [{ providerCustomerId: "cus_123" }],
    });
    mockProvider.getInvoices = mock(() =>
      Promise.reject(new Error("Stripe rate limited")),
    );
    const ctx = createMockContext({ db: mockDb });

    const result = await getBillingHistory({ limit: 10 }, ctx);
    const error = assertResultErr(result);

    expect(error).toBe("Stripe rate limited");
  });
});
