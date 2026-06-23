import { beforeAll, describe, expect, test } from "bun:test";
import { createDb, user as userTable } from "@baseworks/db";
import { auth } from "@baseworks/module-auth";
import { eq, sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { errorMiddleware } from "../core/middleware/error";
import { adminRoutes } from "../routes/admin";

/**
 * v1.5 — operator tenant-role management (POST/PATCH/DELETE /api/admin/tenants/:id/roles).
 *
 * Operators are NOT org members, so these routes write `organization_role` rows
 * directly behind requirePlatformAdmin(). These tests exercise the logic with an
 * authenticated platform admin (seeded via a DB role promotion, as bootstrap does)
 * against a live PostgreSQL. The 401/403 gate itself is covered in admin-auth.test.ts.
 */

const TEST_DB_URL =
  process.env.DATABASE_URL ?? "postgres://baseworks:baseworks@localhost:5432/baseworks";

let app: any;
let adminCookie = "";
let orgId = "";
let canConnect = false;

function cookieFrom(res: Response): string {
  return ((res.headers as any).getSetCookie?.() ?? [])
    .map((c: string) => c.split(";")[0])
    .join("; ");
}

async function adminReq(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { cookie: adminCookie } };
  if (body !== undefined) {
    init.headers = { ...init.headers, "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await app.handle(new Request(`http://localhost${path}`, init));
  let json: any = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

beforeAll(async () => {
  try {
    const db = createDb(TEST_DB_URL);
    await db.execute(sql`SELECT 1`);
    canConnect = true;

    app = new Elysia().use(errorMiddleware).use(adminRoutes);

    // Seed a platform admin (signup → DB-promote to role=admin, like bootstrap).
    const email = `admin-roles-${Date.now()}@example.com`;
    const signRes = await auth.api.signUpEmail({
      body: { email, password: "testpassword123", name: email },
      asResponse: true,
    });
    adminCookie = cookieFrom(signRes);
    const session = await auth.api.getSession({ headers: new Headers({ cookie: adminCookie }) });
    await db.update(userTable).set({ role: "admin" }).where(eq(userTable.id, session!.user.id));

    // Re-sign-in so the (cached) session reflects the promoted role=admin; the
    // original signup session snapshot predates the promotion.
    const reSign = await auth.api.signInEmail({
      body: { email, password: "testpassword123" },
      asResponse: true,
    });
    adminCookie = cookieFrom(reSign);

    // Use the admin's auto-created personal workspace as the target tenant.
    const orgs = await auth.api.listOrganizations({
      headers: new Headers({ cookie: adminCookie }),
    });
    orgId = orgs[0].id;
  } catch (e) {
    console.warn("PostgreSQL unavailable -- admin-roles tests skipped:", (e as Error).message);
    canConnect = false;
  }
});

describe("operator tenant-role management", () => {
  const ROLE = `editor-${Date.now()}`;

  test("create → validate → duplicate → patch → delete lifecycle", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }

    // Create a valid custom role.
    const created = await adminReq("POST", `/api/admin/tenants/${orgId}/roles`, {
      role: ROLE,
      permission: { files: ["write"] },
    });
    expect(created.status).toBe(201);

    // It shows up in the read endpoint with the right permission.
    const listed = await adminReq("GET", `/api/admin/tenants/${orgId}/roles`);
    const row = (listed.json.data as any[]).find((r) => r.role === ROLE);
    expect(row).toBeTruthy();
    expect(row.permission).toEqual({ files: ["write"] });

    // Duplicate name → 409.
    const dup = await adminReq("POST", `/api/admin/tenants/${orgId}/roles`, {
      role: ROLE,
      permission: { files: ["read"] },
    });
    expect(dup.status).toBe(409);

    // PATCH widens the permission.
    const patched = await adminReq("PATCH", `/api/admin/tenants/${orgId}/roles/${ROLE}`, {
      permission: { files: ["read", "write"] },
    });
    expect(patched.status).toBe(200);
    const after = await adminReq("GET", `/api/admin/tenants/${orgId}/roles`);
    expect((after.json.data as any[]).find((r) => r.role === ROLE).permission).toEqual({
      files: ["read", "write"],
    });

    // DELETE removes it.
    const deleted = await adminReq("DELETE", `/api/admin/tenants/${orgId}/roles/${ROLE}`);
    expect(deleted.status).toBe(200);
    const gone = await adminReq("GET", `/api/admin/tenants/${orgId}/roles`);
    expect((gone.json.data as any[]).some((r) => r.role === ROLE)).toBe(false);
  }, 30_000);

  test("rejects reserved built-in names and unknown permissions", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }

    const reserved = await adminReq("POST", `/api/admin/tenants/${orgId}/roles`, {
      role: "owner",
      permission: { files: ["read"] },
    });
    expect(reserved.status).toBe(400);
    expect(reserved.json.error).toBe("ROLE_NAME_RESERVED");

    const badResource = await adminReq("POST", `/api/admin/tenants/${orgId}/roles`, {
      role: `bogus-${Date.now()}`,
      permission: { wormholes: ["open"] },
    });
    expect(badResource.status).toBe(400);
    expect(badResource.json.error).toContain("INVALID_PERMISSION");

    const badAction = await adminReq("POST", `/api/admin/tenants/${orgId}/roles`, {
      role: `bogus2-${Date.now()}`,
      permission: { files: ["teleport"] },
    });
    expect(badAction.status).toBe(400);
    expect(badAction.json.error).toContain("INVALID_PERMISSION");
  }, 30_000);
});
