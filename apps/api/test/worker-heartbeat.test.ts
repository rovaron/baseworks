// Phase 22 / EXT-02 — worker-process integration test for heartbeat wire-up.
//
// Exercises the EXACT call shape apps/api/src/worker.ts uses
// (startHeartbeatPublisher({ redis: getRedisConnection(redisUrl), instanceId:
// resolveInstanceId(), getQueues: () => workers.map(w => w.name), intervalMs:
// env.WORKER_HEARTBEAT_INTERVAL_MS, ... })) with a fake redis stub.
//
// We do NOT spawn the worker as a child process — that would require Redis +
// BullMQ + a full `bun run worker` boot. The fake stub makes the test
// deterministic and fast (< 500ms) and proves the wire-up is correct: same
// publisher function, same arguments, same call shape against Redis.
//
// Real-Redis SIGKILL behavior is covered by the manual smoke step in
// VALIDATION.md "Worker heartbeat shows `dead` after process kill".

// Side-effect-only import: seeds DATABASE_URL/BETTER_AUTH_SECRET BEFORE the
// `@baseworks/observability` barrel is evaluated (which transitively loads
// `@baseworks/config` and triggers @t3-oss/env-core validation).
import "../src/core/middleware/__tests__/_env-setup";

import { afterEach, describe, expect, test } from "bun:test";
import { resolveInstanceId, startHeartbeatPublisher } from "@baseworks/observability";

// -- Build a fake IORedis surface that records every call ---------------
type SetCall = { key: string; value: string; mode: string; ttl: number };
type DelCall = string;

function makeFakeRedis() {
  const setCalls: SetCall[] = [];
  const delCalls: DelCall[] = [];
  let setShouldReject = false;
  let delShouldReject = false;
  return {
    setCalls,
    delCalls,
    rejectSet: (v: boolean) => {
      setShouldReject = v;
    },
    rejectDel: (v: boolean) => {
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
    async scan(_cursor: string) {
      return ["0", []];
    },
    async mget() {
      return [];
    },
  } as any;
}

async function flush() {
  // Let the immediate void publish() resolve before assertions.
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("worker.ts heartbeat wire-up integration (EXT-02 / D-12..D-14)", () => {
  const ORIGINAL_INSTANCE_ID = process.env.INSTANCE_ID;

  afterEach(() => {
    if (ORIGINAL_INSTANCE_ID === undefined) delete process.env.INSTANCE_ID;
    else process.env.INSTANCE_ID = ORIGINAL_INSTANCE_ID;
  });

  test("publisher SETs worker:heartbeat:{instanceId} with EX TTL = 2 × interval", async () => {
    process.env.INSTANCE_ID = "wire-up-host-1";
    const redis = makeFakeRedis();

    const handle = startHeartbeatPublisher({
      redis,
      instanceId: resolveInstanceId(),
      getQueues: () => [],
      intervalMs: 15_000, // matches default WORKER_HEARTBEAT_INTERVAL_MS
    });
    await flush();

    expect(redis.setCalls.length).toBe(1);
    const call = redis.setCalls[0];
    expect(call.key).toBe("worker:heartbeat:wire-up-host-1");
    expect(call.mode).toBe("EX");
    expect(call.ttl).toBe(30); // 2 × 15s = 30s — D-13 verbatim
    await handle.stop();
  });

  test("instanceId resolves from process.env.INSTANCE_ID first (D-12)", async () => {
    process.env.INSTANCE_ID = "explicit-instance-id";
    const redis = makeFakeRedis();

    const handle = startHeartbeatPublisher({
      redis,
      instanceId: resolveInstanceId(),
      getQueues: () => [],
      intervalMs: 60_000,
    });
    await flush();

    expect(redis.setCalls[0].key).toBe("worker:heartbeat:explicit-instance-id");
    await handle.stop();
  });

  test("heartbeat enumerates workers.map(w => w.name) array (lazy getQueues — matches worker.ts wire-up)", async () => {
    process.env.INSTANCE_ID = "queue-enum-host";
    const redis = makeFakeRedis();

    // Mirror exactly what apps/api/src/worker.ts passes:
    //   getQueues: () => workers.map((w) => w.name)
    const fakeWorkers = [{ name: "billing:sync-subscription" }, { name: "notifications-deliver" }];

    const handle = startHeartbeatPublisher({
      redis,
      instanceId: resolveInstanceId(),
      getQueues: () => fakeWorkers.map((w) => w.name),
      intervalMs: 60_000,
    });
    await flush();

    const payload = JSON.parse(redis.setCalls[0].value);
    expect(payload.queues).toEqual(["billing:sync-subscription", "notifications-deliver"]);
    await handle.stop();
  });

  test("stop() clears interval AND DELs the heartbeat key (D-14 graceful shutdown)", async () => {
    process.env.INSTANCE_ID = "shutdown-host";
    const redis = makeFakeRedis();

    const handle = startHeartbeatPublisher({
      redis,
      instanceId: resolveInstanceId(),
      getQueues: () => [],
      intervalMs: 50, // short interval so we can observe non-firing after stop()
    });
    await flush();
    const callsBeforeStop = redis.setCalls.length;

    await handle.stop();

    // DEL recorded with the exact key the SET used.
    expect(redis.delCalls).toEqual(["worker:heartbeat:shutdown-host"]);

    // Wait > 1 intervalMs — no additional SETs should fire after stop().
    await new Promise((r) => setTimeout(r, 80));
    expect(redis.setCalls.length).toBe(callsBeforeStop);
  });
});
