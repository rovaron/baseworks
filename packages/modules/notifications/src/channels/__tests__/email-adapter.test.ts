// packages/modules/notifications/src/channels/__tests__/email-adapter.test.ts
import { describe, expect, test } from "bun:test";
import type { DeliverableNotification } from "../channel";
import { EmailAdapter } from "../email";
import type { EmailMessage, EmailProvider, EmailSendResult } from "../email-provider";

/** Capturing fake provider: records every `send` call and returns a canned result. */
function fakeProvider(result: EmailSendResult): { provider: EmailProvider; sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    provider: {
      async send(msg) {
        sent.push(msg);
        return result;
      },
    },
  };
}

/** Minimal drizzle-shaped fake db whose `.select().from().where().limit()` chain
 *  resolves to the supplied rows. */
function fakeDb(rows: unknown[]) {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return chain;
}

const baseNotification: DeliverableNotification = {
  id: "n1",
  tenantId: "t1",
  recipientUserId: "u1",
  type: "system.test",
  category: "system",
  severity: "info",
  title: "Your invoice is ready",
  body: "Click below to view it.",
  url: "https://app.example.com/invoices/1",
};

describe("EmailAdapter", () => {
  test("sends to the recipient's email with the title as subject", async () => {
    const { provider, sent } = fakeProvider({ messageId: "msg_123" });
    const db = fakeDb([{ email: "a@b.c" }]);
    const adapter = new EmailAdapter(provider, db);

    const res = await adapter.deliver(baseNotification, "d1");

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("a@b.c");
    expect(sent[0].subject).toBe(baseNotification.title);
    expect(sent[0].html).toContain("Your invoice is ready");
    expect(res).toEqual({ status: "sent", providerMessageId: "msg_123" });
  });

  test("skips when the recipient has no email and never calls the provider", async () => {
    const { provider, sent } = fakeProvider({ messageId: "should-not-happen" });
    const db = fakeDb([]); // no user row
    const adapter = new EmailAdapter(provider, db);

    const res = await adapter.deliver(baseNotification, "d1");

    expect(sent).toHaveLength(0);
    expect(res).toEqual({ status: "skipped", reason: "no email for recipient" });
  });

  test("reports skipped when the provider itself skips (no API key)", async () => {
    const { provider } = fakeProvider({ skipped: true });
    const db = fakeDb([{ email: "a@b.c" }]);
    const adapter = new EmailAdapter(provider, db);

    const res = await adapter.deliver(baseNotification, "d1");

    expect(res).toEqual({ status: "skipped", reason: "no provider" });
  });
});
