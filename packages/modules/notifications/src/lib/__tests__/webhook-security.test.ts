// packages/modules/notifications/src/lib/__tests__/webhook-security.test.ts
import { describe, expect, test } from "bun:test";
import { assertSafeWebhookUrl, isPrivateAddress } from "../webhook-security";

const pub = async () => [{ address: "93.184.216.34" }]; // example.com, public

describe("isPrivateAddress", () => {
  test.each([
    "127.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "0.0.0.0",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1", // IPv4-mapped loopback
  ])("flags %s as private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  test.each([
    "93.184.216.34",
    "8.8.8.8",
    "1.1.1.1",
    "2606:2800:220:1:248:1893:25c8:1946",
  ])("allows public %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("assertSafeWebhookUrl", () => {
  test("rejects non-https", async () => {
    await expect(assertSafeWebhookUrl("http://example.com/hook", { lookup: pub })).rejects.toThrow(
      /https/i,
    );
  });

  test("rejects a public-DNS name that resolves to a private IP (DNS rebinding)", async () => {
    await expect(
      assertSafeWebhookUrl("https://rebind.example/hook", {
        lookup: async () => [{ address: "169.254.169.254" }],
      }),
    ).rejects.toThrow(/private|internal|not allowed/i);
  });

  test("rejects when ANY resolved address is private", async () => {
    await expect(
      assertSafeWebhookUrl("https://mixed.example/hook", {
        lookup: async () => [{ address: "93.184.216.34" }, { address: "10.0.0.1" }],
      }),
    ).rejects.toThrow(/private|internal|not allowed/i);
  });

  test("accepts a public https URL and returns the parsed URL", async () => {
    const url = await assertSafeWebhookUrl("https://example.com/hook", { lookup: pub });
    expect(url.hostname).toBe("example.com");
  });
});
