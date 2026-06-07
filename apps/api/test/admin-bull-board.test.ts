// Phase 22 / OPS-01 / D-01..D-04 — RBAC + CSP + readOnly + uiBasePath integration tests
// for the bull-board mount factory at apps/api/src/routes/bull-board.ts.
//
// Mocks installed BEFORE the SUT module is imported so spy calls capture every construction.
// The `@baseworks/module-auth` mock injects a header-driven session derive — exactly the
// same shape Plan 22-05 Task 1 uses, ensuring a single shared mock convention across
// all OPS-* test files.

// Seed required env vars BEFORE any module imports them — @baseworks/config validates
// at import time via t3-oss/env-core, so DATABASE_URL + BETTER_AUTH_SECRET must be
// present even though the test mocks the env object for SUT. The errorMiddleware
// import chain pulls in @baseworks/observability → @baseworks/config (factory.ts).
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-min-32-chars-long-xxxxxxxxxxxxxxx";
process.env.NODE_ENV ??= "test";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Elysia } from "elysia";
import { errorMiddleware } from "../src/core/middleware/error";

// -- Spy state shared across mocks. Reset at every installMocks() call. --
const bullMQAdapterCalls: Array<{ readOnlyMode?: boolean }> = [];
const createBullBoardCalls: Array<{
  uiBasePath?: string;
  queueCount: number;
}> = [];

function installMocks() {
  bullMQAdapterCalls.length = 0;
  createBullBoardCalls.length = 0;

  // Header-driven requireRole mock — mirror exactly the pattern Plan 22-05 Task 1 uses.
  // Without a session header (`x-test-role`) → throw "Unauthorized" → errorMiddleware → 401.
  // With `x-test-role: member` and roles=["owner"] → throw "Forbidden" → errorMiddleware → 403.
  // With `x-test-role: owner` → resolves a session and downstream handler runs → 200.
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
    // Platform-admin guard (operator-scope routes now gate on this instead of
    // requireRole("owner")). Header-driven for tests: no header → 401,
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

  mock.module("@bull-board/api/bullMQAdapter", () => ({
    BullMQAdapter: class {
      constructor(_queue: unknown, opts?: { readOnlyMode?: boolean }) {
        bullMQAdapterCalls.push({ readOnlyMode: opts?.readOnlyMode });
      }
    },
  }));

  mock.module("@bull-board/api", () => ({
    createBullBoard: (opts: {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      queues: any[];
      options?: { uiBasePath?: string };
    }) => {
      createBullBoardCalls.push({
        uiBasePath: opts.options?.uiBasePath,
        queueCount: opts.queues.length,
      });
    },
  }));

  mock.module("@bull-board/elysia", () => ({
    ElysiaAdapter: class {
      constructor(_opts: { basePath: string; prefix: string }) {}
      async registerPlugin(): Promise<Elysia> {
        // Return a minimal Elysia subtree to simulate bull-board's routes.
        return new Elysia({ name: "fake-bull-board-subtree" })
          .get("/admin/bull-board", () => "ui-html")
          .get("/admin/bull-board/static/main.css", () => "css");
      }
    },
  }));
}

async function buildApp(envOverrides: Record<string, string | undefined>) {
  // Reset env via mock.module on @baseworks/config — every read of env reflects overrides.
  mock.module("@baseworks/config", () => ({
    env: {
      ADMIN_URL:
        envOverrides.ADMIN_URL === undefined ? "http://localhost:5173" : envOverrides.ADMIN_URL,
      BULL_BOARD_READ_ONLY: envOverrides.BULL_BOARD_READ_ONLY ?? "true",
    },
  }));
  // Cache-bust the SUT import so the freshly mocked deps take effect.
  const cacheBust = `?t=${Date.now()}_${Math.random()}`;
  const mod = await import(`../src/routes/bull-board${cacheBust}`);
  const plugin = await mod.createBullBoardPlugin([]);
  return new Elysia().use(errorMiddleware).use(plugin);
}

describe("bull-board RBAC + CSP + readOnly (OPS-01 / D-02..D-04)", () => {
  beforeEach(() => {
    installMocks();
  });

  test("unauthenticated GET /admin/bull-board → 401", async () => {
    const app = await buildApp({});
    const res = await app.handle(new Request("http://localhost/admin/bull-board"));
    expect(res.status).toBe(401);
  });

  test("unauthenticated GET /admin/bull-board/static/main.css → 401 (D-03 static asset gating)", async () => {
    const app = await buildApp({});
    const res = await app.handle(new Request("http://localhost/admin/bull-board/static/main.css"));
    expect(res.status).toBe(401);
  });

  test("authenticated member-role GET /admin/bull-board → 403 (D-03 wrong-role rejection)", async () => {
    const app = await buildApp({});
    const res = await app.handle(
      new Request("http://localhost/admin/bull-board", {
        headers: { "x-test-role": "member" },
      }),
    );
    expect(res.status).toBe(403);
  });

  test("CSP frame-ancestors set to ADMIN_URL on every bull-board response", async () => {
    const app = await buildApp({ ADMIN_URL: "http://localhost:5173" });
    // Hits requireRole → 401, but onAfterHandle CSP must apply regardless.
    const res = await app.handle(new Request("http://localhost/admin/bull-board"));
    const csp = res.headers.get("content-security-policy");
    expect(csp).toBe("frame-ancestors 'http://localhost:5173'");
  });

  test("CSP degrades to 'none' when ADMIN_URL unset (D-04)", async () => {
    const app = await buildApp({ ADMIN_URL: "" });
    const res = await app.handle(new Request("http://localhost/admin/bull-board"));
    const csp = res.headers.get("content-security-policy");
    expect(csp).toBe("frame-ancestors 'none'");
  });

  test('readOnlyMode=true when env BULL_BOARD_READ_ONLY="true"', async () => {
    installMocks();
    mock.module("@baseworks/config", () => ({
      env: {
        ADMIN_URL: "http://localhost:5173",
        BULL_BOARD_READ_ONLY: "true",
      },
    }));
    const cacheBust = `?t=${Date.now()}_${Math.random()}`;
    const mod = await import(`../src/routes/bull-board${cacheBust}`);
    // biome-ignore lint/suspicious/noExplicitAny: test fake queue
    await mod.createBullBoardPlugin([{} as any]);
    expect(bullMQAdapterCalls.length).toBe(1);
    expect(bullMQAdapterCalls[0].readOnlyMode).toBe(true);
  });

  test('readOnlyMode=false when env BULL_BOARD_READ_ONLY="false"', async () => {
    installMocks();
    mock.module("@baseworks/config", () => ({
      env: {
        ADMIN_URL: "http://localhost:5173",
        BULL_BOARD_READ_ONLY: "false",
      },
    }));
    const cacheBust = `?t=${Date.now()}_${Math.random()}`;
    const mod = await import(`../src/routes/bull-board${cacheBust}`);
    // biome-ignore lint/suspicious/noExplicitAny: test fake queue
    await mod.createBullBoardPlugin([{} as any]);
    expect(bullMQAdapterCalls.length).toBe(1);
    expect(bullMQAdapterCalls[0].readOnlyMode).toBe(false);
  });

  test("uiBasePath = 'node_modules/@bull-board/ui' (Pitfall 1 Bun workaround)", async () => {
    installMocks();
    mock.module("@baseworks/config", () => ({
      env: {
        ADMIN_URL: "http://localhost:5173",
        BULL_BOARD_READ_ONLY: "true",
      },
    }));
    const cacheBust = `?t=${Date.now()}_${Math.random()}`;
    const mod = await import(`../src/routes/bull-board${cacheBust}`);
    await mod.createBullBoardPlugin([]);
    const last = createBullBoardCalls[createBullBoardCalls.length - 1];
    expect(last?.uiBasePath).toBe("node_modules/@bull-board/ui");
  });

  test("CSP does NOT leak to other routes (Pitfall 6)", async () => {
    installMocks();
    // A separate, unrelated plugin — bull-board's onAfterHandle must not affect it.
    const otherPlugin = new Elysia({ name: "other" }).get("/api/admin/tenants", () => ({
      data: [],
    }));
    const composed = new Elysia().use(errorMiddleware).use(otherPlugin);
    const res = await composed.handle(new Request("http://localhost/api/admin/tenants"));
    expect(res.headers.get("content-security-policy")).toBeNull();
  });
});
