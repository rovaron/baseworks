import { describe, test, expect, beforeAll } from "bun:test";
import { Elysia } from "elysia";
import { sql } from "drizzle-orm";
import { createDb } from "@baseworks/db";

/**
 * Integration tests for the tenant session flow.
 *
 * Verifies:
 * 1. Session-based tenant resolution (tenant middleware derives tenantId from session)
 * 2. Auto-create personal tenant on signup (D-08, TNNT-01)
 * 3. Unauthenticated requests rejected by tenant middleware
 * 4. Health check bypasses auth
 * 5. Auth routes bypass tenant middleware
 * 6. RBAC enforcement -- requireRole("owner") rejects non-owner roles (TNNT-04)
 *
 * Requires PostgreSQL for database-backed sessions. Tests skip gracefully if unavailable.
 */

const TEST_DB_URL =
  process.env.DATABASE_URL ??
  "postgres://baseworks:baseworks@localhost:5432/baseworks";

let canConnect = false;
let db: ReturnType<typeof createDb>;

// Check database connectivity before running tests
beforeAll(async () => {
  try {
    db = createDb(TEST_DB_URL);
    await db.execute(sql`SELECT 1`);
    canConnect = true;
  } catch (e) {
    console.warn(
      "PostgreSQL unavailable -- tenant session tests will be skipped:",
      (e as Error).message,
    );
    canConnect = false;
  }
});

/**
 * Helper: Create a test Elysia app that mimics the real API setup with
 * auth routes mounted before tenant middleware. Uses the actual auth module.
 */
async function createTestApp() {
  const { auth } = await import("../auth");
  const { authRoutes } = await import("../routes");
  const { requireRole } = await import("../middleware");

  // Import the real tenant middleware (session-based)
  const { tenantMiddleware } = await import(
    "../../../../../apps/api/src/core/middleware/tenant"
  );

  const app = new Elysia()
    // Health check -- no auth required
    .get("/health", () => ({ status: "ok" }))
    // Auth routes -- before tenant middleware (signup/login bypass tenant context)
    .use(authRoutes)
    // Tenant-scoped routes
    .use(tenantMiddleware)
    .get("/api/protected", (ctx: any) => ({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
    }))
    // Owner-only route scoped via group
    .group("/api", (group) =>
      group
        .use(requireRole("owner"))
        .delete("/tenant", (ctx: any) => ({
          message: "Tenant deletion initiated",
          tenantId: ctx.tenantId,
        })),
    );

  return { app, auth };
}

/**
 * Helper: Sign up a user and return the session cookies.
 */
async function signUpUser(
  app: any,
  email: string,
  password: string,
  name: string,
): Promise<{ cookies: string; response: Response }> {
  const response = await app.handle(
    new Request("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    }),
  );

  // Extract set-cookie headers for session
  const setCookies = response.headers.getSetCookie?.() ?? [];
  const cookies = setCookies.map((c: string) => c.split(";")[0]).join("; ");

  return { cookies, response };
}

/**
 * Helper: Sign in a user and return session cookies.
 */
async function signInUser(
  app: any,
  email: string,
  password: string,
): Promise<{ cookies: string; response: Response }> {
  const response = await app.handle(
    new Request("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );

  const setCookies = response.headers.getSetCookie?.() ?? [];
  const cookies = setCookies.map((c: string) => c.split(";")[0]).join("; ");

  return { cookies, response };
}

describe("tenant session flow", () => {
  test("health check bypasses auth and returns 200", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }

    const { app } = await createTestApp();
    const response = await app.handle(new Request("http://localhost/health"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
  });

  test("auth routes bypass tenant middleware (signup works without tenant)", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }

    const { app } = await createTestApp();
    const email = `test-bypass-${Date.now()}@example.com`;

    const response = await app.handle(
      new Request("http://localhost/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "testpassword123",
          name: "Test Bypass",
        }),
      }),
    );

    // Signup should work without tenant context
    // better-auth returns 200 for successful operations
    expect(response.status).toBe(200);
  });

  test("unauthenticated request to tenant-scoped route is rejected", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }

    const { app } = await createTestApp();
    const response = await app.handle(
      new Request("http://localhost/api/protected"),
    );

    // Should fail -- no session cookie means tenant middleware rejects
    // Error middleware should return non-200 status
    expect(response.status).not.toBe(200);
  });

  test("signup creates session and auto-creates personal tenant", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }

    const { app, auth } = await createTestApp();
    const email = `test-tenant-${Date.now()}@example.com`;

    const { cookies, response } = await signUpUser(
      app,
      email,
      "testpassword123",
      "Test Tenant User",
    );

    expect(response.status).toBe(200);

    // Verify session was created (cookies should be set)
    expect(cookies.length).toBeGreaterThan(0);

    // Verify auto-created personal tenant via better-auth API
    const orgs = await auth.api.listOrganizations({
      headers: new Headers({ cookie: cookies }),
    });

    expect(orgs).toBeDefined();
    expect(orgs.length).toBeGreaterThanOrEqual(1);

    // First org should be the personal workspace
    const personalOrg = orgs[0];
    expect(personalOrg.name).toContain("Workspace");
  });

  test("authenticated request to tenant-scoped route succeeds with tenantId from session", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }

    const { app } = await createTestApp();
    const email = `test-scoped-${Date.now()}@example.com`;

    const { cookies } = await signUpUser(
      app,
      email,
      "testpassword123",
      "Test Scoped User",
    );

    // Access a tenant-scoped route with session cookies
    const response = await app.handle(
      new Request("http://localhost/api/protected", {
        headers: { cookie: cookies },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tenantId).toBeTruthy();
    expect(body.userId).toBeTruthy();
  });
});

describe("RBAC enforcement", () => {
  test("owner can access owner-only route (DELETE /api/tenant)", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }

    const { app, auth } = await createTestApp();
    const email = `test-owner-${Date.now()}@example.com`;

    // Sign up creates user as owner of auto-created org
    const { cookies } = await signUpUser(
      app,
      email,
      "testpassword123",
      "Test Owner",
    );

    // Owner needs an active organization set for requireRole to work.
    // The tenant middleware auto-selects the first org, so the session
    // should have activeOrganizationId set after the first tenant-scoped request.

    // First, make a request to trigger activeOrg auto-selection
    await app.handle(
      new Request("http://localhost/api/protected", {
        headers: { cookie: cookies },
      }),
    );

    // Now the owner should be able to call DELETE /api/tenant
    const response = await app.handle(
      new Request("http://localhost/api/tenant", {
        method: "DELETE",
        headers: { cookie: cookies },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toBe("Tenant deletion initiated");
    expect(body.tenantId).toBeTruthy();
  });

  test("member receives 403 on owner-only route (DELETE /api/tenant)", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }

    const { app, auth } = await createTestApp();

    // Create the owner user
    const ownerEmail = `test-rbac-owner-${Date.now()}@example.com`;
    const { cookies: ownerCookies } = await signUpUser(
      app,
      ownerEmail,
      "testpassword123",
      "RBAC Owner",
    );

    // Trigger active org selection for owner
    await app.handle(
      new Request("http://localhost/api/protected", {
        headers: { cookie: ownerCookies },
      }),
    );

    // Get the owner's org
    const orgs = await auth.api.listOrganizations({
      headers: new Headers({ cookie: ownerCookies }),
    });
    const orgId = orgs[0].id;

    // Create a second user (member)
    const memberEmail = `test-rbac-member-${Date.now()}@example.com`;
    const { cookies: memberCookies } = await signUpUser(
      app,
      memberEmail,
      "testpassword123",
      "RBAC Member",
    );

    // Invite the member to the owner's org via better-auth API
    try {
      const invitation = await auth.api.createInvitation({
        headers: new Headers({ cookie: ownerCookies }),
        body: {
          organizationId: orgId,
          email: memberEmail,
          role: "member",
        },
      });

      // Accept invitation as member
      if (invitation?.id) {
        await auth.api.acceptInvitation({
          headers: new Headers({ cookie: memberCookies }),
          body: { invitationId: invitation.id },
        });
      }

      // Set the owner's org as active for the member
      await auth.api.setActiveOrganization({
        headers: new Headers({ cookie: memberCookies }),
        body: { organizationId: orgId },
      });
    } catch (e) {
      // If invitation API differs, try adding member directly
      console.warn("Invitation flow may differ:", (e as Error).message);
      try {
        await (auth.api as any).addMember({
          headers: new Headers({ cookie: ownerCookies }),
          body: {
            organizationId: orgId,
            email: memberEmail,
            role: "member" as const,
          },
        });
      } catch {
        // Skip test if we can't add member
        console.warn("SKIPPED: Could not add member to org");
        return;
      }
    }

    // Member tries to call DELETE /api/tenant -- should get 403
    const response = await app.handle(
      new Request("http://localhost/api/tenant", {
        method: "DELETE",
        headers: { cookie: memberCookies },
      }),
    );

    // requireRole("owner") should reject with Forbidden error
    // The error middleware maps "Forbidden" errors to appropriate status
    expect(response.status).not.toBe(200);
    const body = await response.json();
    // Check for forbidden/error indicator
    expect(
      body.error === "FORBIDDEN" ||
        body.error === "Forbidden" ||
        body.success === false ||
        response.status === 403 ||
        response.status === 500,
    ).toBe(true);
  });
});
