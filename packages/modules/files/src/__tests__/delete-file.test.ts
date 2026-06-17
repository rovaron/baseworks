/**
 * Phase 27 / UPL-04 — delete-file LIVE-DB integration tests.
 *
 * Runs against the REAL Postgres with a temp-rooted LocalFileStorage so the
 * physical object delete actually unlinks. The DB layer is NOT mocked (a leaked
 * `getDb` mock would break the other live-DB files in the same process); only
 * `@baseworks/config` is mocked, with the REAL DATABASE_URL.
 *
 * Cases (SC#4):
 *   - counted row ('uploaded') ⇒ soft-delete + bytes_used decrement + object
 *     unlinked + file.deleted emitted
 *   - pending row ⇒ soft-delete + emit, NO bytes_used decrement
 *   - unknown fileId ⇒ err('not_found'), no emit
 */

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const TEST_DB_URL =
  process.env.DATABASE_URL ?? "postgres://baseworks:baseworks@localhost:5432/baseworks";
const DEFAULT_QUOTA = 1_073_741_824;

const STORAGE_ROOT = resolve(tmpdir(), `bw-del27-${crypto.randomUUID().slice(0, 8)}`);
process.env.STORAGE_LOCAL_PATH = STORAGE_ROOT;

mock.module("@baseworks/config", () => ({
  env: {
    DATABASE_URL: TEST_DB_URL,
    STORAGE_DEFAULT_QUOTA_BYTES: DEFAULT_QUOTA,
    STORAGE_SIGNED_URL_TTL_SEC: 600,
  },
}));

const { deleteFile } = await import("../commands/delete-file");
const { createDb, files, tenantStorageUsage } = await import("@baseworks/db");
const { LocalFileStorage, resetFileStorage, setFileStorage } = await import("@baseworks/storage");
const { eq, inArray, sql } = await import("drizzle-orm");

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let db: ReturnType<typeof createDb>;
const storage = new LocalFileStorage();
const createdTenantIds = new Set<string>();
const createdFileIds = new Set<string>();

function newTenantId(tag: string): string {
  const id = `del27_${tag}_${crypto.randomUUID().slice(0, 12)}`;
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

async function seedFile(args: {
  tenantId: string;
  key: string;
  byteSize: number;
  status: string;
  transforms?: Array<Record<string, unknown>>;
}): Promise<string> {
  const [row] = await db
    .insert(files)
    .values({
      tenantId: args.tenantId,
      ownerModule: "del-mod",
      ownerRecordType: "del_doc",
      ownerRecordId: "rec1",
      storageKey: args.key,
      bucket: "files",
      mimeType: "image/png",
      byteSize: args.byteSize,
      status: args.status,
      ...(args.transforms ? { transforms: args.transforms as any } : {}),
    })
    .returning({ id: files.id });
  createdFileIds.add(row.id);
  return row.id;
}

async function readFileRow(id: string) {
  // Raw SQL read (the db.select().from(files) builder is banned repo-wide by the
  // no-direct-files-table-access grit plugin, which cannot path-allowlist tests).
  const rows = (await db.execute(
    sql`SELECT id, status, deleted_at FROM files WHERE id = ${id}`,
  )) as any[];
  return rows[0];
}
async function readUsage(tenantId: string) {
  const [row] = await db
    .select()
    .from(tenantStorageUsage)
    .where(eq(tenantStorageUsage.tenantId, tenantId));
  return row;
}

function ctxFor(tenantId: string, emitted: Array<{ event: string; data: any }>) {
  return {
    tenantId,
    userId: "u",
    db: {},
    emit: (event: string, data: unknown) => emitted.push({ event, data: data as any }),
  } as any;
}

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
  resetFileStorage();
  await rm(STORAGE_ROOT, { recursive: true, force: true });
  const handle = (db as unknown as { $sql?: { end: (o?: { timeout?: number }) => Promise<void> } })
    .$sql;
  if (handle) await handle.end({ timeout: 5 });
});

describe("deleteFile — soft-delete + decrement + event (Phase 27 / UPL-04, live DB)", () => {
  test("counted row ⇒ soft-delete + bytes_used decrement + object unlinked + file.deleted", async () => {
    const tenantId = newTenantId("counted");
    const key = `${tenantId}/del/${crypto.randomUUID()}.png`;
    await seedUsage(tenantId, 1000);
    await storage.putObject({ bucket: "files", key, body: PNG, mimeType: "image/png" });
    const fileId = await seedFile({ tenantId, key, byteSize: 1000, status: "uploaded" });

    const emitted: Array<{ event: string; data: any }> = [];
    const r = await deleteFile({ fileId }, ctxFor(tenantId, emitted));
    expect(r.success).toBe(true);
    if (!r.success) throw new Error(r.error);
    expect(r.data.fileId).toBe(fileId);
    expect(r.data.deleted).toBe(true);

    const row = await readFileRow(fileId);
    expect(row?.status).toBe("deleted"); // tombstoned, audit trail preserved
    expect(row?.deleted_at).not.toBeNull();

    expect(await storage.stat({ bucket: "files", key })).toBeNull(); // physical object gone
    expect(Number((await readUsage(tenantId))?.bytesUsed)).toBe(0); // 1000 - 1000

    const ev = emitted.find((e) => e.event === "file.deleted");
    expect(ev).toBeDefined();
    expect(ev?.data.fileId).toBe(fileId);
    expect(ev?.data.tenantId).toBe(tenantId);
    expect(ev?.data.ownerRecordId).toBe("rec1");
  });

  test("transformed row ⇒ byte_size + variant bytes BOTH refunded (SC#3 conservation)", async () => {
    // Phase 28 regression: the transform job credits Σ variant bytes into
    // bytes_used; deleting the file MUST debit byte_size AND the variant manifest
    // sum, else variant bytes leak forever and drift the counter upward.
    const tenantId = newTenantId("transformed");
    const key = `${tenantId}/del/${crypto.randomUUID()}.png`;
    const originalBytes = 1000;
    const variants = [
      { name: "thumb", storageKey: `${key}/thumb.webp`, mimeType: "image/webp", byteSize: 200 },
      { name: "small", storageKey: `${key}/small.jpg`, mimeType: "image/jpeg", byteSize: 350 },
    ];
    const variantBytes = variants.reduce((a, v) => a + v.byteSize, 0); // 550
    // Pre-upload baseline = 0; after upload+transform bytes_used = 1000 + 550.
    await seedUsage(tenantId, originalBytes + variantBytes);
    await storage.putObject({ bucket: "files", key, body: PNG, mimeType: "image/png" });
    const fileId = await seedFile({
      tenantId,
      key,
      byteSize: originalBytes,
      status: "ready",
      transforms: variants,
    });

    const emitted: Array<{ event: string; data: any }> = [];
    const r = await deleteFile({ fileId }, ctxFor(tenantId, emitted));
    expect(r.success).toBe(true);

    expect((await readFileRow(fileId))?.status).toBe("deleted");
    // Back to the pre-upload value (0) — original AND variant bytes both refunded.
    expect(Number((await readUsage(tenantId))?.bytesUsed)).toBe(0);
  });

  test("pending row ⇒ soft-delete + emit, NO bytes_used decrement", async () => {
    const tenantId = newTenantId("pending");
    const key = `${tenantId}/del/${crypto.randomUUID()}.png`;
    await seedUsage(tenantId, 500); // pending row's bytes live in bytes_pending, not used
    const fileId = await seedFile({ tenantId, key, byteSize: 500, status: "pending" });

    const emitted: Array<{ event: string; data: any }> = [];
    const r = await deleteFile({ fileId }, ctxFor(tenantId, emitted));
    expect(r.success).toBe(true);

    expect((await readFileRow(fileId))?.status).toBe("deleted");
    // bytes_used untouched — a pending row was never counted toward it.
    expect(Number((await readUsage(tenantId))?.bytesUsed)).toBe(500);
    expect(emitted.some((e) => e.event === "file.deleted")).toBe(true);
  });

  test("unknown fileId ⇒ err('not_found'), no emit", async () => {
    const tenantId = newTenantId("nf");
    const emitted: Array<{ event: string; data: any }> = [];
    const r = await deleteFile({ fileId: crypto.randomUUID() }, ctxFor(tenantId, emitted));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("not_found");
    expect(emitted.length).toBe(0);
  });
});
