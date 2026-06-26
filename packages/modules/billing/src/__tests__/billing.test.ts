import { describe, expect, mock, test } from "bun:test";

// Mock @baseworks/config before anything else to avoid env validation crash
mock.module("@baseworks/config", () => ({
  env: {
    DATABASE_URL: "postgres://test:test@localhost:5432/testdb",
    NODE_ENV: "test",
    PORT: 3000,
    INSTANCE_ROLE: "all",
    BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-chars-long",
    BETTER_AUTH_URL: "http://localhost:3000",
    LOG_LEVEL: "info",
    STRIPE_SECRET_KEY: undefined,
    STRIPE_WEBHOOK_SECRET: undefined,
    RESEND_API_KEY: undefined,
    REDIS_URL: undefined,
  },
  assertRedisUrl: (role: string, url?: string) => url as string,
}));

// Mock external dependencies to avoid needing Stripe/Redis/DB at test time
mock.module("stripe", () => ({
  default: class MockStripe {
    constructor() {}
  },
}));

mock.module("ioredis", () => ({
  default: class MockIORedis {
    options: any;
    quit = mock(() => Promise.resolve("OK"));
    status = "ready";
    constructor(_url: string, opts: any) {
      this.options = opts;
    }
  },
}));

mock.module("bullmq", () => ({
  Queue: class MockQueue {
    name: string;
    opts: any;
    constructor(name: string, opts: any) {
      this.name = name;
      this.opts = opts;
    }
  },
  Worker: class MockWorker {
    name: string;
    constructor(name: string, _processor: any, _opts: any) {
      this.name = name;
    }
    on() {}
    async close() {}
  },
}));

// Mock postgres to avoid DB connection
mock.module("postgres", () => ({
  default: function mockPostgres() {
    return {};
  },
}));

// Import after mocks
const billingModule = (await import("../index")).default;
const { billingCustomers, webhookEvents, usageRecords } = await import("@baseworks/db");

describe("Billing Module Definition", () => {
  test("module name is 'billing'", () => {
    expect(billingModule.name).toBe("billing");
  });

  test("module has all expected command keys", () => {
    const commandKeys = Object.keys(billingModule.commands);
    expect(commandKeys).toContain("billing:create-checkout-session");
    expect(commandKeys).toContain("billing:cancel-subscription");
    expect(commandKeys).toContain("billing:change-subscription");
    expect(commandKeys).toContain("billing:create-one-time-payment");
    expect(commandKeys).toContain("billing:create-portal-session");
    expect(commandKeys).toContain("billing:record-usage");
  });

  test("module has expected query keys", () => {
    const queryKeys = Object.keys(billingModule.queries);
    expect(queryKeys).toContain("billing:get-subscription-status");
    expect(queryKeys).toContain("billing:get-billing-history");
  });

  test("module has expected job keys", () => {
    const jobKeys = Object.keys(billingModule.jobs);
    expect(jobKeys).toContain("billing-process-webhook");
    expect(jobKeys).toContain("billing-sync-usage");
  });

  test("module has events array with expected events", () => {
    expect(billingModule.events).toContain("subscription.created");
    expect(billingModule.events).toContain("subscription.cancelled");
    expect(billingModule.events).toContain("payment.succeeded");
    expect(billingModule.events).toContain("payment.failed");
  });

  test("module has routes defined", () => {
    expect(billingModule.routes).toBeTruthy();
  });

  test("all command values are functions", () => {
    for (const [_key, handler] of Object.entries(billingModule.commands)) {
      expect(typeof handler).toBe("function");
    }
  });

  test("all job handlers are functions", () => {
    for (const [_key, job] of Object.entries(billingModule.jobs)) {
      expect(typeof (job as any).handler).toBe("function");
      expect(typeof (job as any).queue).toBe("string");
    }
  });
});

// NOTE: The email pipeline (template render + graceful no-key skip) moved out of
// billing into @baseworks/module-notifications in Phase 3. Equivalent behavior
// coverage now lives there:
//   - render + subjects + unknown-template throw → notifications/src/lib/__tests__/email-render.test.ts
//   - graceful skip when no RESEND_API_KEY      → notifications/src/channels/__tests__/resend-provider.test.ts
//   - enqueue → worker render+send (mock provider) → notifications/src/__tests__/deliver-transactional.test.ts

describe("Billing Schema", () => {
  test("billingCustomers table has expected columns", () => {
    const columns = Object.keys(billingCustomers);
    expect(columns).toContain("id");
    expect(columns).toContain("tenantId");
    expect(columns).toContain("providerCustomerId");
    expect(columns).toContain("providerSubscriptionId");
    expect(columns).toContain("status");
  });

  test("webhookEvents table has providerEventId column", () => {
    const columns = Object.keys(webhookEvents);
    expect(columns).toContain("providerEventId");
    expect(columns).toContain("eventType");
    expect(columns).toContain("status");
  });

  test("usageRecords table has syncedToProvider column", () => {
    const columns = Object.keys(usageRecords);
    expect(columns).toContain("syncedToProvider");
    expect(columns).toContain("tenantId");
    expect(columns).toContain("metric");
    expect(columns).toContain("quantity");
    expect(columns).toContain("providerUsageRecordId");
  });
});
