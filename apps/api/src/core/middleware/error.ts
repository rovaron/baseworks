import { Elysia } from "elysia";
import { getErrorTracker } from "@baseworks/observability";
import { logger } from "../../lib/logger";

/**
 * Global error middleware mapping application errors to consistent
 * JSON responses.
 *
 * HTTP status mapping:
 * - VALIDATION errors -> 400 with `VALIDATION_ERROR` code and details
 * - NOT_FOUND errors -> 404 with `NOT_FOUND` code
 * - "Unauthorized" / "Missing tenant context" -> 401 with `UNAUTHORIZED`
 * - "No active tenant" -> 401 with `MISSING_TENANT_CONTEXT`
 * - "Forbidden" -> 403 with `FORBIDDEN` code
 * - All other errors -> 500 with `INTERNAL_ERROR` (no details exposed)
 *
 * Detailed error messages and stack traces are logged server-side
 * via pino; clients receive only safe error codes. Uses `as: 'global'`
 * to intercept errors from all routes regardless of plugin scope.
 */
export const errorMiddleware = new Elysia({ name: "error-handler" }).onError(
  { as: "global" },
  ({ code, error, set, request }) => {
    // Extract message safely (some Elysia error types may not have .message)
    const errMsg = "message" in error ? (error as Error).message : String(error);
    const errStack = "stack" in error ? (error as Error).stack : undefined;

    // Log all errors server-side
    logger.error({ code, message: errMsg, stack: errStack }, "Request error");

    // Phase 18 D-03 — capture via ErrorTracker port.
    // A3 resolution: the matched-route template is NOT available on Elysia's
    // Context at onError time. Tag method+code (cardinality-safe); send the
    // concrete path via extra (not a metric dimension — Pitfall 4). Phase 19
    // adds the route template via middleware that has access to Elysia's
    // internal routing state.
    getErrorTracker().captureException(error, {
      tags: { method: request.method, code: String(code) },
      extra: { path: new URL(request.url).pathname },
    });

    switch (code) {
      case "VALIDATION":
        set.status = 400;
        return {
          success: false,
          error: "VALIDATION_ERROR",
          details: errMsg,
        };

      case "NOT_FOUND":
        set.status = 404;
        return {
          success: false,
          error: "NOT_FOUND",
        };

      default: {
        // Check for tenant context / auth errors from tenant middleware
        if (
          errMsg === "Missing tenant context" ||
          errMsg === "Unauthorized"
        ) {
          set.status = 401;
          return {
            success: false,
            error: "UNAUTHORIZED",
          };
        }

        if (errMsg === "No active tenant") {
          set.status = 401;
          return {
            success: false,
            error: "MISSING_TENANT_CONTEXT",
          };
        }

        if (errMsg === "Forbidden") {
          set.status = 403;
          return {
            success: false,
            error: "FORBIDDEN",
          };
        }

        // Generic internal error -- never expose details in production
        set.status = 500;
        return {
          success: false,
          error: "INTERNAL_ERROR",
        };
      }
    }
  },
);
