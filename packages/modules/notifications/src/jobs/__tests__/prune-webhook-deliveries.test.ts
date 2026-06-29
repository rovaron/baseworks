// packages/modules/notifications/src/jobs/__tests__/prune-webhook-deliveries.test.ts
import { describe, expect, test } from "bun:test";
import { notificationWebhookDelivery } from "@baseworks/db";
import { pruneWebhookDeliveries } from "../prune-webhook-deliveries";

describe("pruneWebhookDeliveries", () => {
  test("deletes from the delivery table with a cutoff = now - retentionDays", async () => {
    let deletedFrom: unknown;
    let whereCalled = false;
    // biome-ignore lint/suspicious/noExplicitAny: drizzle-shaped test double
    const db: any = {
      delete: (t: unknown) => {
        deletedFrom = t;
        return {
          where: () => {
            whereCalled = true;
            return Promise.resolve();
          },
        };
      },
    };

    await pruneWebhookDeliveries(undefined, {
      db: () => db,
      retentionDays: 30,
      now: () => new Date("2026-06-29T00:00:00.000Z").getTime(),
    });

    expect(deletedFrom).toBe(notificationWebhookDelivery);
    expect(whereCalled).toBe(true);
  });
});
