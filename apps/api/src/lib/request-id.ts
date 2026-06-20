/**
 * readRequestId — Phase 20.1 D-17 / H-02.
 *
 * Validates inbound `x-request-id` against `^[A-Za-z0-9_-]{1,128}$`.
 * Rejects invalid values (log-injection / correlation-poisoning surface
 * flagged in `19-REVIEW.md` H-02) and falls through to a fresh
 * `crypto.randomUUID()`.
 *
 * Charset choice per `20.1-CONTEXT.md` "Claude's Discretion":
 * `[A-Za-z0-9_-]` is the safe default; tighten to UUID-style only if a
 * downstream consumer depends on UUID shape (none today).
 *
 * Called from the Bun.serve fetch wrapper in `apps/api/src/index.ts`
 * exactly once per request, before `obsContext.run` opens. Sibling helper
 * to `parseNextLocaleCookie` (locale-cookie.ts) and `decideInboundTrace`
 * (inbound-trace.ts) — same single-purpose request-parsing pattern.
 */
export function readRequestId(req: Request): string {
  const raw = req.headers.get("x-request-id");
  if (raw && /^[A-Za-z0-9_-]{1,128}$/.test(raw)) return raw;
  return crypto.randomUUID();
}
