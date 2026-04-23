/**
 * Global process-level error handlers (ERR-01 / Phase 18 D-02, D-10).
 *
 * Register process.on('uncaughtException') and ('unhandledRejection') to
 * capture via the ErrorTracker port, flush with a 2000ms bounded drain,
 * then exit(1). Idempotent for the same tracker instance via WeakSet.
 *
 * Design rules:
 * - Exit code 1 — these handlers fire on crash, process should not linger.
 * - Flush timeout 2000ms per D-02 — bounded so a hung backend never prevents exit.
 * - Inner try/catch so a throwing tracker NEVER prevents process.exit(1) (RESEARCH Pitfall 1).
 * - WeakSet guard makes this safe to call twice in tests (Task 1 idempotence assertion).
 */

import type { ErrorTracker } from "../ports/error-tracker";

const INSTALLED = new WeakSet<ErrorTracker>();

/**
 * Install process-level uncaughtException + unhandledRejection handlers
 * that capture via the provided ErrorTracker, flush within 2000ms, then
 * exit(1). Idempotent per tracker instance.
 *
 * @param tracker - ErrorTracker instance to route fatal errors through
 */
export function installGlobalErrorHandlers(tracker: ErrorTracker): void {
  if (INSTALLED.has(tracker)) return;
  INSTALLED.add(tracker);

  const handle = async (
    err: unknown,
    kind: "uncaughtException" | "unhandledRejection",
  ) => {
    try {
      tracker.captureException(err, { extra: { handler: kind } });
      await tracker.flush(2000);
    } catch {
      // Never let the handler itself throw — we're already crashing.
    } finally {
      process.exit(1);
    }
  };

  process.on("uncaughtException", (err) => {
    void handle(err, "uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    void handle(reason, "unhandledRejection");
  });
}
