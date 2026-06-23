// Phase 22 / OPS-03 — /health/detailed RBAC + envelope + thresholds + freshness integration tests.
//
// Mocks `@baseworks/module-auth` with the same header-driven `requirePlatformAdmin` shape used by
// admin-bull-board.test.ts to keep the test convention consistent across OPS-* tests.
//
// Tests cover D-07 (envelope shape), D-09 (queue thresholds 100/1000), D-13 (worker freshness
// healthy/stale/dead bands), D-15 (recentErrors mapping firstFrame stripped), D-16 (module default).

// Side-effect import seeds env vars BEFORE the @baseworks/config barrel evaluates.
// Bun hoists `import` statements within a file, so inline `process.env.X ??= ...`
// at the top of THIS file would run AFTER the imports below — too late, since
// errorMiddleware → @baseworks/observability → @baseworks/config validates at
// import time. The side-effect module runs first per ES module evaluation order.
import "./_env-setup";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { RingBufferEntry } from "@baseworks/observability";
import type { HealthContributor } from "@baseworks/shared";
import { Elysia } from "elysia";
import { HealthAggregator } from "../src/core/health-aggregator";
import { errorMiddleware } from "../src/core/middleware/error";

function fakeQueue(
  name: string,
  counts: {
    waiting: number;
    active?: number;
    delayed?: number;
    completed?: number;
    failed?: number;
  },
) {
  return {
    name,
    async getJobCounts() {
      return {
        waiting: counts.waiting,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
      };
    },
    // biome-ignore lint/suspicious/noExplicitAny: test fake mimicking BullMQ Queue surface
  } as any;
}

function fakeRedisWithHeartbeats(
  payloads: Array<{ instanceId: string; queues: string[]; lastHeartbeat: string }>,
) {
  return {
    async scan(cursor: string) {
      if (cursor === "0") {
        return ["0", payloads.map((p) => `worker:heartbeat:${p.instanceId}`)] as [string, string[]];
      }
      return ["0", []] as [string, string[]];
    },
    async mget(...keys: string[]) {
      return keys.map((k) => {
        const id = k.replace("worker:heartbeat:", "");
        const p = payloads.find((x) => x.instanceId === id);
        return p ? JSON.stringify(p) : null;
      });
    },
    // biome-ignore lint/suspicious/noExplicitAny: test fake Redis surface
  } as any;
}

function installAuthMock() {
  // Header-driven requirePlatformAdmin mock — matches admin-bull-board.test.ts convention.
  // Operator-scope routes (/health/detailed) gate on requirePlatformAdmin.
  // No `x-test-role` header → throw "Unauthorized" → errorMiddleware → 401.
  mock.module("@baseworks/module-auth", () => ({
    // Platform-admin guard. Header-driven for tests: no header → 401,
    // `x-test-role: owner` simulates a platform admin → 200, otherwise → 403.
    requirePlatformAdmin: () => {
      return new Elysia({ name: "fake-require-platform-admin" }).derive(
        { as: "scoped" },
        // biome-ignore lint/suspicious/noExplicitAny: test mock
        ({ request }: any) => {
          const role = request.headers.get("x-test-role");
          if (!role) throw new Error("Unauthorized");
          if (role !== "owner") throw new Error("Forbidden");
          return { userId: "test-user" };
        },
      );
    },
  }));
}

async function buildApp(opts: {
  contributors?: HealthContributor[];
  // biome-ignore lint/suspicious/noExplicitAny: test fakes
  queues?: any[];
  // biome-ignore lint/suspicious/noExplicitAny: test fakes
  redis?: any;
  moduleNames?: string[];
  moduleStatuses?: Map<string, "healthy" | "degraded" | "unhealthy" | "unknown">;
  ringbufferEntries?: RingBufferEntry[];
  heartbeatIntervalMs?: number;
}) {
  installAuthMock();

  const aggregator = new HealthAggregator();
  for (const c of opts.contributors ?? []) aggregator.register(c);

  // Cache-bust the SUT import so the freshly mocked deps take effect.
  const cacheBust = `?t=${Date.now()}_${Math.random()}`;
  const mod = await import(`../src/routes/health-detailed${cacheBust}`);
  const plugin = mod.createHealthDetailedPlugin({
    aggregator,
    moduleQueues: opts.queues ?? [],
    redis: opts.redis ?? null,
    heartbeatIntervalMs: opts.heartbeatIntervalMs ?? 15_000,
    loadedModuleNames: () => opts.moduleNames ?? [],
    moduleStatuses: () => opts.moduleStatuses ?? new Map(),
    recentErrorsSnapshot: () => opts.ringbufferEntries ?? [],
  });
  return new Elysia().use(errorMiddleware).use(plugin);
}

describe("/health/detailed — RBAC (D-07)", () => {
  beforeEach(() => {
    installAuthMock();
  });

  test("unauthenticated → 401", async () => {
    const app = await buildApp({});
    const res = await app.handle(new Request("http://localhost/health/detailed"));
    expect(res.status).toBe(401);
  });

  test("member role → 403", async () => {
    const app = await buildApp({});
    const res = await app.handle(
      new Request("http://localhost/health/detailed", {
        headers: { "x-test-role": "member" },
      }),
    );
    expect(res.status).toBe(403);
  });

  test("owner role → 200 with envelope", async () => {
    const app = await buildApp({});
    const res = await app.handle(
      new Request("http://localhost/health/detailed", {
        headers: { "x-test-role": "owner" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    for (const k of [
      "status",
      "timestamp",
      "uptime",
      "queues",
      "workers",
      "db",
      "recentErrors",
      "modules",
    ]) {
      expect(Object.hasOwn(body.data, k)).toBe(true);
    }
    expect(typeof body.data.uptime).toBe("number");
    expect(body.data.uptime).toBeGreaterThanOrEqual(0);
  });
});

describe("/health/detailed — queue thresholds (D-09)", () => {
  beforeEach(() => {
    installAuthMock();
  });

  test("waiting 0/99/100/999/1000/1001 → healthy/healthy/warning/warning/critical/critical", async () => {
    const queues = [
      fakeQueue("q-0", { waiting: 0 }),
      fakeQueue("q-99", { waiting: 99 }),
      fakeQueue("q-100", { waiting: 100 }),
      fakeQueue("q-999", { waiting: 999 }),
      fakeQueue("q-1000", { waiting: 1000 }),
      fakeQueue("q-1001", { waiting: 1001 }),
    ];
    const app = await buildApp({ queues });
    const res = await app.handle(
      new Request("http://localhost/health/detailed", {
        headers: { "x-test-role": "owner" },
      }),
    );
    const body = await res.json();
    // biome-ignore lint/suspicious/noExplicitAny: test
    const statusByName = Object.fromEntries(body.data.queues.map((q: any) => [q.name, q.status]));
    expect(statusByName["q-0"]).toBe("healthy");
    expect(statusByName["q-99"]).toBe("healthy");
    expect(statusByName["q-100"]).toBe("warning");
    expect(statusByName["q-999"]).toBe("warning");
    expect(statusByName["q-1000"]).toBe("critical");
    expect(statusByName["q-1001"]).toBe("critical");
    for (const q of body.data.queues) {
      expect(q.thresholds).toEqual({ warn: 100, critical: 1000 });
    }
  });
});

describe("/health/detailed — worker freshness (D-13)", () => {
  beforeEach(() => {
    installAuthMock();
  });

  test("D-13 freshness bands — healthy < 2×interval, stale 2×–5×, dead ≥ 5×", async () => {
    // Test values pick representatives well clear of the 2×=30s and 5×=75s boundaries,
    // so async/event-loop overhead between `now = Date.now()` capture in the test and
    // the endpoint's own `Date.now()` cannot perturb the band classification. Plan
    // boundary values 29_999 / 74_999 ms were 1ms below the threshold and intermittently
    // crossed it under real test runtime — Rule 1 fix.
    const intervalMs = 15_000;
    const now = Date.now();
    const heartbeats = [
      { instanceId: "h-fresh", queues: [], lastHeartbeat: new Date(now - 0).toISOString() },
      {
        instanceId: "h-healthy-edge",
        queues: [],
        lastHeartbeat: new Date(now - 25_000).toISOString(),
      },
      {
        instanceId: "h-stale-low",
        queues: [],
        lastHeartbeat: new Date(now - 31_000).toISOString(),
      },
      {
        instanceId: "h-stale-high",
        queues: [],
        lastHeartbeat: new Date(now - 60_000).toISOString(),
      },
      { instanceId: "h-dead", queues: [], lastHeartbeat: new Date(now - 76_000).toISOString() },
    ];
    const redis = fakeRedisWithHeartbeats(heartbeats);
    const app = await buildApp({ redis, heartbeatIntervalMs: intervalMs });
    const res = await app.handle(
      new Request("http://localhost/health/detailed", {
        headers: { "x-test-role": "owner" },
      }),
    );
    const body = await res.json();
    const statusByName: Record<string, string> = Object.fromEntries(
      // biome-ignore lint/suspicious/noExplicitAny: test
      body.data.workers.map((w: any) => [w.instanceId, w.status]),
    );
    expect(statusByName["h-fresh"]).toBe("healthy");
    expect(statusByName["h-healthy-edge"]).toBe("healthy");
    expect(statusByName["h-stale-low"]).toBe("stale");
    expect(statusByName["h-stale-high"]).toBe("stale");
    expect(statusByName["h-dead"]).toBe("dead");
  });

  test("ageSec rounding — heartbeat ~12s ago → ageSec === 12", async () => {
    const now = Date.now();
    const heartbeats = [
      {
        instanceId: "h",
        queues: ["q"],
        lastHeartbeat: new Date(now - 12_000).toISOString(),
      },
    ];
    const redis = fakeRedisWithHeartbeats(heartbeats);
    const app = await buildApp({ redis });
    const res = await app.handle(
      new Request("http://localhost/health/detailed", {
        headers: { "x-test-role": "owner" },
      }),
    );
    const body = await res.json();
    // biome-ignore lint/suspicious/noExplicitAny: test
    const w = body.data.workers.find((x: any) => x.instanceId === "h");
    expect(w.ageSec).toBeGreaterThanOrEqual(11);
    expect(w.ageSec).toBeLessThanOrEqual(13);
  });
});

describe("/health/detailed — modules (D-16)", () => {
  beforeEach(() => {
    installAuthMock();
  });

  test("loaded module without contributor defaults to healthy", async () => {
    const app = await buildApp({ moduleNames: ["auth"] });
    const res = await app.handle(
      new Request("http://localhost/health/detailed", {
        headers: { "x-test-role": "owner" },
      }),
    );
    const body = await res.json();
    expect(body.data.modules).toContainEqual({
      name: "auth",
      loaded: true,
      status: "healthy",
    });
  });

  test("module with contributor reports its status", async () => {
    const app = await buildApp({
      moduleNames: ["billing"],
      moduleStatuses: new Map([["billing", "degraded"]]),
    });
    const res = await app.handle(
      new Request("http://localhost/health/detailed", {
        headers: { "x-test-role": "owner" },
      }),
    );
    const body = await res.json();
    expect(body.data.modules[0]).toEqual({
      name: "billing",
      loaded: true,
      status: "degraded",
    });
  });
});

describe("/health/detailed — recentErrors (D-15)", () => {
  beforeEach(() => {
    installAuthMock();
  });

  test("ringbuffer entries flow into envelope with envelope keys only (no firstFrame leak)", async () => {
    const ringbufferEntries: RingBufferEntry[] = [
      {
        timestamp: "2026-04-27T00:00:00.000Z",
        message: "boom",
        source: "cqrs",
        count: 3,
        firstFrame: "at fn (/x.ts:1:1)",
      },
      {
        timestamp: "2026-04-27T00:00:01.000Z",
        message: "splat",
        source: "http",
        count: 1,
        firstFrame: "at gn (/y.ts:1:1)",
      },
    ];
    const app = await buildApp({ ringbufferEntries });
    const res = await app.handle(
      new Request("http://localhost/health/detailed", {
        headers: { "x-test-role": "owner" },
      }),
    );
    const body = await res.json();
    expect(body.data.recentErrors.length).toBe(2);
    expect(body.data.recentErrors[0]).toEqual({
      timestamp: "2026-04-27T00:00:00.000Z",
      message: "boom",
      source: "cqrs",
      count: 3,
    });
    // firstFrame is internal — must NOT appear in the envelope (T-22-07 mitigation).
    expect("firstFrame" in body.data.recentErrors[0]).toBe(false);
  });
});

describe("/health/detailed — storage contributor surfacing (Phase 31 / QUO-03, OPS-03)", () => {
  beforeEach(() => {
    installAuthMock();
  });

  test("storage contributor details (adapter/quota/jobs) surface at data.storage", async () => {
    const storageContributor: HealthContributor = {
      name: "storage",
      check: async () => ({
        status: "degraded",
        details: {
          provider: "local",
          adapter: {
            reachable: true,
            kind: "local-disk",
            detail: "disk-free 38%",
            diskFreePct: 38,
          },
          quota: {
            tenantCount: 2,
            topTenants: [
              { tenantId: "t-1", bytesUsed: 900, bytesLimit: 1000, pctUsed: 0.9 },
              { tenantId: "t-2", bytesUsed: 10, bytesLimit: 1000, pctUsed: 0.01 },
            ],
            tenantsAtWarn: 1,
            tenantsAtLimit: 0,
          },
          jobs: [
            {
              name: "cleanup-reap-pending-uploads",
              lastRunAt: "2026-06-18T00:00:00.000Z",
              status: "ok",
              itemsSwept: 3,
              durationMs: 12,
              ageSec: 60,
              stale: false,
            },
          ],
        },
      }),
    };
    const app = await buildApp({ contributors: [storageContributor] });
    const res = await app.handle(
      new Request("http://localhost/health/detailed", {
        headers: { "x-test-role": "owner" },
      }),
    );
    const body = await res.json();
    expect(body.data.storage).toBeDefined();
    expect(body.data.storage.status).toBe("degraded");
    expect(body.data.storage.adapter.reachable).toBe(true);
    expect(Array.isArray(body.data.storage.quota.topTenants)).toBe(true);
    expect(body.data.storage.quota.topTenants[0].tenantId).toBe("t-1");
    expect(Array.isArray(body.data.storage.jobs)).toBe(true);
    expect(body.data.storage.jobs[0].name).toBe("cleanup-reap-pending-uploads");
    // No storage_key / bucket / secrets leak into the operator surface.
    const serialized = JSON.stringify(body.data.storage);
    expect(serialized.includes("storage_key")).toBe(false);
    expect(serialized.includes("bucket")).toBe(false);
  });

  test("no storage contributor registered → data.storage absent", async () => {
    const app = await buildApp({});
    const res = await app.handle(
      new Request("http://localhost/health/detailed", {
        headers: { "x-test-role": "owner" },
      }),
    );
    const body = await res.json();
    expect(Object.hasOwn(body.data, "storage")).toBe(false);
  });
});

describe("/health/detailed — overall status (worst-of-N)", () => {
  beforeEach(() => {
    installAuthMock();
  });

  test("one unhealthy contributor → response.data.status === unhealthy", async () => {
    const app = await buildApp({
      contributors: [{ name: "x", check: async () => ({ status: "unhealthy" }) }],
    });
    const res = await app.handle(
      new Request("http://localhost/health/detailed", {
        headers: { "x-test-role": "owner" },
      }),
    );
    const body = await res.json();
    expect(body.data.status).toBe("unhealthy");
  });
});
