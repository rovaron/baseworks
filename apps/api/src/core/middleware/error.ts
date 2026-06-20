import { getErrorTracker } from "@baseworks/observability";
import { AppError } from "@baseworks/shared";
import { Elysia } from "elysia";
import { logger } from "../../lib/logger";

/**
 * Global error middleware mapping application errors to consistent
 * JSON responses.
 *
 * HTTP status mapping:
 * - VALIDATION errors -> 400 with `VALIDATION_ERROR` code and details
 * - NOT_FOUND errors -> 404 with `NOT_FOUND` code
 * - AppError (from @baseworks/shared) -> mapped via its `status`/`code`
 *   (e.g. UnauthorizedError -> 401 UNAUTHORIZED,
 *   NoActiveTenantError -> 401 MISSING_TENANT_CONTEXT,
 *   ForbiddenError -> 403 FORBIDDEN)
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
        // Typed application errors carry their own HTTP status + code.
        // Map on those fields rather than matching the message text, which
        // is brittle and breaks if a message is reworded.
        if (error instanceof AppError) {
          set.status = error.status;
          return {
            success: false,
            error: error.code,
          };
        }

        // Belt-and-suspenders: legacy throw sites that still raise plain
        // Error("Unauthorized"/"No active tenant"/"Forbidden") keep mapping
        // correctly during the transition to typed errors.
        if (errMsg === "Unauthorized") {
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

        // Phase 18 D-03 — capture via ErrorTracker port.
        // Only genuinely unexpected (5xx) errors are reported; the 4xx
        // client conditions above (VALIDATION, NOT_FOUND, auth/tenant,
        // forbidden) are normal and must not flood the tracker.
        // A3 resolution: the matched-route template is NOT available on Elysia's
        // Context at onError time. Tag method+code (cardinality-safe); send the
        // concrete path via extra (not a metric dimension — Pitfall 4). Phase 19
        // adds the route template via middleware that has access to Elysia's
        // internal routing state.
        getErrorTracker().captureException(error, {
          tags: { method: request.method, code: String(code), status: "500" },
          extra: { path: new URL(request.url).pathname },
        });

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
