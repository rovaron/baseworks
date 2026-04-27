// Phase 22 / OPS-03 — /health/detailed RBAC + envelope + thresholds + freshness integration tests.
//
// Mocks `@baseworks/module-auth` with the same header-driven `requireRole` shape used by
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

import { describe, expect, test, beforeEach, mock } from "bun:test";
import { Elysia } from "elysia";
import { errorMiddleware } from "../src/core/middleware/error";
import { HealthAggregator } from "../src/core/health-aggregator";
import type { HealthContributor } from "@baseworks/shared";
import type { RingBufferEntry } from "@baseworks/observability";

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
        return ["0", payloads.map((p) => `worker:heartbeat:${p.instanceId}`)] as [
          string,
          string[],
        ];
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

function installRequireRoleMock() {
  // Header-driven requireRole mock — matches admin-bull-board.test.ts convention.
  // No `x-test-role` header → throw "Unauthorized" → errorMiddleware → 401.
  // `x-test-role: member` with roles=["owner"] → throw "Forbidden" → errorMiddleware → 403.
  // `x-test-role: owner` → resolves a session and the handler runs → 200.
  mock.module("@baseworks/module-auth", () => ({
    requireRole: (...roles: string[]) => {
      return new Elysia({ name: `fake-require-role-${roles.join(",")}` }).derive(
        { as: "scoped" },
        // biome-ignore lint/suspicious/noExplicitAny: test mock
        ({ request }: any) => {
          const role = request.headers.get("x-test-role");
          if (!role) throw new Error("Unauthorized");
          if (!roles.includes(role)) throw new Error("Forbidden");
          return { userId: "test-user", memberRole: role };
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
  installRequireRoleMock();

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
    installRequireRoleMock();
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
      expect(Object.prototype.hasOwnProperty.call(body.data, k)).toBe(true);
    }
    expect(typeof body.data.uptime).toBe("number");
    expect(body.data.uptime).toBeGreaterThanOrEqual(0);
  });
});

describe("/health/detailed — queue thresholds (D-09)", () => {
  beforeEach(() => {
    installRequireRoleMock();
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
    installRequireRoleMock();
  });

  test("ages 0/29999/30000/74999/75000 ms → healthy/healthy/stale/stale/dead", async () => {
    const intervalMs = 15_000;
    const now = Date.now();
    const heartbeats = [
      { instanceId: "h0", queues: [], lastHeartbeat: new Date(now - 0).toISOString() },
      { instanceId: "h29999", queues: [], lastHeartbeat: new Date(now - 29_999).toISOString() },
      { instanceId: "h30000", queues: [], lastHeartbeat: new Date(now - 30_000).toISOString() },
      { instanceId: "h74999", queues: [], lastHeartbeat: new Date(now - 74_999).toISOString() },
      { instanceId: "h75000", queues: [], lastHeartbeat: new Date(now - 75_000).toISOString() },
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
    expect(statusByName["h0"]).toBe("healthy");
    expect(statusByName["h29999"]).toBe("healthy");
    expect(statusByName["h30000"]).toBe("stale");
    expect(statusByName["h74999"]).toBe("stale");
    expect(statusByName["h75000"]).toBe("dead");
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
    installRequireRoleMock();
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
    installRequireRoleMock();
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

describe("/health/detailed — overall status (worst-of-N)", () => {
  beforeEach(() => {
    installRequireRoleMock();
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
