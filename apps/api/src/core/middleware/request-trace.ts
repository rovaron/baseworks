import { Elysia } from "elysia";
import { getObsContext } from "@baseworks/observability";
import { createRequestLogger } from "../../lib/logger";

/**
 * Request tracing middleware.
 *
 * Phase 19 D-23 — requestId now comes from the unified observability ALS
 * (seeded by the Bun.serve fetch wrapper in apps/api/src/index.ts). The
 * response-header writer has moved to observabilityMiddleware to enforce a
 * single-writer invariant across the middleware stack; this middleware only
 * derives `requestId`, `log`, and `startTime` into the Elysia context and
 * emits the request-completion log line on response.
 *
 * Uses `as: 'global'` to apply tracing to all routes regardless of plugin
 * scope. The completion log line automatically includes trace/tenant/user
 * fields via the pino mixin (Phase 19 D-19) — no explicit requestId needed
 * in the log payload.
 *
 * Defensive fallback: when invoked outside any `obsContext.run(...)` frame
 * (unusual — e.g., misconfigured test harness), the derive returns
 * `requestId: "unknown"` so downstream handlers never see undefined.
 */
export const requestTraceMiddleware = new Elysia({ name: "request-trace" })
  .derive({ as: "global" }, () => {
    const requestId = getObsContext()?.requestId ?? "unknown";
    const log = createRequestLogger(requestId);
    const startTime = performance.now();
    return { requestId, log, startTime };
  })
  .onAfterResponse({ as: "global" }, ({ request, set, log, startTime }) => {
    const duration = Math.round(performance.now() - (startTime as number));
    const url = new URL(request.url);

    (log as any).info(
      {
        method: request.method,
        path: url.pathname,
        status: (set as any).status || 200,
        duration_ms: duration,
      },
      "request completed",
    );
    // D-23: response-header writer DELETED (single writer is observabilityMiddleware).
  });
