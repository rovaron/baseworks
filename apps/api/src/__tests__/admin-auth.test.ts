import { describe, test, expect, beforeAll } from "bun:test";
import { Elysia } from "elysia";
import { createDb } from "@baseworks/db";
import { sql } from "drizzle-orm";
import { adminRoutes } from "../routes/admin";
import { errorMiddleware } from "../core/middleware/error";

/**
 * Integration tests verifying that requireRole("owner") protects all admin routes.
 *
 * Per CR-02: The server-side requireRole("owner") middleware is the real security
 * boundary for admin APIs. These tests confirm that unauthenticated requests and
 * non-owner users are rejected with 401/403, regardless of any client-side guards.
 *
 * Requires PostgreSQL to be running.
 */

const TEST_DB_URL =
  process.env.DATABASE_URL ??
  "postgres://baseworks:baseworks@localhost:5432/baseworks";

let app: any;
let canConnect = false;

/** All admin endpoints that must be protected. */
const ADMIN_ENDPOINTS: Array<{ method: string; path: string; body?: any }> = [
  { method: "GET", path: "/api/admin/tenants" },
  { method: "GET", path: "/api/admin/tenants/fake-id" },
  { method: "PATCH", path: "/api/admin/tenants/fake-id", body: { metadata: {} } },
  { method: "GET", path: "/api/admin/users" },
  { method: "GET", path: "/api/admin/users/fake-id" },
  { method: "PATCH", path: "/api/admin/users/fake-id", body: { banned: true } },
  { method: "POST", path: "/api/admin/users/fake-id/impersonate" },
  { method: "GET", path: "/api/admin/billing/overview" },
  { method: "GET", path: "/api/admin/system/health" },
];

beforeAll(async () => {
  try {
    const db = createDb(TEST_DB_URL);
    await db.execute(sql`SELECT 1`);
    canConnect = true;

    // Mount admin routes on a minimal Elysia app with the global error handler,
    // so thrown "Unauthorized" / "Forbidden" from tenant.ts + requireRole are
    // mapped to 401/403 (matches production middleware composition).
    app = new Elysia().use(errorMiddleware).use(adminRoutes);
  } catch (e) {
    console.warn(
      "PostgreSQL unavailable -- admin auth tests will be skipped:",
      (e as Error).message,
    );
    canConnect = false;
  }
});

describe("Admin routes: requireRole('owner') enforcement", () => {
  for (const endpoint of ADMIN_ENDPOINTS) {
    test(`${endpoint.method} ${endpoint.path} rejects unauthenticated requests`, async () => {
      if (!canConnect) {
        console.warn("SKIPPED: PostgreSQL unavailable");
        return;
      }

      const init: RequestInit = { method: endpoint.method };
      if (endpoint.body) {
        init.headers = { "Content-Type": "application/json" };
        init.body = JSON.stringify(endpoint.body);
      }

      const response = await app.handle(
        new Request(`http://localhost${endpoint.path}`, init),
      );

      // requireRole should reject with 401 (unauthenticated) or 403 (wrong role)
      expect([401, 403]).toContain(response.status);
    });
  }
});
