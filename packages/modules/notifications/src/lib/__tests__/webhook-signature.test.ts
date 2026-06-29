// packages/modules/notifications/src/lib/__tests__/webhook-signature.test.ts

import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { signWebhook } from "../webhook-signature";

describe("signWebhook", () => {
  test("produces t=<ts>,v1=<hmac> over `<ts>.<body>`", () => {
    const secret = "whsec_test";
    const body = '{"event":"system.test"}';
    const ts = 1_700_000_000;
    const expectedMac = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");

    expect(signWebhook(secret, body, ts)).toBe(`t=${ts},v1=${expectedMac}`);
  });

  test("different body → different signature (tamper-evident)", () => {
    const a = signWebhook("s", "a", 1);
    const b = signWebhook("s", "b", 1);
    expect(a).not.toBe(b);
  });

  test("timestamp is part of the signed payload (replay-evident)", () => {
    const a = signWebhook("s", "body", 1);
    const b = signWebhook("s", "body", 2);
    expect(a).not.toBe(b);
  });
});
