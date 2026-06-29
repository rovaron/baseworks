// packages/modules/notifications/src/jobs/__tests__/deliver-webhook.test.ts
import { describe, expect, test } from "bun:test";
import { notificationWebhook, notificationWebhookDelivery } from "@baseworks/db";
import { deliverWebhook } from "../deliver-webhook";

type Row = Record<string, unknown>;

/**
 * Fake db: serves a delivery row + endpoint row by table, and captures
 * `.update(table).set(payload)` calls as { table, payload }.
 */
function fakeDb(opts: {
  delivery?: Row;
  endpoint?: Row;
  onUpdate: (u: { table: unknown; payload: Row }) => void;
}) {
  let from: unknown;
  let updTable: unknown;
  // biome-ignore lint/suspicious/noExplicitAny: drizzle-shaped test double
  const db: any = {
    select: () => db,
    from: (t: unknown) => {
      from = t;
      return db;
    },
    where: () => db,
    limit: () => {
      if (from === notificationWebhookDelivery)
        return Promise.resolve(opts.delivery ? [opts.delivery] : []);
      if (from === notificationWebhook)
        return Promise.resolve(opts.endpoint ? [opts.endpoint] : []);
      return Promise.resolve([]);
    },
    update: (t: unknown) => {
      updTable = t;
      return db;
    },
    set: (payload: Row) => {
      opts.onUpdate({ table: updTable, payload });
      return db;
    },
  };
  return db;
}

const baseDelivery = {
  id: "d1",
  webhookId: "e1",
  attempts: "0",
  payload: { event: "system.test" },
};
const baseEndpoint = {
  id: "e1",
  url: "https://hook.example/x",
  secret: "s",
  status: "active",
  consecutiveFailures: "0",
};
const okLookup = async () => [{ address: "93.184.216.34" }];

function updatesFor(table: unknown, calls: Array<{ table: unknown; payload: Row }>) {
  return calls.filter((c) => c.table === table).map((c) => c.payload);
}

describe("deliverWebhook", () => {
  test("2xx → delivery success + endpoint failures reset", async () => {
    const calls: Array<{ table: unknown; payload: Row }> = [];
    const db = fakeDb({
      delivery: { ...baseDelivery },
      endpoint: { ...baseEndpoint, consecutiveFailures: "4" },
      onUpdate: (u) => calls.push(u),
    });
    await deliverWebhook(
      { kind: "webhook-event", deliveryId: "d1" },
      {
        db: () => db,
        httpPost: async () => ({ status: 200 }),
        lookup: okLookup,
        now: () => 1_700_000_000_000,
      },
    );
    expect(updatesFor(notificationWebhookDelivery, calls)[0]).toMatchObject({
      status: "success",
      httpStatus: "200",
    });
    expect(updatesFor(notificationWebhook, calls)[0]).toMatchObject({
      consecutiveFailures: "0",
      lastStatus: "success",
    });
  });

  test("inactive endpoint → delivery skipped, no POST", async () => {
    const calls: Array<{ table: unknown; payload: Row }> = [];
    let posted = false;
    const db = fakeDb({
      delivery: { ...baseDelivery },
      endpoint: { ...baseEndpoint, status: "auto_disabled" },
      onUpdate: (u) => calls.push(u),
    });
    await deliverWebhook(
      { kind: "webhook-event", deliveryId: "d1" },
      {
        db: () => db,
        httpPost: async () => {
          posted = true;
          return { status: 200 };
        },
        lookup: okLookup,
      },
    );
    expect(posted).toBe(false);
    expect(updatesFor(notificationWebhookDelivery, calls)[0]).toMatchObject({ status: "skipped" });
  });

  test("non-2xx → records failed + throws (for BullMQ retry)", async () => {
    const calls: Array<{ table: unknown; payload: Row }> = [];
    const db = fakeDb({
      delivery: { ...baseDelivery },
      endpoint: { ...baseEndpoint },
      onUpdate: (u) => calls.push(u),
    });
    const run = deliverWebhook(
      { kind: "webhook-event", deliveryId: "d1" },
      { db: () => db, httpPost: async () => ({ status: 500 }), lookup: okLookup },
    );
    await expect(run).rejects.toThrow();
    expect(updatesFor(notificationWebhookDelivery, calls)[0]).toMatchObject({
      status: "failed",
      httpStatus: "500",
      attempts: "1",
    });
  });

  // The exact consecutiveFailures increment + auto-disable threshold are computed
  // atomically in SQL (CASE/`::int + 1`), so the captured `.set()` payload holds
  // SQL expression objects rather than literal strings — those concrete values
  // are verified against a real DB in __integration__/deliver-webhook.test.ts.
  // These two unit tests pin the *control flow*: the endpoint row is touched
  // exactly once, and only on the final attempt.
  test("final attempt failure → issues exactly one atomic endpoint failure update", async () => {
    const calls: Array<{ table: unknown; payload: Row }> = [];
    const db = fakeDb({
      delivery: { ...baseDelivery, attempts: "2" }, // this is attempt #3 (=== max)
      endpoint: { ...baseEndpoint, consecutiveFailures: "0" },
      onUpdate: (u) => calls.push(u),
    });
    await expect(
      deliverWebhook(
        { kind: "webhook-event", deliveryId: "d1" },
        { db: () => db, httpPost: async () => ({ status: 500 }), lookup: okLookup },
      ),
    ).rejects.toThrow();
    const epUpdates = updatesFor(notificationWebhook, calls);
    expect(epUpdates).toHaveLength(1);
    expect(epUpdates[0].lastStatus).toBe("failed");
    expect(epUpdates[0].consecutiveFailures).toBeDefined(); // SQL increment expression
    expect(epUpdates[0].status).toBeDefined(); // SQL auto-disable CASE expression
  });

  test("non-final attempt failure → does NOT touch the endpoint row (only the delivery)", async () => {
    const calls: Array<{ table: unknown; payload: Row }> = [];
    const db = fakeDb({
      delivery: { ...baseDelivery, attempts: "0" }, // attempt #1, below max
      endpoint: { ...baseEndpoint, consecutiveFailures: "0" },
      onUpdate: (u) => calls.push(u),
    });
    await expect(
      deliverWebhook(
        { kind: "webhook-event", deliveryId: "d1" },
        { db: () => db, httpPost: async () => ({ status: 500 }), lookup: okLookup },
      ),
    ).rejects.toThrow();
    expect(updatesFor(notificationWebhook, calls)).toHaveLength(0);
    expect(updatesFor(notificationWebhookDelivery, calls)[0]).toMatchObject({
      status: "failed",
      attempts: "1",
    });
  });

  test("SSRF rejection at delivery time → failed, no POST", async () => {
    const calls: Array<{ table: unknown; payload: Row }> = [];
    let posted = false;
    const db = fakeDb({
      delivery: { ...baseDelivery },
      endpoint: { ...baseEndpoint },
      onUpdate: (u) => calls.push(u),
    });
    await expect(
      deliverWebhook(
        { kind: "webhook-event", deliveryId: "d1" },
        {
          db: () => db,
          httpPost: async () => {
            posted = true;
            return { status: 200 };
          },
          lookup: async () => [{ address: "169.254.169.254" }],
        },
      ),
    ).rejects.toThrow();
    expect(posted).toBe(false);
    expect(updatesFor(notificationWebhookDelivery, calls)[0]).toMatchObject({ status: "failed" });
  });
});
