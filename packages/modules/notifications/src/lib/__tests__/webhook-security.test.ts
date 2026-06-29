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
    "fd12:3456::1", // ULA fd00::/8
    "::ffff:127.0.0.1", // IPv4-mapped loopback (dotted)
    "::ffff:7f00:1", // IPv4-mapped loopback (hex-compressed) == 127.0.0.1
    "::ffff:a00:1", // IPv4-mapped 10.0.0.1 (hex-compressed)
    "100.64.0.1", // CGNAT 100.64/10
    "100.127.255.255", // CGNAT upper bound
    "192.0.0.1", // IETF protocol assignments
    "192.0.2.5", // TEST-NET-1
    "192.88.99.1", // 6to4 relay anycast
    "198.18.0.1", // benchmarking 198.18/15
    "198.19.255.255", // benchmarking upper
    "224.0.0.1", // multicast
    "240.0.0.1", // reserved 240/4
    "255.255.255.255", // limited broadcast
  ])("flags %s as private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  test.each([
    "93.184.216.34",
    "8.8.8.8",
    "1.1.1.1",
    "100.63.255.255", // just below CGNAT 100.64/10
    "100.128.0.1", // just above CGNAT 100.64/10
    "172.15.0.1", // just below 172.16/12
    "172.32.0.1", // just above 172.16/12
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
