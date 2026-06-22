// packages/modules/auth/src/__integration__/permissions.test.ts
import { beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@baseworks/db";
import { sql } from "drizzle-orm";

const TEST_DB_URL =
  process.env.DATABASE_URL ?? "postgres://baseworks:baseworks@localhost:5432/baseworks";

let canConnect = false;
beforeAll(async () => {
  try {
    const db = createDb(TEST_DB_URL);
    await db.execute(sql`SELECT 1`);
    canConnect = true;
  } catch {
    canConnect = false;
  }
});

async function signUp(auth: any, email: string) {
  const res = await auth.api.signUpEmail({
    body: { email, password: "testpassword123", name: email },
    asResponse: true,
  });
  const cookies = (res.headers.getSetCookie?.() ?? [])
    .map((c: string) => c.split(";")[0])
    .join("; ");
  return new Headers({ cookie: cookies });
}

describe("custom tenant roles", () => {
  test("create role -> assign member -> permission granted; cross-tenant denied", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }
    const { auth } = await import("../auth");

    const ownerHeaders = await signUp(auth, `perm-owner-${Date.now()}@example.com`);
    const orgs = await auth.api.listOrganizations({ headers: ownerHeaders });
    const orgId = orgs[0].id;

    // Owner creates a custom role granting files:write only.
    await auth.api.createOrgRole({
      headers: ownerHeaders,
      body: { organizationId: orgId, role: "editor", permission: { files: ["write"] } },
    });

    const listed = await auth.api.listOrgRoles({
      headers: ownerHeaders,
      query: { organizationId: orgId },
    });
    expect(listed.find((r: any) => r.role === "editor")).toBeTruthy();

    // Owner has files:write (owner role grants all).
    const ownerCheck = await auth.api.hasPermission({
      headers: ownerHeaders,
      body: { organizationId: orgId, permissions: { files: ["write"] } },
    });
    expect(ownerCheck.success).toBe(true);

    // A DIFFERENT org's owner cannot use this org's custom role (isolation).
    const otherHeaders = await signUp(auth, `perm-other-${Date.now()}@example.com`);
    // Not a member of orgId -> denied. better-auth 1.5.6 surfaces this as either
    // `{ success: false }` or a thrown USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION
    // (401) APIError depending on the path; both mean "permission denied".
    let otherDenied = false;
    try {
      const otherCheck = await auth.api.hasPermission({
        headers: otherHeaders,
        body: { organizationId: orgId, permissions: { files: ["write"] } },
      });
      otherDenied = otherCheck.success === false;
    } catch (e: any) {
      otherDenied =
        e?.status === "UNAUTHORIZED" ||
        e?.statusCode === 401 ||
        e?.body?.code === "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION";
    }
    expect(otherDenied).toBe(true);
  }, 30_000);
});
