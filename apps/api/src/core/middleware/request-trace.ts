import { Elysia } from "elysia";
import { createRequestLogger } from "../../lib/logger";

/**
 * Request tracing middleware.
 * Generates a unique request ID per request, creates a pino child logger,
 * logs request start/completion with method, path, status, and duration.
 * Sets X-Request-Id response header for client correlation.
 */
export const requestTraceMiddleware = new Elysia({ name: "request-trace" })
  .derive({ as: "global" }, ({ headers }) => {
    // Use incoming X-Request-Id if present (from load balancer), otherwise generate
    const requestId = headers["x-request-id"] || crypto.randomUUID();
    const log = createRequestLogger(requestId);
    const startTime = performance.now();

    return { requestId, log, startTime };
  })
  .onAfterResponse({ as: "global" }, ({ request, set, requestId, log, startTime }) => {
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

    // Set response header for client correlation
    if (set && typeof set === "object" && "headers" in set) {
      (set.headers as Record<string, string>)["x-request-id"] = requestId as string;
    }
  });
