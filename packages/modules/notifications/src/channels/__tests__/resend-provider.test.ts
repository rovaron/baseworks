import { describe, expect, mock, test } from "bun:test";

// The Resend SDK constructs an internal HTTP client; mock the package so we can
// drive `emails.send` responses (success vs API error) without real network.
let sendResult: { data: { id: string } | null; error: { message: string } | null };
const sendSpy = mock(async () => sendResult);
mock.module("resend", () => ({
  Resend: class {
    emails = { send: sendSpy };
  },
}));

const { ResendEmailProvider } = await import("../resend-provider");

describe("ResendEmailProvider", () => {
  test("skips gracefully when no API key (never calls the SDK)", async () => {
    sendSpy.mockClear();
    const p = new ResendEmailProvider(undefined);
    const res = await p.send({ to: "a@b.c", subject: "s", html: "<p>h</p>" });
    expect(res.skipped).toBe(true);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test("returns the provider message id on success", async () => {
    sendResult = { data: { id: "msg_123" }, error: null };
    const p = new ResendEmailProvider("re_test_key");
    const res = await p.send({ to: "a@b.c", subject: "s", html: "<p>h</p>" });
    expect(res).toEqual({ messageId: "msg_123" });
  });

  test("throws when Resend returns an error (so it is not recorded as sent)", async () => {
    sendResult = { data: null, error: { message: "Invalid `to` recipient" } };
    const p = new ResendEmailProvider("re_test_key");
    expect(p.send({ to: "bad", subject: "s", html: "<p>h</p>" })).rejects.toThrow(
      /Invalid `to` recipient/,
    );
  });
});
