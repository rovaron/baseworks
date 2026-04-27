/**
 * decideInboundTrace — Phase 20.1 D-12.
 *
 * Adopt inbound W3C traceparent if present (always-trust default for v1.3);
 * otherwise mint fresh server-side ids. Trust-gate (CIDR + trusted header)
 * deleted in Phase 20.1; revisit for production hardening (deferred per
 * 20.1-CONTEXT.md "Production trust hardening").
 *
 * SECURITY (TODO v1.4) — always-trusting an inbound traceparent is a
 * correlation-injection surface the moment this API is exposed to the public
 * internet (trace-graph poisoning + trace-join attacks). Safe for v1.3 because
 * ingress is not yet public. Re-introduce the CIDR + trusted-header gate
 * before public launch. Tracked in:
 *   .planning/todos/pending/2026-04-26-harden-inbound-traceparent-trust-gate.md
 * Source finding: 20.1-REVIEW.md WR-01.
 */
const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

export function decideInboundTrace(req: Request): {
  traceId: string;
  spanId: string;
} {
  const inbound = req.headers.get("traceparent");
  if (inbound) {
    const m = TRACEPARENT_RE.exec(inbound);
    if (m) return { traceId: m[1], spanId: m[2] };
  }
  return {
    traceId: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
    spanId: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
  };
}
