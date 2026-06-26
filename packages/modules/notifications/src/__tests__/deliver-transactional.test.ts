import { describe, expect, test } from "bun:test";
import type { EmailMessage, EmailProvider, EmailSendResult } from "../channels/email-provider";
import { deliver } from "../jobs/deliver";

/** Captures the message passed to send() so the test can assert on it. */
class FakeProvider implements EmailProvider {
  calls: EmailMessage[] = [];
  async send(msg: EmailMessage): Promise<EmailSendResult> {
    this.calls.push(msg);
    return { messageId: "fake-id" };
  }
}

describe("deliver — transactional-email branch", () => {
  test("renders the template and sends it via the injected provider", async () => {
    const fake = new FakeProvider();

    await deliver(
      {
        kind: "transactional-email",
        to: "user@example.com",
        template: "password-reset",
        data: { url: "https://example.com/reset", userName: "Ada" },
      },
      { provider: () => fake },
    );

    expect(fake.calls).toHaveLength(1);
    const sent = fake.calls[0];
    expect(sent.to).toBe("user@example.com");
    expect(sent.subject).toBe("Reset Your Password");
    expect(sent.html).toContain("<");
    expect(sent.html.length).toBeGreaterThan(0);
  });

  test("does not touch the db for the transactional-email branch", async () => {
    const fake = new FakeProvider();
    // db factory throws — proves the transactional branch never resolves it.
    await deliver(
      {
        kind: "transactional-email",
        to: "a@b.c",
        template: "magic-link",
        data: { url: "https://example.com/magic", email: "a@b.c" },
      },
      {
        provider: () => fake,
        db: () => {
          throw new Error("db must not be used for transactional-email");
        },
      },
    );

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].subject).toBe("Your Sign-in Link");
  });
});
