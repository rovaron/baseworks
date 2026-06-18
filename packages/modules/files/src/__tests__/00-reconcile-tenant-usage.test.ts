/**
 * Phase 31 / OPS-02, QUO-03 — quota:reconcile-tenant-usage LIVE-DB tests.
 *
 * `00-`-prefixed to run BEFORE the @baseworks/db-faking unit suites (see
 * 00-reap-pending-uploads.test.ts header). Real config + real Postgres. Proves
 * the reconcile UPDATE uses the EXACT counting model (byte_size + Σ variant bytes
 * over COUNTED_STATUSES, deleted_at IS NULL) — corrects drift without introducing
 * any, and NEVER touches bytes_pending.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://baseworks:baseworks@localhost:5432/baseworks";
process.env.NODE_ENV ??= "test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-min-32-chars-long-xxxxxxxxxxxxxxx";

const TEST_DB_URL = process.env.DATABASE_URL;
const DEFAULT_QUOTA = 1_073_741_824;

const { reconcileTenantUsage } = await import("../jobs/reconcile-tenant-usage");
const { createDb, files, tenantStorageUsage, storageJobRuns } = await import("@baseworks/db");
const { eq, inArray, sql } = await import("drizzle-orm");

let db: ReturnType<typeof createDb>;
const createdTenantIds = new Set<string>();
const createdFileIds = new Set<string>();

function newTenantId(tag: string): string {
  const id = `recon_${tag}_${crypto.randomUUID().slice(0, 12)}`;
  createdTenantIds.add(id);
  return id;
}

async function seedUsage(tenantId: string, used: number, pending: number): Promise<void> {
  await db
    .insert(tenantStorageUsage)
    .values({ tenantId, bytesUsed: used, bytesPending: pending, bytesLimit: DEFAULT_QUOTA })
    .onConflictDoUpdate({
      target: tenantStorageUsage.tenantId,
      set: { bytesUsed: used, bytesPending: pending, bytesLimit: DEFAULT_QUOTA },
    });
}

async function seedFile(args: {
  tenantId: string;
  byteSize: number;
  status: string;
  deleted?: boolean;
  transforms?: Array<Record<string, unknown>>;
}): Promise<string> {
  const [row] = await db
    .insert(files)
    .values({
      tenantId: args.tenantId,
      ownerModule: "recon-mod",
      ownerRecordType: "recon_doc",
      ownerRecordId: "rec1",
      storageKey: `${args.tenantId}/r/${crypto.randomUUID()}`,
      bucket: "files",
      mimeType: "image/png",
      byteSize: args.byteSize,
      status: args.status,
      ...(args.deleted ? { deletedAt: new Date() } : {}),
      ...(args.transforms ? { transforms: args.transforms as never } : {}),
    })
    .returning({ id: files.id });
  createdFileIds.add(row.id);
  return row.id;
}

async function readUsage(tenantId: string) {
  const [row] = await db
    .select()
    .from(tenantStorageUsage)
    .where(eq(tenantStorageUsage.tenantId, tenantId));
  return row;
}

beforeAll(async () => {
  db = createDb(TEST_DB_URL);
  await db.execute(sql`SELECT 1`);
});

afterAll(async () => {
  if (createdFileIds.size > 0) {
    await db.delete(files).where(inArray(files.id, [...createdFileIds]));
  }
  if (createdTenantIds.size > 0) {
    await db
      .delete(tenantStorageUsage)
      .where(inArray(tenantStorageUsage.tenantId, [...createdTenantIds]));
  }
  await db.delete(storageJobRuns).where(eq(storageJobRuns.jobName, "quota:reconcile-tenant-usage"));
  const handle = (db as unknown as { $sql?: { end: (o?: { timeout?: number }) => Promise<void> } })
    .$sql;
  if (handle) await handle.end({ timeout: 5 });
});

describe("reconcileTenantUsage (Phase 31 / OPS-02, live DB)", () => {
  test("rebuilds bytes_used to the exact model (counted statuses + variant bytes); excludes pending/failed/deleted; pending untouched", async () => {
    const tenantId = newTenantId("drift");

    await seedFile({ tenantId, byteSize: 1000, status: "uploaded" });
    await seedFile({
      tenantId,
      byteSize: 2000,
      status: "ready",
      transforms: [
        { name: "a", storageKey: "k/a.webp", mimeType: "image/webp", byteSize: 300 },
        { name: "b", storageKey: "k/b.jpg", mimeType: "image/jpeg", byteSize: 150 },
      ],
    });
    await seedFile({ tenantId, byteSize: 500, status: "transforming" });
    // Excluded: pending, failed, deleted.
    await seedFile({ tenantId, byteSize: 9999, status: "pending" });
    await seedFile({ tenantId, byteSize: 8888, status: "failed" });
    await seedFile({ tenantId, byteSize: 7777, status: "deleted", deleted: true });

    const expected = 1000 + (2000 + 300 + 150) + 500; // 3950

    await seedUsage(tenantId, 999_999, 4321); // drifted high + pending the job must not touch

    await reconcileTenantUsage({});

    const usage = await readUsage(tenantId);
    expect(Number(usage?.bytesUsed)).toBe(expected);
    expect(Number(usage?.bytesPending)).toBe(4321);
  });

  test("tenant with no counted files ⇒ bytes_used reset to 0", async () => {
    const tenantId = newTenantId("empty");
    await seedFile({ tenantId, byteSize: 4444, status: "deleted", deleted: true });
    await seedUsage(tenantId, 123_456, 0);

    await reconcileTenantUsage({});

    expect(Number((await readUsage(tenantId))?.bytesUsed)).toBe(0);
  });
});
