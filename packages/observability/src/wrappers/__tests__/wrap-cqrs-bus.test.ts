import { describe, test, expect, beforeEach } from "bun:test";
import { wrapCqrsBus, type BusLike } from "../wrap-cqrs-bus";
import type {
  CaptureScope,
  ErrorTracker,
  ErrorTrackerScope,
} from "../../ports/error-tracker";

function makeRecordingTracker() {
  const calls: Array<{ err: unknown; scope?: CaptureScope }> = [];
  const tracker: ErrorTracker = {
    name: "recording",
    captureException: (err, scope) => {
      calls.push({ err, scope });
    },
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
  return { tracker, calls };
}

describe("wrapCqrsBus — A5 invariant", () => {
  let calls: ReturnType<typeof makeRecordingTracker>["calls"];
  let tracker: ErrorTracker;

  beforeEach(() => {
    const rec = makeRecordingTracker();
    calls = rec.calls;
    tracker = rec.tracker;
  });

  test("execute: thrown exception is captured with commandName + rethrown", async () => {
    const bus: BusLike = {
      execute: async () => {
        throw new Error("db down");
      },
      query: async () => ({ success: false, error: "NOT_IMPL" }),
    };
    const wrapped = wrapCqrsBus(bus, tracker);
    await expect(
      wrapped.execute("createTenant", {}, { tenantId: "t-1" }),
    ).rejects.toThrow("db down");
    expect(calls.length).toBe(1);
    expect(calls[0].scope?.extra).toMatchObject({ commandName: "createTenant" });
    expect(calls[0].scope?.tenantId).toBe("t-1");
  });

  test("execute: Result.err does NOT trigger captureException (A5)", async () => {
    const bus: BusLike = {
      execute: async () => ({ success: false, error: "COMMAND_NOT_FOUND" }),
      query: async () => ({ success: false, error: "NOT_IMPL" }),
    };
    const wrapped = wrapCqrsBus(bus, tracker);
    const result = await wrapped.execute("x", {}, {});
    expect(result).toMatchObject({ success: false, error: "COMMAND_NOT_FOUND" });
    expect(calls.length).toBe(0);
  });

  test("execute: Result.ok does NOT trigger captureException", async () => {
    const bus: BusLike = {
      execute: async () => ({ success: true, data: 42 }),
      query: async () => ({ success: false, error: "NOT_IMPL" }),
    };
    const wrapped = wrapCqrsBus(bus, tracker);
    const result = await wrapped.execute("x", {}, {});
    expect(result).toMatchObject({ success: true, data: 42 });
    expect(calls.length).toBe(0);
  });

  test("query: thrown exception is captured with queryName + rethrown", async () => {
    const bus: BusLike = {
      execute: async () => ({ success: false, error: "NOT_IMPL" }),
      query: async () => {
        throw new Error("redis hang");
      },
    };
    const wrapped = wrapCqrsBus(bus, tracker);
    await expect(
      wrapped.query("listTenants", {}, { tenantId: "t-2" }),
    ).rejects.toThrow("redis hang");
    expect(calls.length).toBe(1);
    expect(calls[0].scope?.extra).toMatchObject({ queryName: "listTenants" });
    expect(calls[0].scope?.tenantId).toBe("t-2");
  });

  test("query: Result.err does NOT trigger captureException (A5)", async () => {
    const bus: BusLike = {
      execute: async () => ({ success: false, error: "NOT_IMPL" }),
      query: async () => ({ success: false, error: "QUERY_NOT_FOUND" }),
    };
    const wrapped = wrapCqrsBus(bus, tracker);
    await wrapped.query("x", {}, {});
    expect(calls.length).toBe(0);
  });

  test("tenantId undefined when ctx lacks it", async () => {
    const bus: BusLike = {
      execute: async () => {
        throw new Error("boom");
      },
      query: async () => ({ success: false, error: "X" }),
    };
    const wrapped = wrapCqrsBus(bus, tracker);
    await expect(wrapped.execute("cmd", {}, {})).rejects.toThrow();
    expect(calls[0].scope?.tenantId).toBeUndefined();
  });

  test("rethrown error is the original instance (===)", async () => {
    const original = new Error("identity");
    const bus: BusLike = {
      execute: async () => {
        throw original;
      },
      query: async () => ({ success: false, error: "X" }),
    };
    const wrapped = wrapCqrsBus(bus, tracker);
    try {
      await wrapped.execute("cmd", {}, {});
      throw new Error("should not reach here");
    } catch (caught) {
      expect(caught).toBe(original);
    }
  });
});

describe("wrapCqrsBus — barrel export", () => {
  test("wrapCqrsBus is exported from @baseworks/observability", async () => {
    const mod = await import("../../index");
    expect(typeof (mod as { wrapCqrsBus?: unknown }).wrapCqrsBus).toBe(
      "function",
    );
  });
});
