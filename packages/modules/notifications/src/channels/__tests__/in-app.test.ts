// packages/modules/notifications/src/channels/__tests__/in-app.test.ts
import { describe, expect, test } from "bun:test";
import { InAppAdapter } from "../in-app";

describe("InAppAdapter", () => {
  test("publishes to the per-user channel and reports sent", async () => {
    const published: Array<[string, string]> = [];
    const adapter = new InAppAdapter({ publish: (ch, msg) => published.push([ch, msg]) });
    const res = await adapter.deliver(
      {
        id: "n1",
        tenantId: "t1",
        recipientUserId: "u1",
        type: "system.test",
        category: "system",
        severity: "info",
        title: "t",
        body: "b",
      },
      "d1",
    );
    expect(res.status).toBe("sent");
    expect(published[0][0]).toBe("notif:t1:u1");
    expect(JSON.parse(published[0][1])).toMatchObject({ type: "notification.created", id: "n1" });
  });
});
