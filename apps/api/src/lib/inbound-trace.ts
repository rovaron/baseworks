import ipaddr from "ipaddr.js";
import { env } from "@baseworks/config";

/**
 * decideInboundTrace — inbound W3C traceparent trust decision helper
 * (Phase 19 / D-07 / D-08).
 *
 * Default policy: never-trust (D-07). Untrusted inbound traceparent is
 * preserved in `inboundCarrier` for later Phase 21 OTEL Link attachment,
 * but the server generates a fresh traceId + spanId. Trusted requests
 * (matching CIDR or carrying the operator-chosen trusted header) adopt
 * the inbound ids as the span parent and clear the carrier.
 *
 * IPv4 canonicality guard: `ipaddr.js` v2 silently normalises short-form
 * IPv4 literals (`"10.1"` → `0.0.0.10/8`, etc.). Phase 19 Plan 02 enforces
 * that the operator-supplied `OBS_TRUST_TRACEPARENT_FROM` entries are
 * canonical 4-octet IPv4 (three dots) at boot. This module applies the same
 * three-dot discipline to the INCOMING `remoteAddr` — a spoofed short-form
 * client address must not silently match a trust range after normalisation.
 * See 19-02-SUMMARY.md for the library-leniency rationale.
 */

// Module-init: parse CIDR list once. Plan 02's validateObservabilityEnv()
// crash-hards on malformed syntax before this module loads in non-test
// environments, so parseCIDR is safe here. In test mode Plan 02 soft-warns
// and may leave malformed entries in the env — but test code that exercises
// decideInboundTrace mocks @baseworks/config directly, so no malformed
// input reaches module-init here.
const TRUSTED_CIDRS: Array<[ipaddr.IPv4 | ipaddr.IPv6, number]> = (
  env.OBS_TRUST_TRACEPARENT_FROM ?? ""
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((cidr) => ipaddr.parseCIDR(cidr));

const TRUSTED_HEADER = env.OBS_TRUST_TRACEPARENT_HEADER ?? null;

/**
 * Decide whether to adopt the inbound W3C traceparent as the parent span
 * or fall through to a fresh server-side traceId + spanId.
 *
 * @param req - Incoming Request (reads `traceparent` header + optional
 *   trusted header configured via OBS_TRUST_TRACEPARENT_HEADER)
 * @param remoteAddr - Remote peer IP from `server.requestIP(req)?.address`
 *   in the Bun.serve fetch wrapper. MUST be the TCP peer address — not an
 *   X-Forwarded-For value (XFF is client-controlled and would defeat the
 *   CIDR allow-list per T-19-CIDR-2 in the threat register).
 * @returns traceId + spanId (adopted if trusted, fresh otherwise) plus
 *   `inboundCarrier` which preserves the original `traceparent` for Phase 21
 *   OTEL Link attachment when untrusted, and is empty when the inbound has
 *   been adopted as the parent.
 */
export function decideInboundTrace(
  req: Request,
  remoteAddr: string,
): {
  traceId: string;
  spanId: string;
  inboundCarrier: Record<string, string>;
} {
  const inbound = req.headers.get("traceparent") ?? "";
  const inboundCarrier: Record<string, string> = inbound
    ? { traceparent: inbound }
    : {};

  let trusted = false;
  if (TRUSTED_CIDRS.length > 0 && remoteAddr) {
    try {
      // Three-dot canonicality guard on incoming IPv4 — mirrors the boot-time
      // enforcement in packages/config/src/env.ts::validateObservabilityEnv
      // (19-02 SUMMARY). `ipaddr.parse("10.1")` silently rewrites to
      // `0.0.0.10`; reject that short-form path here so a malformed remote
      // address can never coincidentally match a trusted /8 range after
      // normalisation. IPv6 keeps its RFC 5952 short-form (library already
      // rejects colon-less IPv6).
      const looksLikeIPv4 = remoteAddr.includes(".");
      if (looksLikeIPv4) {
        const dotCount = (remoteAddr.match(/\./g) ?? []).length;
        if (dotCount !== 3) {
          // Non-canonical short-form IPv4 — treat as untrusted without
          // touching the library.
          throw new Error("non-canonical IPv4 remote address");
        }
      }
      const addr = ipaddr.parse(remoteAddr);
      trusted = TRUSTED_CIDRS.some(
        ([range, bits]) =>
          addr.kind() === range.kind() && addr.match(range, bits),
      );
    } catch {
      // Malformed remote address — treat as untrusted (fresh trace).
    }
  }
  if (!trusted && TRUSTED_HEADER && req.headers.get(TRUSTED_HEADER)) {
    trusted = true;
  }

  if (trusted && inbound) {
    // Parse W3C traceparent: `00-<32hex>-<16hex>-<2hex>`. Version byte `00`
    // is the only spec-defined value today; future versions fall through to
    // the fresh-trace path.
    const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec(inbound);
    if (m) {
      return { traceId: m[1], spanId: m[2], inboundCarrier: {} };
    }
  }

  // Fresh trace server-side — default path for untrusted requests and for
  // trusted requests with a malformed inbound traceparent.
  const traceId = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  const spanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return { traceId, spanId, inboundCarrier };
}
