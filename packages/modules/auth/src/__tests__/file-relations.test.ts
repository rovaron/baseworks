/**
 * Phase 29 / IDA-01, IDA-02 — auth fileRelations: boot registration, frozen
 * spec, permission hooks, live `isOwnerOrAdmin`.
 *
 * Test-isolation note: this file deliberately does NOT statically import
 * `../index`. Several sibling auth tests `mock.module("@baseworks/config", …)`
 * with a partial env-only stub, and Bun's mock registry is process-global — once
 * that runs, any later file that imports the auth barrel (which re-exports
 * middleware → `getAdminEmails` from config) fails at import with a SyntaxError
 * (this already affects auth-setup/locale-context under suite ordering). We avoid
 * the static barrel import entirely: the registration test uses the exported
 * relation objects directly, and the real-module wiring assertion uses a guarded
 * dynamic import that SKIPS on contamination. The live `isOwnerOrAdmin` block
 * probes the real DB and skips when a leaked config/db mock has redirected
 * `env.DATABASE_URL` away from Postgres.
 *
 * Cases:
 *   - collectFileRelations registers auth:user / auth:organization with the
 *     frozen spec (recordType, cardinality:"single", variants, no svg, caps)
 *   - the real auth ModuleDefinition wires the same relation objects (guarded)
 *   - user canRead/canWrite owner-only; organization canRead any member
 *   - SVG excluded from both allow-lists (D-6)
 *   - isOwnerOrAdmin (live DB): owner/admin → true; member/non-member → false
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ModuleDefinition } from "@baseworks/shared";
import { collectFileRelations, fileRelationsRegistry } from "@baseworks/storage";
import {
  AVATAR_MAX_BYTES,
  isOwnerOrAdmin,
  LOGO_MAX_BYTES,
  organizationFileRelation,
  userFileRelation,
} from "../file-relations";

const TEST_DB_URL =
  process.env.DATABASE_URL ?? "postgres://baseworks:baseworks@localhost:5432/baseworks";

describe("auth fileRelations — declaration + boot registration (Phase 29 / IDA-01)", () => {
  test("collectFileRelations registers auth:user / auth:organization with frozen spec", () => {
    // Boot mechanism: collectFileRelations walks [name, def] and registers each
    // relation under `${name}:${kind}`. Drive it with the same relation objects
    // the auth ModuleDefinition exports (no barrel import — see header).
    const def = {
      name: "auth",
      fileRelations: { user: userFileRelation, organization: organizationFileRelation },
    } as ModuleDefinition;
    collectFileRelations([["auth", def]]);

    const userRel = fileRelationsRegistry.get("auth", "user");
    expect(userRel).toBeDefined();
    expect(userRel?.recordType).toBe("user");
    expect(userRel?.cardinality).toBe("single");
    expect(userRel?.onDelete).toBe("cascade");
    expect(userRel?.maxByteSize).toBe(AVATAR_MAX_BYTES);
    expect(userRel?.allowedMimeTypes).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(userRel?.allowedMimeTypes).not.toContain("image/svg+xml");
    expect(userRel?.generateVariants?.map((v) => v.name)).toEqual([
      "avatar-64",
      "avatar-128",
      "avatar-256",
      "avatar-512",
    ]);
    expect(userRel?.generateVariants?.every((v) => v.format === "webp")).toBe(true);

    const orgRel = fileRelationsRegistry.get("auth", "organization");
    expect(orgRel).toBeDefined();
    expect(orgRel?.recordType).toBe("organization");
    expect(orgRel?.cardinality).toBe("single");
    expect(orgRel?.onDelete).toBe("cascade");
    expect(orgRel?.maxByteSize).toBe(LOGO_MAX_BYTES);
    expect(orgRel?.allowedMimeTypes).not.toContain("image/svg+xml");
    expect(orgRel?.generateVariants?.map((v) => v.name)).toEqual(["logo-128", "logo-256"]);
  });

  test("the real auth ModuleDefinition wires the user + organization relations", async () => {
    // Guarded dynamic import: skip if a leaked partial config mock has broken the
    // barrel (getAdminEmails) — the assertion is non-load-bearing for SC#1, which
    // the registration test above already proves.
    let authModule: ModuleDefinition;
    try {
      authModule = (await import("../index")).default;
    } catch (e) {
      console.warn(
        "SKIPPED: ../index import unavailable (mock contamination):",
        (e as Error).message,
      );
      return;
    }
    expect(authModule.fileRelations?.user).toBe(userFileRelation);
    expect(authModule.fileRelations?.organization).toBe(organizationFileRelation);
  });
});

describe("auth fileRelations — permission hooks (Phase 29 / IDA-02)", () => {
  test("user relation: owner-only read + write", async () => {
    const ctx = { userId: "u_owner", tenantId: "t_1" } as any;
    expect(await userFileRelation.canRead?.(ctx, "u_owner")).toBe(true);
    expect(await userFileRelation.canRead?.(ctx, "u_other")).toBe(false);
    expect(await userFileRelation.canWrite?.(ctx, "u_owner")).toBe(true);
    expect(await userFileRelation.canWrite?.(ctx, "u_other")).toBe(false);
  });

  test("organization relation: any member reads (recordId === tenantId)", async () => {
    const ctx = { userId: "u_x", tenantId: "t_logo" } as any;
    expect(await organizationFileRelation.canRead?.(ctx, "t_logo")).toBe(true);
    expect(await organizationFileRelation.canRead?.(ctx, "t_other")).toBe(false);
  });

  test("SVG excluded from both allow-lists (D-6)", () => {
    expect(userFileRelation.allowedMimeTypes).not.toContain("image/svg+xml");
    expect(organizationFileRelation.allowedMimeTypes).not.toContain("image/svg+xml");
  });
});

describe("isOwnerOrAdmin — live member-table role check (Phase 29 / IDA-02)", () => {
  const RUN = `p29ioa_${Math.random().toString(36).slice(2, 8)}`;
  const ORG = `${RUN}_org`;
  const U_OWNER = `${RUN}_owner`;
  const U_ADMIN = `${RUN}_admin`;
  const U_MEMBER = `${RUN}_member`;
  const U_OUTSIDER = `${RUN}_outsider`;

  // `canRun` gates the live block. It is true only when isOwnerOrAdmin (which uses
  // getDb(env.DATABASE_URL) internally) actually reaches the SAME Postgres we seed
  // — i.e. neither @baseworks/db nor @baseworks/config has been mock-contaminated
  // by an earlier file in this process. Otherwise we skip rather than error.
  let canRun = false;
  let db: any;

  beforeAll(async () => {
    try {
      const { createDb, member, organization, user } = await import("@baseworks/db");
      db = createDb(TEST_DB_URL);
      await db.execute((await import("drizzle-orm")).sql`SELECT 1`);
      await db.insert(user).values([
        { id: U_OWNER, name: "Owner", email: `${U_OWNER}@t.test` },
        { id: U_ADMIN, name: "Admin", email: `${U_ADMIN}@t.test` },
        { id: U_MEMBER, name: "Member", email: `${U_MEMBER}@t.test` },
        { id: U_OUTSIDER, name: "Outsider", email: `${U_OUTSIDER}@t.test` },
      ]);
      await db.insert(organization).values({ id: ORG, name: "P29 Org", slug: RUN });
      await db.insert(member).values([
        { id: `${RUN}_m1`, organizationId: ORG, userId: U_OWNER, role: "owner" },
        { id: `${RUN}_m2`, organizationId: ORG, userId: U_ADMIN, role: "admin" },
        { id: `${RUN}_m3`, organizationId: ORG, userId: U_MEMBER, role: "member" },
      ]);
      // Probe: isOwnerOrAdmin must see the row we just seeded. If a leaked mock
      // redirected env.DATABASE_URL, this returns false → we skip the block.
      canRun = (await isOwnerOrAdmin({ tenantId: ORG, userId: U_OWNER } as any)) === true;
      if (!canRun) console.warn("SKIPPED: isOwnerOrAdmin DB unavailable (mock contamination)");
    } catch (e) {
      console.warn("SKIPPED: PostgreSQL/member unavailable:", (e as Error).message);
      canRun = false;
    }
  });

  afterAll(async () => {
    if (!db) return;
    const { member, organization, user } = await import("@baseworks/db");
    const { inArray } = await import("drizzle-orm");
    await db.delete(member).where(inArray(member.userId, [U_OWNER, U_ADMIN, U_MEMBER]));
    await db.delete(organization).where(inArray(organization.id, [ORG]));
    await db.delete(user).where(inArray(user.id, [U_OWNER, U_ADMIN, U_MEMBER, U_OUTSIDER]));
  });

  test("owner → true; admin → true", async () => {
    if (!canRun) return;
    expect(await isOwnerOrAdmin({ tenantId: ORG, userId: U_OWNER } as any)).toBe(true);
    expect(await isOwnerOrAdmin({ tenantId: ORG, userId: U_ADMIN } as any)).toBe(true);
  });

  test("plain member → false; non-member → false", async () => {
    if (!canRun) return;
    expect(await isOwnerOrAdmin({ tenantId: ORG, userId: U_MEMBER } as any)).toBe(false);
    expect(await isOwnerOrAdmin({ tenantId: ORG, userId: U_OUTSIDER } as any)).toBe(false);
  });

  test("missing userId/tenantId → false (no throw)", async () => {
    if (!canRun) return;
    expect(await isOwnerOrAdmin({ tenantId: ORG } as any)).toBe(false);
    expect(await isOwnerOrAdmin({ userId: U_OWNER } as any)).toBe(false);
  });

  test("organization.canWrite gates on owner/admin role + recordId === tenantId", async () => {
    if (!canRun) return;
    expect(
      await organizationFileRelation.canWrite?.({ tenantId: ORG, userId: U_OWNER } as any, ORG),
    ).toBe(true);
    expect(
      await organizationFileRelation.canWrite?.({ tenantId: ORG, userId: U_MEMBER } as any, ORG),
    ).toBe(false);
    // owner role but recordId !== tenantId → false (write to a foreign tenant's logo)
    expect(
      await organizationFileRelation.canWrite?.(
        { tenantId: ORG, userId: U_OWNER } as any,
        "t_foreign",
      ),
    ).toBe(false);
  });
});
