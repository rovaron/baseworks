/**
 * decideInboundTrace — Phase 20.1 D-12 + audit trust-gate.
 *
 * Adopt an inbound W3C traceparent if present AND inbound trust is enabled;
 * otherwise mint fresh server-side ids.
 *
 * SECURITY (api-traceparent-always-trusted) — always-trusting an inbound
 * traceparent is a correlation-injection surface once this API is public
 * (trace-graph poisoning + trace-join attacks). The trust gate is now opt-out
 * via `OBS_TRUST_INBOUND_TRACEPARENT` (validated in @baseworks/config). It
 * DEFAULTS to "true" to preserve the documented v1.3 always-trust posture;
 * set it to "false" on public-internet ingress so the API ignores client
 * traceparents and always mints fresh ids. Source: 20.1-REVIEW.md WR-01.
 */
const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

/**
 * Whether to trust inbound traceparent headers. Reads process.env directly (not
 * the parsed config) so the value is honored even in contexts that bypass the
 * config barrel, and so it stays unit-testable. Default = trust (D-12).
 */
function trustsInboundTraceparent(): boolean {
  return process.env.OBS_TRUST_INBOUND_TRACEPARENT !== "false";
}

export function decideInboundTrace(req: Request): {
  traceId: string;
  spanId: string;
} {
  const inbound = trustsInboundTraceparent() ? req.headers.get("traceparent") : null;
  if (inbound) {
    const m = TRACEPARENT_RE.exec(inbound);
    if (m) return { traceId: m[1], spanId: m[2] };
  }
  return {
    traceId: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
    spanId: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
  };
}
