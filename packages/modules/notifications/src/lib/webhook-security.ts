// packages/modules/notifications/src/lib/webhook-security.ts
import { lookup as dnsLookup } from "node:dns/promises";

export interface UrlGuardDeps {
  /** Resolve a hostname to all of its addresses. Injectable for tests. */
  lookup: (host: string) => Promise<Array<{ address: string }>>;
}

const defaultLookup: UrlGuardDeps["lookup"] = (host) => dnsLookup(host, { all: true });

/** Decode an IPv4-mapped IPv6 address to its embedded dotted-quad, else null.
 *  Handles both the dotted form (`::ffff:a.b.c.d`) and the hex-compressed form
 *  (`::ffff:7f00:1` === 127.0.0.1) — the latter is what some resolvers emit. */
function ipv4FromMapped(addr: string): string | null {
  const dotted = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = Number.parseInt(hex[1], 16);
    const lo = Number.parseInt(hex[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

/**
 * True if `ip` is loopback, link-local, private, carrier-grade-NAT, or one of
 * the IANA special-use ranges that must never be a webhook target. Errs toward
 * denying (malformed input → true).
 */
export function isPrivateAddress(ip: string): boolean {
  const addr = ip.toLowerCase();

  const mapped = ipv4FromMapped(addr);
  const v4 = mapped ?? (/^\d+\.\d+\.\d+\.\d+$/.test(addr) ? addr : null);

  if (v4) {
    const o = v4.split(".").map(Number);
    if (o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed → deny
    if (o[0] === 0) return true; // 0.0.0.0/8 "this network"
    if (o[0] === 10) return true; // 10/8 private
    if (o[0] === 127) return true; // loopback
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true; // 100.64/10 CGNAT
    if (o[0] === 169 && o[1] === 254) return true; // link-local incl. 169.254.169.254 metadata
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true; // 172.16/12 private
    if (o[0] === 192 && o[1] === 0 && o[2] === 0) return true; // 192.0.0/24 IETF protocol
    if (o[0] === 192 && o[1] === 0 && o[2] === 2) return true; // 192.0.2/24 TEST-NET-1
    if (o[0] === 192 && o[1] === 88 && o[2] === 99) return true; // 192.88.99/24 6to4 relay anycast
    if (o[0] === 192 && o[1] === 168) return true; // 192.168/16 private
    if (o[0] === 198 && (o[1] === 18 || o[1] === 19)) return true; // 198.18/15 benchmarking
    if (o[0] === 255 && o[1] === 255 && o[2] === 255 && o[3] === 255) return true; // broadcast
    if (o[0] >= 224) return true; // 224/4 multicast + 240/4 reserved
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
