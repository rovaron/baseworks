/**
 * Crash harness fixture — spawned by install-global-error-handlers.test.ts
 * to exercise uncaughtException + unhandledRejection paths in isolated
 * subprocesses. Prints a structured trace to stdout before exit so the
 * parent test can assert on the tracker interactions.
 *
 * Usage:
 *   bun run crash-harness.ts <mode> <tracker-behavior>
 *   mode: "uncaught" | "rejection"
 *   tracker-behavior: "ok" | "throw-on-capture"
 */
import { installGlobalErrorHandlers } from "../../install-global-error-handlers";
import type {
  Breadcrumb,
  ErrorTracker,
  ErrorTrackerScope,
  LogLevel,
} from "../../../ports/error-tracker";

const mode = process.argv[2] ?? "uncaught";
const behavior = process.argv[3] ?? "ok";

class RecordingTracker implements ErrorTracker {
  readonly name = "recording";
  captureException(err: unknown): void {
    process.stdout.write(
      `captureException called with: ${(err as Error)?.message}\n`,
    );
    if (behavior === "throw-on-capture") {
      throw new Error("tracker-internal-failure");
    }
  }
  captureMessage(_: string, __?: LogLevel): void {}
  addBreadcrumb(_: Breadcrumb): void {}
  withScope<T>(fn: (s: ErrorTrackerScope) => T): T {
    return fn({
      setUser: () => {},
      setTag: () => {},
      setExtra: () => {},
      setTenant: () => {},
    });
  }
  async flush(timeoutMs?: number): Promise<boolean> {
    process.stdout.write(`flush called with timeout: ${timeoutMs}\n`);
    return true;
  }
}

installGlobalErrorHandlers(new RecordingTracker());

if (mode === "uncaught") {
  setTimeout(() => {
    throw new Error("boom");
  }, 10);
} else if (mode === "rejection") {
  setTimeout(() => {
    void Promise.reject(new Error("reject-boom"));
  }, 10);
}
