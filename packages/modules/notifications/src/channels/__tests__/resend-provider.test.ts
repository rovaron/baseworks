import { describe, expect, test } from "bun:test";
import { ResendEmailProvider } from "../resend-provider";

describe("ResendEmailProvider", () => {
  test("skips gracefully when no API key", async () => {
    const p = new ResendEmailProvider(undefined);
    const res = await p.send({ to: "a@b.c", subject: "s", html: "<p>h</p>" });
    expect(res.skipped).toBe(true);
  });
});
