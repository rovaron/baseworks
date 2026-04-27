import { describe, expect, test } from "bun:test";
import { startHeartbeatPublisher } from "../heartbeat";

function makeFakeRedis() {
  const setCalls: Array<{ key: string; value: string; mode: string; ttl: number }> = [];
  const delCalls: string[] = [];
  let setShouldReject = false;
  let delShouldReject = false;
  return {
    setCalls,
    delCalls,
    setShouldReject: (v: boolean) => {
      setShouldReject = v;
    },
    delShouldReject: (v: boolean) => {
      delShouldReject = v;
    },
    async set(key: string, value: string, mode: string, ttl: number) {
      setCalls.push({ key, value, mode, ttl });
      if (setShouldReject) throw new Error("redis-down");
      return "OK";
    },
    async del(key: string) {
      delCalls.push(key);
      if (delShouldReject) throw new Error("redis-del-down");
      return 1;
    },
  } as any;
}

function makeFakeLogger() {
  const warns: Array<{ data: unknown; message?: string }> = [];
  return {
    warns,
    warn: (data: unknown, message?: string) => warns.push({ data, message }),
  };
}

// Helper: wait for N microtasks to drain (so the immediate void publish() resolves)
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("startHeartbeatPublisher — D-12 key shape + TTL + value", () => {
  test("immediate publish writes key with correct shape", async () => {
    const redis = makeFakeRedis();
    const handle = startHeartbeatPublisher({
      redis,
      instanceId: "host-a",
      getQueues: () => ["q1", "q2"],
      intervalMs: 60_000,
      version: "1.2.3",
    });
    await flush();
    expect(redis.setCalls.length).toBe(1);
    const call = redis.setCalls[0];
    expect(call.key).toBe("worker:heartbeat:host-a");
    expect(call.mode).toBe("EX");
    expect(call.ttl).toBe(120); // 2 × 60s = 120s
    const payload = JSON.parse(call.value);
    expect(payload.instanceId).toBe("host-a");
    expect(payload.queues).toEqual(["q1", "q2"]);
    expect(payload.version).toBe("1.2.3");
    expect(typeof payload.lastHeartbeat).toBe("string");
    expect(new Date(payload.lastHeartbeat).toString()).not.toBe("Invalid Date");
    await handle.stop();
  });

  test("TTL ceil-rounds to seconds (intervalMs=15000 → ttlSec=30)", async () => {
    const redis = makeFakeRedis();
    const handle = startHeartbeatPublisher({
      redis,
      instanceId: "h",
      getQueues: () => [],
      intervalMs: 15_000,
    });
    await flush();
    expect(redis.setCalls[0].ttl).toBe(30);
    await handle.stop();
  });

  test("TTL ceil-rounds for non-multiples (intervalMs=2500 → ttlSec=5)", async () => {
    const redis = makeFakeRedis();
    const handle = startHeartbeatPublisher({
      redis,
      instanceId: "h",
      getQueues: () => [],
      intervalMs: 2500,
    });
    await flush();
    expect(redis.setCalls[0].ttl).toBe(5); // ceil(5000 / 1000)
    await handle.stop();
  });
});

describe("startHeartbeatPublisher — interval + lazy queues", () => {
  test("publishes on every interval tick (real timer, short interval)", async () => {
    const redis = makeFakeRedis();
    const handle = startHeartbeatPublisher({
      redis,
      instanceId: "h",
      getQueues: () => [],
      intervalMs: 50,
    });
    await flush();
    // Wait for 2 ticks
    await new Promise((r) => setTimeout(r, 130));
    await handle.stop();
    // 1 immediate + at least 2 ticks = ≥3 set calls
    expect(redis.setCalls.length).toBeGreaterThanOrEqual(3);
  });

  test("getQueues() invoked at publish time, not at start time (lazy)", async () => {
    const redis = makeFakeRedis();
    let queues = ["initial"];
    const handle = startHeartbeatPublisher({
      redis,
      instanceId: "h",
      getQueues: () => queues,
      intervalMs: 50,
    });
    await flush();
    expect(JSON.parse(redis.setCalls[0].value).queues).toEqual(["initial"]);
    queues = ["updated"];
    await new Promise((r) => setTimeout(r, 80));
    await handle.stop();
    const lastValue = redis.setCalls[redis.setCalls.length - 1].value;
    expect(JSON.parse(lastValue).queues).toEqual(["updated"]);
  });

  test("publishes immediately exactly once before any interval tick", async () => {
    const redis = makeFakeRedis();
    const handle = startHeartbeatPublisher({
      redis,
      instanceId: "h",
      getQueues: () => [],
      intervalMs: 60_000, // long interval — only the immediate publish should fire
    });
    await flush();
    expect(redis.setCalls.length).toBe(1);
    await handle.stop();
  });

  test("publishes 4 times across 3 intervals (1 immediate + 3 ticks)", async () => {
    const redis = makeFakeRedis();
    const handle = startHeartbeatPublisher({
      redis,
      instanceId: "h",
      getQueues: () => [],
      intervalMs: 40,
    });
    await flush();
    // Wait > 3 intervals
    await new Promise((r) => setTimeout(r, 150));
    await handle.stop();
    // 1 immediate + ≥3 ticks
    expect(redis.setCalls.length).toBeGreaterThanOrEqual(4);
  });
});

describe("startHeartbeatPublisher — D-14 resilience", () => {
  test("Redis set error logs warn, does NOT throw", async () => {
    const redis = makeFakeRedis();
    const log = makeFakeLogger();
    redis.setShouldReject(true);
    const handle = startHeartbeatPublisher({
      redis,
      instanceId: "h",
      getQueues: () => [],
      intervalMs: 60_000,
      logger: log,
    });
    await flush();
    // No throw escaped; warn was logged.
    expect(log.warns.length).toBeGreaterThanOrEqual(1);
    expect(log.warns[0].message).toContain("publish failed");
    await handle.stop();
  });
});

describe("startHeartbeatPublisher — graceful shutdown (D-14)", () => {
  test("stop() clears interval AND DELs the key", async () => {
    const redis = makeFakeRedis();
    const handle = startHeartbeatPublisher({
      redis,
      instanceId: "h",
      getQueues: () => [],
      intervalMs: 50,
    });
    await flush();
    await handle.stop();
    expect(redis.delCalls).toEqual(["worker:heartbeat:h"]);
    // Wait past one interval — should NOT see additional set calls
    const callsBefore = redis.setCalls.length;
    await new Promise((r) => setTimeout(r, 80));
    expect(redis.setCalls.length).toBe(callsBefore);
  });

  test("stop() with redis.del error → logged warn, no throw", async () => {
    const redis = makeFakeRedis();
    const log = makeFakeLogger();
    redis.delShouldReject(true);
    const handle = startHeartbeatPublisher({
      redis,
      instanceId: "h",
      getQueues: () => [],
      intervalMs: 60_000,
      logger: log,
    });
    await flush();
    await handle.stop(); // must not throw
    const delWarn = log.warns.find((w) =>
      String(w.message ?? "").includes("DEL failed"),
    );
    expect(delWarn).toBeDefined();
  });
});
