import { Elysia } from "elysia";
import { logger } from "../../lib/logger";

/**
 * Global error middleware. Maps errors to consistent JSON responses.
 * Detailed errors are logged server-side; clients receive safe error codes.
 */
export const errorMiddleware = new Elysia({ name: "error-handler" }).onError(
  { as: "global" },
  ({ code, error, set }) => {
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
        // Check for tenant context errors
        if (errMsg === "Missing tenant context") {
          set.status = 401;
          return {
            success: false,
            error: "MISSING_TENANT_CONTEXT",
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
