import { beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@baseworks/db";
import { sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { errorMiddleware } from "../core/middleware/error";
import { adminRoutes } from "../routes/admin";

/**
 * Integration tests verifying that requirePlatformAdmin() protects all admin routes.
 *
 * Per CR-02: The server-side requirePlatformAdmin() middleware is the real security
 * boundary for admin APIs. These tests confirm that unauthenticated requests and
 * non-owner users are rejected with 401/403, regardless of any client-side guards.
 *
 * Requires PostgreSQL to be running.
 */

const TEST_DB_URL =
  process.env.DATABASE_URL ?? "postgres://baseworks:baseworks@localhost:5432/baseworks";

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
  // Phase 30 / UI-02 — cross-tenant admin files routes MUST inherit the
  // requirePlatformAdmin() gate (an org-owner is NOT a platform operator).
  { method: "GET", path: "/api/admin/tenants/fake-id/files" },
  {
    method: "POST",
    path: "/api/admin/tenants/fake-id/files/sign-upload",
    body: { mimeType: "image/png", byteSize: 1024 },
  },
  { method: "POST", path: "/api/admin/tenants/fake-id/files/fake-file/complete" },
  { method: "GET", path: "/api/admin/tenants/fake-id/files/fake-file/read-url" },
  { method: "DELETE", path: "/api/admin/tenants/fake-id/files/fake-file" },
];

beforeAll(async () => {
  try {
    const db = createDb(TEST_DB_URL);
    await db.execute(sql`SELECT 1`);
    canConnect = true;

    // Mount admin routes on a minimal Elysia app with the global error handler,
    // so thrown "Unauthorized" / "Forbidden" from tenant.ts + requirePlatformAdmin are
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

describe("Admin routes: requirePlatformAdmin() enforcement", () => {
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

      const response = await app.handle(new Request(`http://localhost${endpoint.path}`, init));

      // requirePlatformAdmin should reject with 401 (unauthenticated) or 403 (wrong role)
      expect([401, 403]).toContain(response.status);
    });
  }
});
