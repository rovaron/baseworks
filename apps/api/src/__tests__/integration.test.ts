import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Elysia, t } from "elysia";
import { createDb, scopedDb, examples } from "@baseworks/db";
import { eq, sql } from "drizzle-orm";
import type { HandlerContext } from "@baseworks/shared";
import { tenantMiddleware } from "../core/middleware/tenant";
import { errorMiddleware } from "../core/middleware/error";
import { createExample } from "../../../../packages/modules/example/src/commands/create-example";
import { listExamples } from "../../../../packages/modules/example/src/queries/list-examples";

/**
 * Integration tests for the full HTTP -> tenant middleware -> scopedDb flow.
 * Uses Elysia's .handle() for HTTP-level testing without starting a real server.
 * Requires PostgreSQL for database operations.
 */

const TEST_DB_URL = process.env.DATABASE_URL ?? "postgres://baseworks:baseworks@localhost:5432/baseworks";

let db: ReturnType<typeof createDb>;
let app: any;
let canConnect = false;

beforeAll(async () => {
  try {
    db = createDb(TEST_DB_URL);
    await db.execute(sql`SELECT 1`);
    canConnect = true;

    // Clean up previous test data
    await db.delete(examples).where(eq(examples.tenantId, "test-tenant-a"));
    await db.delete(examples).where(eq(examples.tenantId, "test-tenant-b"));

    // Create test app mimicking the real API structure
    app = new Elysia()
      .use(errorMiddleware)
      .get("/health", () => ({
        status: "ok",
        modules: ["example"],
      }))
      .use(tenantMiddleware)
      .derive({ as: "scoped" }, (ctx: any) => {
        const tenantId: string = ctx.tenantId;
        return {
          handlerCtx: {
            tenantId,
            db: scopedDb(db, tenantId),
            emit: () => {},
          } satisfies HandlerContext,
        };
      })
      .post(
        "/examples",
        async ({ handlerCtx, body }: any) => {
          return createExample(body, handlerCtx);
        },
        {
          body: t.Object({
            title: t.String({ minLength: 1 }),
            description: t.Optional(t.String()),
          }),
        },
      )
      .get("/examples", async ({ handlerCtx }: any) => {
        return listExamples({}, handlerCtx);
      });
  } catch (e) {
    console.warn("PostgreSQL unavailable -- integration tests will be skipped:", (e as Error).message);
    canConnect = false;
  }
});

afterAll(async () => {
  if (!canConnect) return;
  await db.delete(examples).where(eq(examples.tenantId, "test-tenant-a"));
  await db.delete(examples).where(eq(examples.tenantId, "test-tenant-b"));
});

describe("Integration: full HTTP flow", () => {
  test("POST /examples with x-tenant-id creates a record scoped to that tenant", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }

    const response = await app.handle(
      new Request("http://localhost/examples", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": "test-tenant-a",
        },
        body: JSON.stringify({ title: "Test A", description: "From tenant A" }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.tenantId).toBe("test-tenant-a");
    expect(body.data.title).toBe("Test A");
  });

  test("POST /examples with different tenant creates separate record", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }

    const response = await app.handle(
      new Request("http://localhost/examples", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": "test-tenant-b",
        },
        body: JSON.stringify({ title: "Test B", description: "From tenant B" }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.tenantId).toBe("test-tenant-b");
  });

  test("GET /examples with x-tenant-id returns only that tenant's records", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }

    const responseA = await app.handle(
      new Request("http://localhost/examples", {
        headers: { "x-tenant-id": "test-tenant-a" },
      }),
    );

    const bodyA = await responseA.json();
    expect(bodyA.success).toBe(true);
    expect(bodyA.data.length).toBeGreaterThanOrEqual(1);
    for (const row of bodyA.data) {
      expect(row.tenantId).toBe("test-tenant-a");
    }
  });

  test("GET /examples with different tenant returns only its records", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }

    const responseB = await app.handle(
      new Request("http://localhost/examples", {
        headers: { "x-tenant-id": "test-tenant-b" },
      }),
    );

    const bodyB = await responseB.json();
    expect(bodyB.success).toBe(true);
    for (const row of bodyB.data) {
      expect(row.tenantId).toBe("test-tenant-b");
    }
    // Should not contain tenant A's data
    const titles = bodyB.data.map((r: any) => r.title);
    expect(titles).not.toContain("Test A");
  });

  test("GET /examples without x-tenant-id returns 401 error", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }

    const response = await app.handle(
      new Request("http://localhost/examples"),
    );

    // Should return error status (401 for missing tenant context)
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("MISSING_TENANT_CONTEXT");
  });

  test("GET /health without x-tenant-id returns 200", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }

    const response = await app.handle(
      new Request("http://localhost/health"),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
  });
});
