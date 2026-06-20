import { describe, expect, test } from "bun:test";
import type { HealthCheckResult } from "@baseworks/shared";
import { HealthAggregator } from "../health-aggregator";

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

describe("HealthAggregator — rollup", () => {
  test("empty contributors → healthy", async () => {
    const agg = new HealthAggregator();
    const r = await agg.aggregate();
    expect(r.status).toBe("healthy");
    expect(r.contributors.length).toBe(0);
    expect(typeof r.durationMs).toBe("number");
    expect(typeof r.timestamp).toBe("string");
  });

  test("single healthy → healthy", async () => {
    const agg = new HealthAggregator();
    agg.register({ name: "a", check: async () => ({ status: "healthy" }) });
    expect((await agg.aggregate()).status).toBe("healthy");
  });

  test("single degraded → degraded", async () => {
    const agg = new HealthAggregator();
    agg.register({ name: "a", check: async () => ({ status: "degraded" }) });
    expect((await agg.aggregate()).status).toBe("degraded");
  });

  test("single unhealthy → unhealthy", async () => {
    const agg = new HealthAggregator();
    agg.register({ name: "a", check: async () => ({ status: "unhealthy" }) });
    expect((await agg.aggregate()).status).toBe("unhealthy");
  });

  test("degraded + unhealthy → unhealthy (worst-of-N)", async () => {
    const agg = new HealthAggregator();
    agg.register({ name: "a", check: async () => ({ status: "degraded" }) });
    agg.register({ name: "b", check: async () => ({ status: "unhealthy" }) });
    expect((await agg.aggregate()).status).toBe("unhealthy");
  });

  test("healthy + degraded → degraded", async () => {
    const agg = new HealthAggregator();
    agg.register({ name: "a", check: async () => ({ status: "healthy" }) });
    agg.register({ name: "b", check: async () => ({ status: "degraded" }) });
    expect((await agg.aggregate()).status).toBe("degraded");
  });
});

describe("HealthAggregator — parallelism", () => {
  test("two 50ms contributors run in parallel (durationMs < 100ms)", async () => {
    const agg = new HealthAggregator();
    agg.register({
      name: "a",
      check: () => delay(50, { status: "healthy" } satisfies HealthCheckResult),
    });
    agg.register({
      name: "b",
      check: () => delay(50, { status: "healthy" } satisfies HealthCheckResult),
    });
    const r = await agg.aggregate();
    expect(r.status).toBe("healthy");
    expect(r.durationMs).toBeLessThan(100);
  });
});

describe("HealthAggregator — timeout (D-11 / Pitfall 4)", () => {
  test("default 2000ms timeout — slow contributor returns unhealthy without aggregate exceeding 2500ms", async () => {
    const agg = new HealthAggregator();
    agg.register({
      name: "slow",
      check: () => delay(3000, { status: "healthy" } satisfies HealthCheckResult),
    });
    const start = Date.now();
    const r = await agg.aggregate();
    expect(Date.now() - start).toBeLessThan(2500);
    const slow = r.contributors.find((c) => c.name === "slow");
    expect(slow?.result.status).toBe("unhealthy");
    expect(slow?.result.details?.error).toBe("timeout");
  });

  test("custom timeoutMs=500 — 1500ms contributor returns timeout", async () => {
    const agg = new HealthAggregator();
    agg.register({
      name: "slow",
      timeoutMs: 500,
      check: () => delay(1500, { status: "healthy" } satisfies HealthCheckResult),
    });
    const r = await agg.aggregate();
    const slow = r.contributors.find((c) => c.name === "slow");
    expect(slow?.result.status).toBe("unhealthy");
    expect(slow?.result.details?.error).toBe("timeout");
  });

  test("thrown contributor → unhealthy, no aggregate throw", async () => {
    const agg = new HealthAggregator();
    agg.register({
      name: "broken",
      check: async () => {
        throw new Error("kaboom");
      },
    });
    const r = await agg.aggregate();
    const broken = r.contributors.find((c) => c.name === "broken");
    expect(broken?.result.status).toBe("unhealthy");
    expect(String(broken?.result.details?.error)).toContain("kaboom");
  });

  test("no unhandled rejection escapes after timeout (slow promise eventually settles)", async () => {
    const rejections: unknown[] = [];
    const handler = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", handler);
    try {
      const agg = new HealthAggregator();
      agg.register({
        name: "slow-throw",
        timeoutMs: 50,
        check: () =>
          new Promise((_resolve, reject) => setTimeout(() => reject(new Error("late")), 200)),
      });
      await agg.aggregate();
      // Wait past the slow promise's settlement window
      await delay(300, null);
      expect(rejections.length).toBe(0);
    } finally {
      process.off("unhandledRejection", handler);
    }
  });
});

describe("HealthAggregator — cache (D-11)", () => {
  test("second call within 5s returns cached value (no re-invoke)", async () => {
    const agg = new HealthAggregator();
    let calls = 0;
    agg.register({
      name: "a",
      check: async () => {
        calls++;
        return { status: "healthy" };
      },
    });
    const r1 = await agg.aggregate();
    const r2 = await agg.aggregate();
    expect(calls).toBe(1);
    expect(r2).toBe(r1); // same object reference (cache hit returns the stored object)
  });

  test("clearCache() forces re-invoke", async () => {
    const agg = new HealthAggregator();
    let calls = 0;
    agg.register({
      name: "a",
      check: async () => {
        calls++;
        return { status: "healthy" };
      },
    });
    await agg.aggregate();
    agg.clearCache();
    await agg.aggregate();
    expect(calls).toBe(2);
  });
});

describe("HealthAggregator — getContributors", () => {
  test("returns the registered contributors in registration order", () => {
    const agg = new HealthAggregator();
    agg.register({ name: "a", check: async () => ({ status: "healthy" }) });
    agg.register({ name: "b", check: async () => ({ status: "healthy" }) });
    const contributors = agg.getContributors();
    expect(contributors.length).toBe(2);
    expect(contributors[0].name).toBe("a");
    expect(contributors[1].name).toBe("b");
  });
});
