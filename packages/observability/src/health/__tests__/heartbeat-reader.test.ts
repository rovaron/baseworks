import { describe, expect, test } from "bun:test";
import { readHeartbeats } from "../heartbeat";

function makeFakeRedisWithKeys(
  pages: Array<{ cursor: string; keys: string[] }>,
  values: Record<string, string | null>,
) {
  const scanCalls: Array<[string, string, string, string, number]> = [];
  let pageIdx = 0;
  return {
    scanCalls,
    async scan(cursor: string, match: string, pattern: string, count: string, n: number) {
      scanCalls.push([cursor, match, pattern, count, n]);
      const page = pages[pageIdx++];
      return [page.cursor, page.keys];
    },
    async mget(...keys: string[]) {
      return keys.map((k) => values[k] ?? null);
    },
    // KEYS deliberately not implemented — readHeartbeats must NOT call it.
  } as any;
}

describe("readHeartbeats — D-12 SCAN-not-KEYS", () => {
  test("empty Redis → []", async () => {
    const redis = makeFakeRedisWithKeys([{ cursor: "0", keys: [] }], {});
    const out = await readHeartbeats(redis);
    expect(out).toEqual([]);
  });

  test("3 keys → 3 parsed payloads", async () => {
    const v1 = JSON.stringify({
      instanceId: "a",
      queues: ["q1"],
      lastHeartbeat: "2026-04-27T00:00:00.000Z",
    });
    const v2 = JSON.stringify({
      instanceId: "b",
      queues: [],
      lastHeartbeat: "2026-04-27T00:00:01.000Z",
    });
    const v3 = JSON.stringify({
      instanceId: "c",
      queues: ["q2"],
      lastHeartbeat: "2026-04-27T00:00:02.000Z",
      version: "1.0",
    });
    const redis = makeFakeRedisWithKeys(
      [
        {
          cursor: "0",
          keys: ["worker:heartbeat:a", "worker:heartbeat:b", "worker:heartbeat:c"],
        },
      ],
      {
        "worker:heartbeat:a": v1,
        "worker:heartbeat:b": v2,
        "worker:heartbeat:c": v3,
      },
    );
    const out = await readHeartbeats(redis);
    expect(out.length).toBe(3);
    expect(out.map((p) => p.instanceId).sort()).toEqual(["a", "b", "c"]);
  });

  test("uses SCAN with MATCH worker:heartbeat:* pattern", async () => {
    const redis = makeFakeRedisWithKeys([{ cursor: "0", keys: [] }], {});
    await readHeartbeats(redis);
    expect(redis.scanCalls.length).toBe(1);
    expect(redis.scanCalls[0]).toEqual(["0", "MATCH", "worker:heartbeat:*", "COUNT", 100]);
  });

  test("paginated SCAN walks until cursor returns to 0", async () => {
    const v = JSON.stringify({
      instanceId: "x",
      queues: [],
      lastHeartbeat: "2026-04-27T00:00:00.000Z",
    });
    const redis = makeFakeRedisWithKeys(
      [
        { cursor: "47", keys: ["worker:heartbeat:x1"] },
        { cursor: "0", keys: ["worker:heartbeat:x2"] },
      ],
      { "worker:heartbeat:x1": v, "worker:heartbeat:x2": v },
    );
    const out = await readHeartbeats(redis);
    expect(redis.scanCalls.length).toBe(2);
    expect(out.length).toBe(2);
  });

  test("malformed JSON is skipped (no throw)", async () => {
    const redis = makeFakeRedisWithKeys(
      [{ cursor: "0", keys: ["worker:heartbeat:bad", "worker:heartbeat:good"] }],
      {
        "worker:heartbeat:bad": "{not-json",
        "worker:heartbeat:good": JSON.stringify({
          instanceId: "g",
          queues: [],
          lastHeartbeat: "2026-04-27T00:00:00.000Z",
        }),
      },
    );
    const out = await readHeartbeats(redis);
    expect(out.length).toBe(1);
    expect(out[0].instanceId).toBe("g");
  });

  test("null mget value (TTL'd between SCAN and MGET) is skipped", async () => {
    const redis = makeFakeRedisWithKeys(
      [{ cursor: "0", keys: ["worker:heartbeat:dead", "worker:heartbeat:alive"] }],
      {
        "worker:heartbeat:dead": null,
        "worker:heartbeat:alive": JSON.stringify({
          instanceId: "alive",
          queues: [],
          lastHeartbeat: "2026-04-27T00:00:00.000Z",
        }),
      },
    );
    const out = await readHeartbeats(redis);
    expect(out.length).toBe(1);
    expect(out[0].instanceId).toBe("alive");
  });
});
