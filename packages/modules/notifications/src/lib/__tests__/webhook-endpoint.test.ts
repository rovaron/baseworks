// packages/modules/notifications/src/lib/__tests__/webhook-endpoint.test.ts
import { describe, expect, test } from "bun:test";
import {
  generateWebhookSecret,
  isValidCategories,
  KNOWN_CATEGORIES,
  serializeWebhook,
} from "../webhook-endpoint";

describe("isValidCategories", () => {
  test("accepts a subset of known categories", () => {
    expect(isValidCategories(["system", "billing"])).toBe(true);
    expect(isValidCategories([...KNOWN_CATEGORIES])).toBe(true);
  });
  test("rejects empty, unknown, non-array, and non-string entries", () => {
    expect(isValidCategories([])).toBe(false);
    expect(isValidCategories(["nope"])).toBe(false);
    expect(isValidCategories("system" as unknown as string[])).toBe(false);
    expect(isValidCategories([1] as unknown as string[])).toBe(false);
  });
});

describe("generateWebhookSecret", () => {
  test("is prefixed and unique", () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a.startsWith("whsec_")).toBe(true);
    expect(a.length).toBeGreaterThan(20);
    expect(a).not.toBe(b);
  });
});

describe("serializeWebhook", () => {
  test("omits the secret and keeps the public fields", () => {
    const row = {
      id: "w1",
      tenantId: "t1",
      url: "https://x/y",
      secret: "whsec_super_secret",
      categories: ["system"],
      description: "d",
      status: "active",
      consecutiveFailures: "0",
      lastDeliveryAt: null,
      lastStatus: null,
      disabledReason: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const out = serializeWebhook(row);
    expect("secret" in out).toBe(false);
    expect(out).toMatchObject({ id: "w1", url: "https://x/y", status: "active" });
  });
});
