/**
 * Phase 31 / OPS-02 — cleanup:reap-soft-deleted LIVE-DB tests.
 *
 * `00-`-prefixed to run BEFORE the @baseworks/db-faking unit suites (see
 * 00-reap-pending-uploads.test.ts header). Real config (env.STORAGE_SOFT_DELETE_
 * RETENTION_DAYS defaults to 30) + real Postgres + temp-rooted LocalFileStorage.
 *
 * Cases:
 *   - a tombstone older than retention ⇒ DB row + primary object + EVERY variant
 *     object hard-deleted; usage counters UNTOUCHED.
 *   - a recent tombstone (within retention) ⇒ untouched.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.DATABASE_URL ??= "postgres://baseworks:baseworks@localhost:5432/baseworks";
process.env.NODE_ENV ??= "test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-min-32-chars-long-xxxxxxxxxxxxxxx";

const TEST_DB_URL = process.env.DATABASE_URL;
const DEFAULT_QUOTA = 1_073_741_824;
const RETENTION_DAYS = 30; // real config default

const STORAGE_ROOT = resolve(tmpdir(), `bw-reap-soft-${crypto.randomUUID().slice(0, 8)}`);
process.env.STORAGE_LOCAL_PATH = STORAGE_ROOT;
process.env.STORAGE_PROVIDER = "local";

const { reapSoftDeleted } = await import("../jobs/reap-soft-deleted");
const { createDb, files, tenantStorageUsage, storageJobRuns } = await import("@baseworks/db");
const { LocalFileStorage, resetFileStorage, setFileStorage } = await import("@baseworks/storage");
const { eq, inArray, sql } = await import("drizzle-orm");

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let db: ReturnType<typeof createDb>;
const storage = new LocalFileStorage();
const createdTenantIds = new Set<string>();
const createdFileIds = new Set<string>();

function newTenantId(tag: string): string {
  const id = `reaps_${tag}_${crypto.randomUUID().slice(0, 12)}`;
  createdTenantIds.add(id);
  return id;
}

async function seedUsage(tenantId: string, used: number): Promise<void> {
  await db
    .insert(tenantStorageUsage)
    .values({ tenantId, bytesUsed: used, bytesPending: 0, bytesLimit: DEFAULT_QUOTA })
    .onConflictDoUpdate({
      target: tenantStorageUsage.tenantId,
      set: { bytesUsed: used, bytesPending: 0, bytesLimit: DEFAULT_QUOTA },
    });
}

async function seedTombstone(args: {
  tenantId: string;
  key: string;
  byteSize: number;
  deletedAt: Date;
  transforms?: Array<Record<string, unknown>>;
}): Promise<string> {
  const [row] = await db
    .insert(files)
    .values({
      tenantId: args.tenantId,
      ownerModule: "reap-mod",
      ownerRecordType: "reap_doc",
      ownerRecordId: "rec1",
      storageKey: args.key,
      bucket: "files",
      mimeType: "image/png",
      byteSize: args.byteSize,
      status: "deleted",
      deletedAt: args.deletedAt,
      ...(args.transforms ? { transforms: args.transforms as never } : {}),
    })
    .returning({ id: files.id });
  createdFileIds.add(row.id);
  return row.id;
}

async function fileExists(id: string): Promise<boolean> {
  const rows = (await db.execute(
    sql`SELECT id FROM files WHERE id = ${id}`,
  )) as unknown as unknown[];
  return rows.length > 0;
}
async function readUsage(tenantId: string) {
  const [row] = await db
    .select()
    .from(tenantStorageUsage)
    .where(eq(tenantStorageUsage.tenantId, tenantId));
  return row;
}

const DAY = 86_400_000;

beforeAll(async () => {
  db = createDb(TEST_DB_URL);
  await db.execute(sql`SELECT 1`);
  setFileStorage(storage);
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
  await db.delete(storageJobRuns).where(eq(storageJobRuns.jobName, "cleanup:reap-soft-deleted"));
  resetFileStorage();
  await rm(STORAGE_ROOT, { recursive: true, force: true });
  const handle = (db as unknown as { $sql?: { end: (o?: { timeout?: number }) => Promise<void> } })
    .$sql;
  if (handle) await handle.end({ timeout: 5 });
});

describe("reapSoftDeleted (Phase 31 / OPS-02, live DB)", () => {
  test("past-retention tombstone ⇒ row + primary + variant objects gone; recent untouched; counters untouched", async () => {
    const tenantId = newTenantId("mix");
    await seedUsage(tenantId, 4242); // arbitrary; must be UNCHANGED after the job

    const oldKey = `${tenantId}/s/${crypto.randomUUID()}.png`;
    const variantA = `${tenantId}/s/${crypto.randomUUID()}-thumb.webp`;
    const variantB = `${tenantId}/s/${crypto.randomUUID()}-small.jpg`;
    await storage.putObject({ bucket: "files", key: oldKey, body: PNG, mimeType: "image/png" });
    await storage.putObject({ bucket: "files", key: variantA, body: PNG, mimeType: "image/webp" });
    await storage.putObject({ bucket: "files", key: variantB, body: PNG, mimeType: "image/jpeg" });
    const oldId = await seedTombstone({
      tenantId,
      key: oldKey,
      byteSize: 1000,
      deletedAt: new Date(Date.now() - (RETENTION_DAYS + 5) * DAY),
      transforms: [
        { name: "thumb", storageKey: variantA, mimeType: "image/webp", byteSize: 200 },
        { name: "small", storageKey: variantB, mimeType: "image/jpeg", byteSize: 300 },
      ],
    });

    const recentKey = `${tenantId}/s/${crypto.randomUUID()}.png`;
    await storage.putObject({ bucket: "files", key: recentKey, body: PNG, mimeType: "image/png" });
    const recentId = await seedTombstone({
      tenantId,
      key: recentKey,
      byteSize: 500,
      deletedAt: new Date(Date.now() - 2 * DAY),
    });

    await reapSoftDeleted({});

    expect(await fileExists(oldId)).toBe(false);
    expect(await storage.stat({ bucket: "files", key: oldKey })).toBeNull();
    expect(await storage.stat({ bucket: "files", key: variantA })).toBeNull();
    expect(await storage.stat({ bucket: "files", key: variantB })).toBeNull();

    expect(await fileExists(recentId)).toBe(true);
    expect(await storage.stat({ bucket: "files", key: recentKey })).not.toBeNull();

    // Usage counter UNTOUCHED (bytes were refunded at soft-delete time).
    expect(Number((await readUsage(tenantId))?.bytesUsed)).toBe(4242);
  });
});
