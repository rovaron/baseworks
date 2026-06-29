import { describe, expect, test } from "bun:test";
import { notification, notificationDelivery, user } from "@baseworks/db";
import type { EmailMessage, EmailProvider, EmailSendResult } from "../channels/email-provider";
import { deliver } from "../jobs/deliver";

/** Provider that records sends and returns a canned result. */
class FakeProvider implements EmailProvider {
  calls: EmailMessage[] = [];
  constructor(private readonly result: EmailSendResult = { messageId: "fake-id" }) {}
  async send(msg: EmailMessage): Promise<EmailSendResult> {
    this.calls.push(msg);
    return this.result;
  }
}

/**
 * Minimal drizzle-shaped fake whose read chain returns different rows per table
 * (`notification_delivery` → delivery, `notification` → notif, `user` → userRows)
 * and whose `.update().set()` captures the persisted payload.
 */
function fakeDb(opts: {
  delivery?: unknown;
  notif?: unknown;
  userRows?: unknown[];
  onUpdate: (payload: Record<string, unknown>) => void;
}) {
  let from: unknown;
  // biome-ignore lint/suspicious/noExplicitAny: test double mimicking the drizzle chain
  const db: any = {
    select: () => db,
    from: (t: unknown) => {
      from = t;
      return db;
    },
    where: () => db,
    limit: () => {
      if (from === notificationDelivery)
        return Promise.resolve(opts.delivery ? [opts.delivery] : []);
      if (from === notification) return Promise.resolve(opts.notif ? [opts.notif] : []);
      if (from === user) return Promise.resolve(opts.userRows ?? []);
      return Promise.resolve([]);
    },
    update: () => db,
    set: (payload: Record<string, unknown>) => {
      opts.onUpdate(payload);
      return db;
    },
  };
  return db;
}

const baseNotif = {
  id: "n1",
  tenantId: "t1",
  recipientUserId: "u1",
  type: "system.test",
  category: "system",
  severity: "info",
  title: "Hello",
  body: "World",
  url: null,
  data: null,
  actions: null,
};

describe("deliver — channel-delivery branch", () => {
  test("persists the skip reason on the delivery row when the recipient has no email", async () => {
    let persisted: Record<string, unknown> | undefined;
    const db = fakeDb({
      delivery: { id: "d1", notificationId: "n1" },
      notif: baseNotif,
      userRows: [], // no email for recipient
      onUpdate: (p) => {
        persisted = p;
      },
    });

    await deliver(
      { kind: "channel-delivery", deliveryId: "d1", channel: "email" },
      { provider: () => new FakeProvider(), db: () => db },
    );

    expect(persisted).toMatchObject({ status: "skipped", error: "no email for recipient" });
  });

  test("records sent + providerMessageId on success", async () => {
    let persisted: Record<string, unknown> | undefined;
    const db = fakeDb({
      delivery: { id: "d1", notificationId: "n1" },
      notif: baseNotif,
      userRows: [{ email: "a@b.c" }],
      onUpdate: (p) => {
        persisted = p;
      },
    });

    await deliver(
      { kind: "channel-delivery", deliveryId: "d1", channel: "email" },
      { provider: () => new FakeProvider({ messageId: "msg_1" }), db: () => db },
    );

    expect(persisted).toMatchObject({ status: "sent", providerMessageId: "msg_1" });
  });

  test("records failed + error message when the provider throws", async () => {
    let persisted: Record<string, unknown> | undefined;
    const throwingProvider: EmailProvider = {
      async send() {
        throw new Error("Resend send failed: boom");
      },
    };
    const db = fakeDb({
      delivery: { id: "d1", notificationId: "n1" },
      notif: baseNotif,
      userRows: [{ email: "a@b.c" }],
      onUpdate: (p) => {
        persisted = p;
      },
    });

    await deliver(
      { kind: "channel-delivery", deliveryId: "d1", channel: "email" },
      { provider: () => throwingProvider, db: () => db },
    );

    expect(persisted).toMatchObject({ status: "failed", error: "Resend send failed: boom" });
  });
});
