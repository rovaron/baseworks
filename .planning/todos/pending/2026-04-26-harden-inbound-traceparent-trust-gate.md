---
created: 2026-04-26T22:30:00.000Z
title: Harden inbound traceparent trust-gate (re-introduce CIDR/header check before public ingress)
area: api
target_milestone: v1.4
files:
  - apps/api/src/lib/inbound-trace.ts
  - apps/api/src/index.ts
  - packages/config/src/env.ts
source: .planning/phases/20.1-close-v13-milestone-gaps/20.1-REVIEW.md (WR-01)
---

## Problem

Phase 20.1 D-12 deleted the CIDR + trusted-header gate that previously guarded
`decideInboundTrace`. The current implementation in
`apps/api/src/lib/inbound-trace.ts` adopts ANY well-formed inbound `traceparent`
from ANY client. This is a deliberate v1.3 trade-off (simpler ALS-vs-OTel
bridge) and is safe today because the API is not yet exposed to the public
internet.

The moment the API is fronted by a public load balancer, this becomes a
correlation-injection surface:

1. **Trace-graph poisoning** — a hostile client can emit traffic with
   attacker-chosen 32-hex traceIds, polluting Tempo / Sentry trace
   correlation across the entire fleet.
2. **Trace-join attack** — by guessing or replaying an internal traceId, an
   external request can be stitched into an unrelated internal request's
   trace, making the trace graph misleading during incident triage.
3. **Log/trace correlation drift** — once an external traceparent is adopted,
   every downstream log line, BullMQ job, and OTel span carries the
   attacker-chosen id, so the audit trail for that request becomes
   indistinguishable from legitimate traffic.

## Mitigation

Re-introduce the trust gate before the API ships to any environment where
arbitrary internet clients can reach it. Concrete shape:

```ts
// apps/api/src/lib/inbound-trace.ts
export function decideInboundTrace(
  req: Request,
  opts: { trustedFromHeader?: string; trustedCidrs?: string[] },
): { traceId: string; spanId: string } {
  const inbound = req.headers.get("traceparent");
  const trusted =
    (opts.trustedFromHeader && req.headers.get(opts.trustedFromHeader)) ||
    isFromTrustedCidr(req, opts.trustedCidrs);
  if (inbound && trusted) {
    const m = TRACEPARENT_RE.exec(inbound);
    if (m) return { traceId: m[1], spanId: m[2] };
  }
  return mintFresh();
}
```

Driven by env vars (e.g., `OBS_TRUST_TRACEPARENT_FROM_HEADER`,
`OBS_TRUST_TRACEPARENT_FROM_CIDRS`) plumbed through `@baseworks/config`.
Default behavior MUST be "do not trust" — only the configured ingress hop
should be able to opt in.

## Acceptance criteria

- `decideInboundTrace` no longer adopts an inbound `traceparent` unless the
  caller is on a configured trusted CIDR OR carries a configured trusted
  signed header (e.g., a gateway-signed JWT or HMAC).
- New env vars are documented in `.env.example` and validated at startup.
- Regression test in `apps/api/src/lib/__tests__/inbound-trace.test.ts`
  asserts: (a) untrusted source with valid traceparent → fresh ids,
  (b) trusted source with valid traceparent → adopted ids,
  (c) trusted source with malformed traceparent → fresh ids (existing case
  preserved).

## Cross-references

- `.planning/phases/20.1-close-v13-milestone-gaps/20.1-CONTEXT.md` —
  "Production trust hardening for inbound traceparent" deferral note.
- `.planning/phases/20.1-close-v13-milestone-gaps/20.1-REVIEW.md` — WR-01.
- Existing pattern reference: prior trust gate that was removed in commit
  range `d7cb441..92a986c` (Phase 20.1, D-12).
