// packages/modules/notifications/src/lib/webhook-security.ts
import { lookup as dnsLookup } from "node:dns/promises";

export interface UrlGuardDeps {
  /** Resolve a hostname to all of its addresses. Injectable for tests. */
  lookup: (host: string) => Promise<Array<{ address: string }>>;
}

const defaultLookup: UrlGuardDeps["lookup"] = (host) => dnsLookup(host, { all: true });

/** True if `ip` is loopback, link-local, private (RFC1918/ULA), or unspecified. */
export function isPrivateAddress(ip: string): boolean {
  const addr = ip.toLowerCase();

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) → evaluate the embedded IPv4.
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const v4 = mapped ? mapped[1] : /^\d+\.\d+\.\d+\.\d+$/.test(addr) ? addr : null;

  if (v4) {
    const o = v4.split(".").map(Number);
    if (o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed → deny
    if (o[0] === 0) return true; // 0.0.0.0/8
    if (o[0] === 10) return true; // 10/8
    if (o[0] === 127) return true; // loopback
    if (o[0] === 169 && o[1] === 254) return true; // link-local incl. 169.254.169.254
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true; // 172.16/12
    if (o[0] === 192 && o[1] === 168) return true; // 192.168/16
    return false;
  }

  // IPv6
  if (addr === "::" || addr === "::1") return true; // unspecified / loopback
  if (addr.startsWith("fe80")) return true; // link-local
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // ULA fc00::/7
  return false;
}

/**
 * Validate a tenant-supplied webhook URL against SSRF. Requires `https://`,
 * resolves DNS, and rejects if ANY resolved address is private/loopback/
 * link-local (defeats DNS-rebinding). Runs at registration AND at delivery time.
 * @returns the parsed URL on success.
 * @throws Error if the URL is unsafe.
 */
export async function assertSafeWebhookUrl(
  rawUrl: string,
  deps: Partial<UrlGuardDeps> = {},
): Promise<URL> {
  const lookup = deps.lookup ?? defaultLookup;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid webhook URL: ${rawUrl}`);
  }
  if (url.protocol !== "https:") {
    throw new Error("Webhook URL must use https://");
  }

  const addrs = await lookup(url.hostname);
  if (addrs.length === 0) throw new Error(`Webhook host did not resolve: ${url.hostname}`);
  for (const { address } of addrs) {
    if (isPrivateAddress(address)) {
      throw new Error(
        `Webhook URL resolves to a private/internal address (${address}); not allowed`,
      );
    }
  }
  return url;
}
