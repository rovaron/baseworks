import { Elysia } from "elysia";
import {
  getObsContext,
  getTracer,
  setSpan,
  type Span,
} from "@baseworks/observability";
import { logger } from "../../lib/logger";

/**
 * HTTP span lifecycle middleware (Phase 19 / D-21 / TRC-01 / CTX-02).
 *
 * Hooks:
 *  - .derive (global) — open the HTTP span (kind=server) with provisional
 *    name `{method} unknown`, publish span IDs into ALS via setSpan.
 *  - .onBeforeHandle (global) — once the route template resolves, set
 *    `http.route` + `http.method` attributes on the open span.
 *  - .onAfterHandle (global) — write outbound `traceparent` + `x-request-id`
 *    headers on the 200-path response BEFORE Elysia serializes. This
 *    is the single writer for those headers (D-23 — request-trace.ts's
 *    duplicate writer is deleted in Plan 06).
 *  - .onError (global) — record exception + set error status on the span;
 *    also write outbound `traceparent` + `x-request-id` headers because
 *    `.onAfterHandle` does NOT fire on the error / 404 path.
 *  - .onAfterResponse (global) — set `http.status_code` + `tenant.id` +
 *    `user.id` attrs from ALS (post-tenantMiddleware), call `span.end()`.
 *    Runs post-response so it is safe for metrics side-effects; header
 *    writes in this hook do NOT reach the client (Elysia finalises the
 *    Response before this hook fires — verified empirically).
 *
 * Mounted BEFORE requestTraceMiddleware in apps/api/src/index.ts (Plan 06,
 * per D-22 order). Single-writer invariant for x-request-id + traceparent
 * (D-23 / D-09).
 *
 * Fail-closed invariant (B4): every hook defensively reads the ALS store.
 * If the middleware runs outside an `obsContext.run(...)` frame (e.g.,
 * misconfigured mount, direct `app.handle(req)` in a test harness),
 * the middleware logs a warning and passes the request through WITHOUT
 * opening a span or writing headers — it does NOT throw. Non-null
 * assertions on ALS reads are byte-level banned in this source.
 *
 * Pitfall 3 note: Elysia's `context.route` — verified as the route
 * TEMPLATE (e.g., `/api/tenants/:id`) not the matched path, so the
 * http.route attribute stays cardinality-safe per OTEL semantic
 * conventions (D-13). Locked by observability.test.ts Test 3.
 *
 * Hook-order fix: the plan's draft put outbound header writes in
 * `.onAfterResponse`, but Elysia finalises the Response before that
 * hook fires (verified via probe). Headers must therefore be written
 * in `.onAfterHandle` (success) and `.onError` (404 / 500) to reach
 * the client. `.onAfterResponse` remains the correct home for
 * `span.end()` and final metric attributes (http.status_code +
 * tenant.id + user.id) — these are post-response side-effects that
 * do not need to reach the client.
 */

function writeObsHeaders(
  set: unknown,
  requestId: string,
  traceId: string,
  spanId: string,
): void {
  if (set && typeof set === "object" && "headers" in set) {
    const headers = ((set as { headers?: Record<string, string> }).headers ??=
      {});
    headers["x-request-id"] = requestId;
    headers["traceparent"] = `00-${traceId}-${spanId}-01`;
  }
}

export const observabilityMiddleware = new Elysia({ name: "observability" })
  .derive({ as: "global" }, ({ request }) => {
    const store = getObsContext();
    if (!store) {
      logger.warn(
        {
          middleware: "observability",
          hook: "derive",
          method: request.method,
          path: new URL(request.url).pathname,
        },
        "observabilityMiddleware invoked without obsContext — fail-closed",
      );
      return { _obsSpan: null as Span | null };
    }
    const tracer = getTracer();
    const span = tracer.startSpan(`${request.method} unknown`, {
      kind: "server",
      attributes: { "request.id": store.requestId },
    });
    setSpan({ traceId: store.traceId, spanId: store.spanId });
    return { _obsSpan: span as Span | null };
  })
  .onBeforeHandle({ as: "global" }, (ctx) => {
    const obsSpan = (ctx as unknown as { _obsSpan?: Span | null })._obsSpan;
    if (!obsSpan) return;
    const { request, route } = ctx as unknown as {
      request: Request;
      route: string;
    };
    obsSpan.setAttribute("http.route", route);
    obsSpan.setAttribute("http.method", request.method);
  })
  .onAfterHandle({ as: "global" }, (ctx) => {
    const obsSpan = (ctx as unknown as { _obsSpan?: Span | null })._obsSpan;
    if (!obsSpan) return;
    const store = getObsContext();
    if (!store) return;
    const { set } = ctx as unknown as { set: unknown };
    writeObsHeaders(set, store.requestId, store.traceId, store.spanId);
  })
  .onError({ as: "global" }, (ctx) => {
    const obsSpan = (ctx as unknown as { _obsSpan?: Span | null })._obsSpan;
    if (!obsSpan) return;
    const { error, set } = ctx as unknown as { error: unknown; set: unknown };
    obsSpan.recordException(error);
    obsSpan.setStatus({ code: "error" });
    // Write outbound headers here because `.onAfterHandle` does NOT fire on
    // the error / 404 path. ALS store may be absent if the frame collapsed
    // between hooks — guard and skip the header write in that case.
    const store = getObsContext();
    if (!store) return;
    writeObsHeaders(set, store.requestId, store.traceId, store.spanId);
  })
  .onAfterResponse({ as: "global" }, (ctx) => {
    const obsSpan = (ctx as unknown as { _obsSpan?: Span | null })._obsSpan;
    if (!obsSpan) return;
    const store = getObsContext();
    if (!store) {
      // Edge case: span was opened (store existed in derive) but ALS frame
      // disappeared between hooks. End the span without attribute writes
      // to avoid TypeError; no header writes needed (this hook runs post-
      // response so headers here would never reach the client anyway).
      obsSpan.end();
      return;
    }
    const status = (ctx as unknown as { set: { status?: number } }).set
      ?.status;
    obsSpan.setAttribute("http.status_code", status ?? 200);
    if (store.tenantId) obsSpan.setAttribute("tenant.id", store.tenantId);
    if (store.userId) obsSpan.setAttribute("user.id", store.userId);
    obsSpan.end();
  });
