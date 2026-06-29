// packages/modules/notifications/src/lib/__tests__/webhook-dispatch.test.ts
import { describe, expect, test } from "bun:test";
import { buildWebhookDeliveries, type WebhookEndpointRow } from "../webhook-dispatch";

const ep = (over: Partial<WebhookEndpointRow>): WebhookEndpointRow => ({
  id: "e1",
  status: "active",
  categories: ["system"],
  ...over,
});

const event = {
  tenantId: "t1",
  eventType: "system.test",
  category: "system",
  recipientUserIds: ["u1", "u2"],
  data: { message: "hi" },
  occurredAt: "2026-06-29T00:00:00.000Z",
};

describe("buildWebhookDeliveries", () => {
  test("selects active endpoints subscribed to the category and builds one row each", () => {
    const rows = buildWebhookDeliveries(
      [ep({ id: "e1" }), ep({ id: "e2", categories: ["billing"] }), ep({ id: "e3" })],
      event,
    );
    expect(rows.map((r) => r.webhookId).sort()).toEqual(["e1", "e3"]);
    const r = rows[0];
    expect(r).toMatchObject({
      tenantId: "t1",
      eventType: "system.test",
      category: "system",
      status: "pending",
    });
    expect(r.payload).toMatchObject({
      event: "system.test",
      category: "system",
      tenantId: "t1",
      recipientUserIds: ["u1", "u2"],
      occurredAt: "2026-06-29T00:00:00.000Z",
    });
  });

  test("skips non-active endpoints", () => {
    const rows = buildWebhookDeliveries(
      [ep({ id: "e1", status: "disabled" }), ep({ id: "e2", status: "auto_disabled" })],
      event,
    );
    expect(rows).toHaveLength(0);
  });

  test("tolerates null/empty categories (no subscription → no row)", () => {
    const rows = buildWebhookDeliveries([ep({ id: "e1", categories: null })], event);
    expect(rows).toHaveLength(0);
  });
});
