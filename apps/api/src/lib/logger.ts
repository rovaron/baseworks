import pino from "pino";
import { obsContext } from "@baseworks/observability";

const level = process.env.LOG_LEVEL ?? "info";
const isDev = process.env.NODE_ENV === "development";

export const logger = pino({
  level,
  // Phase 19 D-19 — per-call mixin injects ALS fields (requestId, traceId,
  // spanId, tenantId, userId, locale) into every log line. Defensive ?? {}
  // so calls outside a request frame (startup, shutdown, migrations) don't
  // crash (D-20). NEVER extract fields here — return the raw store object;
  // all dynamic state flows from `getStore()` at call time (Pitfall 4).
  mixin: () => obsContext.getStore() ?? {},
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }
    : {}),
});

/** Create a child logger bound to a specific request ID for request-scoped tracing. */
export function createRequestLogger(requestId: string) {
  return logger.child({ requestId });
}
