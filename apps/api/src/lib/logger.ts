import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";
const isDev = process.env.NODE_ENV === "development";

export const logger = pino({
  level,
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
