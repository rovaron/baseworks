// packages/modules/auth/src/__integration__/permissions.test.ts
import { beforeAll, describe, expect, test } from "bun:test";
import { createDb, member as memberTable } from "@baseworks/db";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";

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

async function getUserId(auth: any, headers: Headers): Promise<string> {
  const session = await auth.api.getSession({ headers });
  return session.user.id;
}

/**
 * Add a membership row directly (bypassing the invite flow) so a second user
 * joins an EXISTING org with a chosen built-in or custom role — the only way to
 * exercise the role-creation ceiling from a non-owner whose permissions are a
 * strict subset of the owner's.
 */
async function addMember(db: any, organizationId: string, userId: string, role: string) {
  await db.insert(memberTable).values({
    id: nanoid(),
    organizationId,
    userId,
    role,
    createdAt: new Date(),
  });
}

/** Attempt createOrgRole; normalize success/denial whether better-auth returns or throws. */
async function tryCreateRole(
  auth: any,
  headers: Headers,
  organizationId: string,
  role: string,
  permission: Record<string, string[]>,
): Promise<{ ok: boolean; code?: string }> {
  try {
    await auth.api.createOrgRole({ headers, body: { organizationId, role, permission } });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, code: e?.body?.code ?? e?.code ?? String(e?.status ?? "ERROR") };
  }
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

describe("custom role privilege ceiling (no escalation)", () => {
  test("a tenant admin cannot mint a custom role granting permissions they lack", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }
    const { auth } = await import("../auth");
    const db = createDb(TEST_DB_URL);

    const ownerHeaders = await signUp(auth, `esc-owner-${Date.now()}@example.com`);
    const orgId = (await auth.api.listOrganizations({ headers: ownerHeaders }))[0].id;

    // A second user joins as the built-in `admin` role: it carries ac:create +
    // files:* but deliberately NOT billing:manage and NOT organization:delete.
    const adminHeaders = await signUp(auth, `esc-admin-${Date.now()}@example.com`);
    await addMember(db, orgId, await getUserId(auth, adminHeaders), "admin");

    // Within the ceiling: admin holds files:write, so it may create that role.
    const within = await tryCreateRole(auth, adminHeaders, orgId, `editor-${Date.now()}`, {
      files: ["write"],
    });
    expect(within.ok).toBe(true);

    // Above the ceiling: billing:manage is NOT held by admin → denied (no escalation).
    const escalateBilling = await tryCreateRole(auth, adminHeaders, orgId, `biller-${Date.now()}`, {
      billing: ["manage"],
    });
    expect(escalateBilling.ok).toBe(false);

    // Above the ceiling: organization:delete is NOT held by admin → denied.
    const escalateOrgDelete = await tryCreateRole(
      auth,
      adminHeaders,
      orgId,
      `nuker-${Date.now()}`,
      {
        organization: ["delete"],
      },
    );
    expect(escalateOrgDelete.ok).toBe(false);
  }, 30_000);

  test("a member assigned a files:write custom role gets exactly that — not files:delete", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }
    const { auth } = await import("../auth");
    const db = createDb(TEST_DB_URL);

    const ownerHeaders = await signUp(auth, `lp-owner-${Date.now()}@example.com`);
    const orgId = (await auth.api.listOrganizations({ headers: ownerHeaders }))[0].id;

    const roleName = `writer-${Date.now()}`;
    await auth.api.createOrgRole({
      headers: ownerHeaders,
      body: { organizationId: orgId, role: roleName, permission: { files: ["write"] } },
    });

    // A member joins assigned that exact custom role.
    const memberHeaders = await signUp(auth, `lp-member-${Date.now()}@example.com`);
    await addMember(db, orgId, await getUserId(auth, memberHeaders), roleName);

    const canWrite = await auth.api.hasPermission({
      headers: memberHeaders,
      body: { organizationId: orgId, permissions: { files: ["write"] } },
    });
    expect(canWrite.success).toBe(true);

    const canDelete = await auth.api.hasPermission({
      headers: memberHeaders,
      body: { organizationId: orgId, permissions: { files: ["delete"] } },
    });
    expect(canDelete.success).toBe(false);
  }, 30_000);
});
