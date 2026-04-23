import { describe, test, expect, afterEach } from "bun:test";
import { installGlobalErrorHandlers } from "../install-global-error-handlers";
import type {
  ErrorTracker,
  ErrorTrackerScope,
} from "../../ports/error-tracker";

function makeNoopTracker(): ErrorTracker {
  return {
    name: "test-noop",
    captureException: () => {},
    captureMessage: () => {},
    addBreadcrumb: () => {},
    withScope: <T>(fn: (s: ErrorTrackerScope) => T) =>
      fn({
        setUser: () => {},
        setTag: () => {},
        setExtra: () => {},
        setTenant: () => {},
      }),
    flush: async () => true,
  };
}

describe("installGlobalErrorHandlers — in-process", () => {
  const originalUncaught = process.listeners("uncaughtException");
  const originalRejection = process.listeners("unhandledRejection");

  afterEach(() => {
    // Restore listener state so test pollution doesn't leak.
    process.removeAllListeners("uncaughtException");
    for (const l of originalUncaught) {
      process.on("uncaughtException", l as never);
    }
    process.removeAllListeners("unhandledRejection");
    for (const l of originalRejection) {
      process.on("unhandledRejection", l as never);
    }
  });

  test("registers both handlers on first call", () => {
    const before = {
      uncaught: process.listenerCount("uncaughtException"),
      rejection: process.listenerCount("unhandledRejection"),
    };
    installGlobalErrorHandlers(makeNoopTracker());
    expect(process.listenerCount("uncaughtException")).toBeGreaterThan(
      before.uncaught,
    );
    expect(process.listenerCount("unhandledRejection")).toBeGreaterThan(
      before.rejection,
    );
  });

  test("idempotent — does not re-register for the same tracker instance", () => {
    const tracker = makeNoopTracker();
    installGlobalErrorHandlers(tracker);
    const afterFirst = process.listenerCount("uncaughtException");
    installGlobalErrorHandlers(tracker);
    expect(process.listenerCount("uncaughtException")).toBe(afterFirst);
  });
});

describe("installGlobalErrorHandlers — subprocess crash", () => {
  const harness = new URL("./fixtures/crash-harness.ts", import.meta.url)
    .pathname;

  test("uncaughtException triggers captureException + flush(2000) + exit 1", async () => {
    const proc = Bun.spawn(["bun", "run", harness, "uncaught", "ok"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    expect(exitCode).toBe(1);
    expect(stdout).toContain("captureException called with: boom");
    expect(stdout).toContain("flush called with timeout: 2000");
  }, 10_000);

  test("unhandledRejection triggers captureException + flush(2000) + exit 1", async () => {
    const proc = Bun.spawn(["bun", "run", harness, "rejection", "ok"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    expect(exitCode).toBe(1);
    expect(stdout).toContain("captureException called with: reject-boom");
    expect(stdout).toContain("flush called with timeout: 2000");
  }, 10_000);

  test("tracker throwing from captureException still exits 1", async () => {
    const proc = Bun.spawn(
      ["bun", "run", harness, "uncaught", "throw-on-capture"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await proc.exited;
    expect(exitCode).toBe(1);
  }, 10_000);
});
