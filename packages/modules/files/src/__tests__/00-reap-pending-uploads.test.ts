/**
 * Phase 31 / OPS-02 — cleanup:reap-pending-uploads LIVE-DB tests.
 *
 * `00-`-prefixed so it sorts FIRST in the package's `bun test` run, BEFORE the
 * sibling unit suites that `mock.module("@baseworks/db", …)` with a fake getDb
 * (sign-upload / enqueue-on-completed / transform-image). bun's first
 * mock.module(specifier) wins process-globally and files load+run sequentially,
 * so running first lets this suite use the REAL config (complete env) + REAL
 * Postgres without any module mock leaking in (mirrors 00-transform-image-live).
 * Storage is injected via setFileStorage (a temp-rooted LocalFileStorage) so the
 * physical object delete actually unlinks.
 *
 * Cases:
 *   - a >1h-old pending row ⇒ DB row deleted + object unlinked + bytes_pending released
 *   - a fresh (<1h) pending row ⇒ untouched
 *   - a completed ('uploaded') row ⇒ untouched (no false delete, no release)
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

const STORAGE_ROOT = resolve(tmpdir(), `bw-reap-pending-${crypto.randomUUID().slice(0, 8)}`);
process.env.STORAGE_LOCAL_PATH = STORAGE_ROOT;
process.env.STORAGE_PROVIDER = "local";

const { reapPendingUploads } = await import("../jobs/reap-pending-uploads");
const { createDb, files, tenantStorageUsage, storageJobRuns } = await import("@baseworks/db");
const { LocalFileStorage, resetFileStorage, setFileStorage } = await import("@baseworks/storage");
const { eq, inArray, sql } = await import("drizzle-orm");

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let db: ReturnType<typeof createDb>;
const storage = new LocalFileStorage();
const createdTenantIds = new Set<string>();
const createdFileIds = new Set<string>();

function newTenantId(tag: string): string {
  const id = `reapp_${tag}_${crypto.randomUUID().slice(0, 12)}`;
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
  key: string;
  byteSize: number;
  status: string;
  createdAt: Date;
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
      status: args.status,
      createdAt: args.createdAt,
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

const HOURS = 3600_000;

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
  await db.delete(storageJobRuns).where(eq(storageJobRuns.jobName, "cleanup:reap-pending-uploads"));
  resetFileStorage();
  await rm(STORAGE_ROOT, { recursive: true, force: true });
  const handle = (db as unknown as { $sql?: { end: (o?: { timeout?: number }) => Promise<void> } })
    .$sql;
  if (handle) await handle.end({ timeout: 5 });
});

describe("reapPendingUploads (Phase 31 / OPS-02, live DB)", () => {
  test(">1h-old pending ⇒ deleted + object unlinked + bytes_pending released; fresh + uploaded untouched", async () => {
    const tenantId = newTenantId("mix");
    await seedUsage(tenantId, 0, 1500); // pending reserved for stale (1000) + fresh (500)

    const staleKey = `${tenantId}/p/${crypto.randomUUID()}.png`;
    const freshKey = `${tenantId}/p/${crypto.randomUUID()}.png`;
    const uploadedKey = `${tenantId}/p/${crypto.randomUUID()}.png`;
    await storage.putObject({ bucket: "files", key: staleKey, body: PNG, mimeType: "image/png" });

    const staleId = await seedFile({
      tenantId,
      key: staleKey,
      byteSize: 1000,
      status: "pending",
      createdAt: new Date(Date.now() - 2 * HOURS),
    });
    const freshId = await seedFile({
      tenantId,
      key: freshKey,
      byteSize: 500,
      status: "pending",
      createdAt: new Date(Date.now() - 5 * 60_000),
    });
    const uploadedId = await seedFile({
      tenantId,
      key: uploadedKey,
      byteSize: 700,
      status: "uploaded",
      createdAt: new Date(Date.now() - 3 * HOURS),
    });

    await reapPendingUploads({});

    expect(await fileExists(staleId)).toBe(false);
    expect(await storage.stat({ bucket: "files", key: staleKey })).toBeNull();
    expect(await fileExists(freshId)).toBe(true);
    expect(await fileExists(uploadedId)).toBe(true);
    expect(Number((await readUsage(tenantId))?.bytesPending)).toBe(500);
  });

  test("idempotent: a second run with no stale rows sweeps nothing", async () => {
    const tenantId = newTenantId("idem");
    await seedUsage(tenantId, 0, 0);
    await reapPendingUploads({});
    expect(Number((await readUsage(tenantId))?.bytesPending)).toBe(0);
  });
});
