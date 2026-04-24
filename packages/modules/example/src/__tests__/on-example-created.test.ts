import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";

/**
 * Behavioral tests for the registerExampleHooks event-bus listener.
 *
 * on-example-created.ts imports @baseworks/config (reads env.REDIS_URL)
 * and @baseworks/queue (which transitively imports ioredis + bullmq).
 * mock.module(...) blocks below intercept those imports so the test
 * doesn't need Redis at runtime and can control REDIS_URL per-test.
 *
 * The canonical model comes from billing.test.ts: mock external
 * infrastructure at the module boundary, then dynamic-import the unit
 * under test so the mocks are applied before its module graph resolves.
 */

// The mocked queue instance -- captured so tests can assert on its .add calls.
const mockAdd = mock(() => Promise.resolve());
const mockQueue = { add: mockAdd };

// Mock env to control REDIS_URL per test.
const envRef: { REDIS_URL: string | undefined } = { REDIS_URL: "redis://test:6379" };
mock.module("@baseworks/config", () => ({
  env: new Proxy({}, { get: (_t, k) => (envRef as any)[k] }),
  assertRedisUrl: (_role: string, url?: string) => url as string,
}));

mock.module("@baseworks/queue", () => ({
  createQueue: (_name: string, _url: string) => mockQueue,
}));

mock.module("ioredis", () => ({
  default: class {
    status = "ready";
    quit = mock(() => Promise.resolve("OK"));
  },
}));

mock.module("bullmq", () => ({
  Queue: class {
    add = mockAdd;
    constructor(public name: string) {}
  },
}));

// Import AFTER mocks so the mocks apply to the module graph.
const { registerExampleHooks } = await import("../hooks/on-example-created");

// Minimal stubbed event bus matching the shape consumed by registerExampleHooks.
function makeEventBus() {
  const listeners = new Map<string, (data: unknown) => Promise<void>>();
  return {
    on: (event: string, handler: (data: unknown) => Promise<void>) => {
      listeners.set(event, handler);
    },
    async emit(event: string, data: unknown) {
      const handler = listeners.get(event);
      if (handler) await handler(data);
    },
  };
}

/**
 * Test ordering note: registerExampleHooks uses a module-level
 * `followupQueue` cache (mirroring the billing/auth pattern). Once the
 * happy-path test populates that cache under a mocked createQueue, the
 * "REDIS_URL absent" branch can no longer be exercised in the same
 * process because the cached queue short-circuits the env check. We
 * therefore run the skip-when-absent case FIRST so it observes the
 * uncached `followupQueue === null` state. Production semantics are
 * unchanged -- REDIS_URL is stable across a process's lifetime in real
 * deployments.
 */
describe("registerExampleHooks", () => {
  beforeEach(() => {
    mockAdd.mockClear();
  });

  afterEach(() => {
    mockAdd.mockClear();
  });

  test("skips gracefully when REDIS_URL is absent", async () => {
    envRef.REDIS_URL = undefined;
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    const bus = makeEventBus();
    registerExampleHooks(bus);

    await bus.emit("example.created", { id: "ex-2", tenantId: "t-2" });

    expect(mockAdd).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
    const callArg = logSpy.mock.calls[0]?.[0] as string;
    expect(callArg).toContain("REDIS_URL");

    logSpy.mockRestore();
    envRef.REDIS_URL = "redis://test:6379";
  });

  test("enqueues example-process-followup when example.created fires", async () => {
    envRef.REDIS_URL = "redis://test:6379";
    const bus = makeEventBus();
    registerExampleHooks(bus);

    await bus.emit("example.created", { id: "ex-1", tenantId: "t-1" });

    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd).toHaveBeenCalledWith(
      "example-process-followup",
      { exampleId: "ex-1", tenantId: "t-1" },
    );
  });

  test("logs error without rethrowing when queue.add fails", async () => {
    envRef.REDIS_URL = "redis://test:6379";
    mockAdd.mockImplementationOnce(() => Promise.reject(new Error("redis down")));
    const errSpy = spyOn(console, "error").mockImplementation(() => {});

    const bus = makeEventBus();
    registerExampleHooks(bus);

    // Must not throw
    await expect(
      bus.emit("example.created", { id: "ex-3", tenantId: "t-3" }),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
