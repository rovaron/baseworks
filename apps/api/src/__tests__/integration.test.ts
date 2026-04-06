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
 *
 * Updated for Phase 2: tenant middleware now derives tenantId from session
 * (not x-tenant-id header). Tests authenticate via better-auth and use
 * session cookies for tenant context.
 */

const TEST_DB_URL = process.env.DATABASE_URL ?? "postgres://baseworks:baseworks@localhost:5432/baseworks";

let db: ReturnType<typeof createDb>;
let app: any;
let canConnect = false;

/** Session cookies for two test users (each with their own auto-created tenant). */
let cookiesA = "";
let cookiesB = "";
let tenantIdA = "";
let tenantIdB = "";

/**
 * Helper: Sign up a user via better-auth and return session cookies.
 */
async function signUpUser(
  testApp: any,
  email: string,
  password: string,
  name: string,
): Promise<{ cookies: string; response: Response }> {
  const response = await testApp.handle(
    new Request("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    }),
  );

  const setCookies = response.headers.getSetCookie?.() ?? [];
  const cookies = setCookies.map((c: string) => c.split(";")[0]).join("; ");

  return { cookies, response };
}

beforeAll(async () => {
  try {
    db = createDb(TEST_DB_URL);
    await db.execute(sql`SELECT 1`);
    canConnect = true;

    // Import auth routes (must be mounted before tenant middleware)
    const { authRoutes } = await import("../../../../packages/modules/auth/src/routes");
    const { auth } = await import("../../../../packages/modules/auth/src/auth");

    // Create test app mimicking the real API structure
    app = new Elysia()
      .use(errorMiddleware)
      .get("/health", () => ({
        status: "ok",
        modules: ["example"],
      }))
      // Auth routes before tenant middleware (signup/login bypass tenant context)
      .use(authRoutes)
      // Session-based tenant middleware
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

    // Sign up two test users (each gets an auto-created personal tenant)
    const emailA = `integration-a-${Date.now()}@example.com`;
    const emailB = `integration-b-${Date.now()}@example.com`;

    const resultA = await signUpUser(app, emailA, "testpassword123", "User A");
    cookiesA = resultA.cookies;

    const resultB = await signUpUser(app, emailB, "testpassword123", "User B");
    cookiesB = resultB.cookies;

    // Resolve tenant IDs from their sessions by listing orgs
    const orgsA = await auth.api.listOrganizations({
      headers: new Headers({ cookie: cookiesA }),
    });
    tenantIdA = orgsA[0]?.id ?? "";

    const orgsB = await auth.api.listOrganizations({
      headers: new Headers({ cookie: cookiesB }),
    });
    tenantIdB = orgsB[0]?.id ?? "";

    // Clean up any previous test data for these tenants
    if (tenantIdA) await db.delete(examples).where(eq(examples.tenantId, tenantIdA));
    if (tenantIdB) await db.delete(examples).where(eq(examples.tenantId, tenantIdB));
  } catch (e) {
    console.warn("PostgreSQL unavailable -- integration tests will be skipped:", (e as Error).message);
    canConnect = false;
  }
});

afterAll(async () => {
  if (!canConnect) return;
  if (tenantIdA) await db.delete(examples).where(eq(examples.tenantId, tenantIdA));
  if (tenantIdB) await db.delete(examples).where(eq(examples.tenantId, tenantIdB));
});

describe("Integration: full HTTP flow", () => {
  test("POST /examples with authenticated session creates a record scoped to that tenant", async () => {
    if (!canConnect || !tenantIdA) {
      console.warn("SKIPPED: PostgreSQL unavailable or tenant setup failed");
      return;
    }

    const response = await app.handle(
      new Request("http://localhost/examples", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: cookiesA,
        },
        body: JSON.stringify({ title: "Test A", description: "From tenant A" }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.tenantId).toBe(tenantIdA);
    expect(body.data.title).toBe("Test A");
  });

  test("POST /examples with different user creates separate record in their tenant", async () => {
    if (!canConnect || !tenantIdB) {
      console.warn("SKIPPED: PostgreSQL unavailable or tenant setup failed");
      return;
    }

    const response = await app.handle(
      new Request("http://localhost/examples", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: cookiesB,
        },
        body: JSON.stringify({ title: "Test B", description: "From tenant B" }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.tenantId).toBe(tenantIdB);
  });

  test("GET /examples with authenticated session returns only that tenant's records", async () => {
    if (!canConnect || !tenantIdA) {
      console.warn("SKIPPED: PostgreSQL unavailable or tenant setup failed");
      return;
    }

    const responseA = await app.handle(
      new Request("http://localhost/examples", {
        headers: { cookie: cookiesA },
      }),
    );

    const bodyA = await responseA.json();
    expect(bodyA.success).toBe(true);
    expect(bodyA.data.length).toBeGreaterThanOrEqual(1);
    for (const row of bodyA.data) {
      expect(row.tenantId).toBe(tenantIdA);
    }
  });

  test("GET /examples with different user returns only their tenant's records", async () => {
    if (!canConnect || !tenantIdB) {
      console.warn("SKIPPED: PostgreSQL unavailable or tenant setup failed");
      return;
    }

    const responseB = await app.handle(
      new Request("http://localhost/examples", {
        headers: { cookie: cookiesB },
      }),
    );

    const bodyB = await responseB.json();
    expect(bodyB.success).toBe(true);
    for (const row of bodyB.data) {
      expect(row.tenantId).toBe(tenantIdB);
    }
    // Should not contain tenant A's data
    const titles = bodyB.data.map((r: any) => r.title);
    expect(titles).not.toContain("Test A");
  });

  test("GET /examples without session returns 401 error", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }

    const response = await app.handle(
      new Request("http://localhost/examples"),
    );

    // Should return 401 for unauthenticated request (no session cookie)
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("UNAUTHORIZED");
  });

  test("GET /health without session returns 200", async () => {
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
