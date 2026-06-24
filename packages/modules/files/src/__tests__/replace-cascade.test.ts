/**
 * Phase 29 / IDA-01 — cascade-on-replace (attach-file, cardinality:"single") +
 * SVG sign-time rejection. LIVE DB (DATABASE_URL). Mirrors cascade.test.ts setup:
 * only @baseworks/config (DATABASE_URL + quota) and @baseworks/observability are
 * mocked; the DB layer is REAL so the attach tx hits Postgres. FileStorage is
 * stubbed so attach-file's post-commit sibling delete is a no-op.
 *
 * The auth `user`/`organization` relations are NOT imported here (that would be a
 * banned @baseworks/module-auth cross-module import — lint:cross-module). Instead
 * the identical spec is registered INLINE under a unique test module key, which
 * exercises the SAME registry → findRelationByRecordType → attach/sign code paths.
 *
 * Cases:
 *   - attach to a cardinality:"single" relation soft-deletes the prior live file
 *     for the same owner tuple, decrements bytes_used by byte_size + variant bytes,
 *     emits file.deleted for the replaced row, and leaves the new row live
 *   - attach to a default ("many") relation leaves prior files untouched
 *   - sign-upload with image/svg+xml ⇒ err("mime_not_allowed") (SVG excluded, D-6)
 */

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

const TEST_DB_URL =
  process.env.DATABASE_URL ?? "postgres://baseworks:baseworks@localhost:5432/baseworks";
const DEFAULT_QUOTA = 1_073_741_824;

mock.module("@baseworks/config", () => ({
  env: {
    DATABASE_URL: TEST_DB_URL,
    STORAGE_DEFAULT_QUOTA_BYTES: DEFAULT_QUOTA,
    STORAGE_SIGNED_URL_TTL_SEC: 600,
  },
}));
mock.module("@baseworks/observability", () => ({
  getErrorTracker: () => ({ captureException: () => {} }),
}));

const { attachFileCommand } = await import("../commands/attach-file");
const { signUpload } = await import("../commands/sign-upload");
const { createDb, files, getRlsDb, tenantStorageUsage, withTenant } = await import("@baseworks/db");
const { fileRelationsRegistry, setFileStorage } = await import("@baseworks/storage");
const { eq, inArray, sql } = await import("drizzle-orm");

// Stub storage: attach-file calls getFileStorage().delete() per replaced sibling
// AFTER commit; a resolved no-op keeps the cascade DB-only here.
setFileStorage({
  name: "stub",
  signUpload: async () => ({
    method: "PUT" as const,
    url: "https://signed.example/upload",
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
  }),
  signRead: async () => ({ url: "", expiresAt: "" }),
  stat: async () => null,
  delete: async () => undefined,
  getObject: async () => new Uint8Array(),
  putObject: async () => undefined,
} as any);

// Inline replicas of the auth specs (no module import). Unique module key.
const OWNER_MODULE = "p29auth";
const AVATAR_RT = "p29_user"; // cardinality:"single"
const DOC_RT = "p29_doc"; // default ("many")
const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"]; // SVG excluded (D-6)

fileRelationsRegistry.register(OWNER_MODULE, "user", {
  recordType: AVATAR_RT,
  allowedMimeTypes: IMAGE_MIME,
  maxByteSize: 5 * 1024 * 1024,
  cardinality: "single",
  onDelete: "cascade",
});
fileRelationsRegistry.register(OWNER_MODULE, "doc", {
  recordType: DOC_RT,
  allowedMimeTypes: IMAGE_MIME,
  maxByteSize: 5 * 1024 * 1024,
  // no cardinality → defaults to "many"
});

let db: ReturnType<typeof createDb>;
const createdTenantIds = new Set<string>();
const createdFileIds = new Set<string>();

function newTenantId(tag: string): string {
  const id = `p29c_${tag}_${crypto.randomUUID().slice(0, 12)}`;
  createdTenantIds.add(id);
  return id;
}

function makeCtx(tenantId: string, emitted: Array<{ event: string; data: any }>): any {
  return {
    tenantId,
    userId: "u_test",
    db: {},
    emit: (event: string, data: unknown) => emitted.push({ event, data: data as any }),
    // Mirror the apps/api request context: attach-file's tenant DB work runs
    // through an RLS-role transaction with app.tenant_id set transaction-locally.
    withTenant: <T>(fn: (tx: any) => Promise<T>) => withTenant(getRlsDb(), tenantId, fn),
  };
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
  ownerRecordType: string;
  ownerRecordId: string;
  byteSize: number;
  status: string;
  transforms?: Array<Record<string, unknown>>;
}): Promise<string> {
  const [row] = await db
    .insert(files)
    .values({
      tenantId: args.tenantId,
      ownerModule: OWNER_MODULE,
      ownerRecordType: args.ownerRecordType,
      ownerRecordId: args.ownerRecordId,
      storageKey: `${args.tenantId}/p29/${crypto.randomUUID()}`,
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
  const rows = (await db.execute(
    sql`SELECT id, owner_record_id, status, deleted_at FROM files WHERE id = ${id}`,
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

// `canRun` gates the live block. createDb is the symbol other test files
// mock.module-stub (e.g. auth/get-profile mocks @baseworks/db.createDb); Bun's
// mock registry is process-global, so under a cross-package run that stub can
// leak here. Probe real connectivity and skip (not error) when contaminated —
// the canonical `bun test packages/modules/files` run is clean and runs fully.
let canRun = false;

beforeAll(async () => {
  try {
    db = createDb(TEST_DB_URL);
    await db.execute(sql`SELECT 1`);
    // attach-file drives its tenant DB work through ctx.withTenant(getRlsDb()),
    // so the NON-OWNER baseworks_rls pool must be reachable too.
    await getRlsDb().execute(sql`SELECT 1`);
    canRun = true;
  } catch (e) {
    console.warn("SKIPPED: PostgreSQL unavailable (mock contamination):", (e as Error).message);
    canRun = false;
  }
});

afterAll(async () => {
  if (!canRun || !db?.delete) return;
  if (createdFileIds.size > 0) {
    await db.delete(files).where(inArray(files.id, [...createdFileIds]));
  }
  if (createdTenantIds.size > 0) {
    await db
      .delete(tenantStorageUsage)
      .where(inArray(tenantStorageUsage.tenantId, [...createdTenantIds]));
  }
  const handle = (db as unknown as { $sql?: { end: (o?: { timeout?: number }) => Promise<void> } })
    .$sql;
  if (handle) await handle.end({ timeout: 5 });
});

describe("attach-file cascade-on-replace (cardinality:single) — Phase 29 / IDA-01, SC#4", () => {
  test("replacing an avatar soft-deletes the prior file + refunds byte_size + variant bytes", async () => {
    if (!canRun) return;
    const tenantId = newTenantId("single");
    const REC = "owner_user_A";

    // Prior avatar: ready + transformed (100 own + 200 variants = 300 counted).
    const variants = [
      { name: "avatar-128", storageKey: "k/a128.webp", mimeType: "image/webp", byteSize: 120 },
      { name: "avatar-256", storageKey: "k/a256.webp", mimeType: "image/webp", byteSize: 80 },
    ];
    const prior = await seedFile({
      tenantId,
      ownerRecordType: AVATAR_RT,
      ownerRecordId: REC,
      byteSize: 100,
      status: "ready",
      transforms: variants,
    });
    // New avatar already uploaded (locked flow: complete precedes attach), unlinked.
    const next = await seedFile({
      tenantId,
      ownerRecordType: AVATAR_RT,
      ownerRecordId: "",
      byteSize: 100,
      status: "uploaded",
    });
    await seedUsage(tenantId, 400); // prior 300 + new 100

    const emitted: Array<{ event: string; data: any }> = [];
    const r = await attachFileCommand(
      {
        fileId: next,
        ownerModule: OWNER_MODULE,
        ownerRecordType: AVATAR_RT,
        ownerRecordId: REC,
      },
      makeCtx(tenantId, emitted),
    );

    expect(r.success).toBe(true);

    // New row is linked + live.
    const nextRow = await readFileRow(next);
    expect(nextRow?.owner_record_id).toBe(REC);
    expect(nextRow?.status).toBe("uploaded");
    expect(nextRow?.deleted_at).toBeNull();

    // Prior row tombstoned.
    const priorRow = await readFileRow(prior);
    expect(priorRow?.status).toBe("deleted");
    expect(priorRow?.deleted_at).not.toBeNull();

    // bytes_used: 400 − (100 + 200) = 100 (the surviving new file). SC#4.
    expect(Number((await readUsage(tenantId))?.bytesUsed)).toBe(100);

    // file.deleted emitted for the replaced prior row only.
    const del = emitted.filter((e) => e.event === "file.deleted");
    expect(del.length).toBe(1);
    expect(del[0].data.fileId).toBe(prior);
    expect(del[0].data.ownerRecordId).toBe(REC);
  });

  test("default (many) relation leaves prior files untouched on attach", async () => {
    if (!canRun) return;
    const tenantId = newTenantId("many");
    const REC = "owner_doc_A";

    const first = await seedFile({
      tenantId,
      ownerRecordType: DOC_RT,
      ownerRecordId: REC,
      byteSize: 50,
      status: "uploaded",
    });
    const second = await seedFile({
      tenantId,
      ownerRecordType: DOC_RT,
      ownerRecordId: "",
      byteSize: 50,
      status: "uploaded",
    });
    await seedUsage(tenantId, 100);

    const emitted: Array<{ event: string; data: any }> = [];
    const r = await attachFileCommand(
      { fileId: second, ownerModule: OWNER_MODULE, ownerRecordType: DOC_RT, ownerRecordId: REC },
      makeCtx(tenantId, emitted),
    );

    expect(r.success).toBe(true);
    // First (prior) doc is still live — many-cardinality keeps every file.
    expect((await readFileRow(first))?.status).toBe("uploaded");
    expect((await readFileRow(first))?.deleted_at).toBeNull();
    // No quota change, no cascade emit.
    expect(Number((await readUsage(tenantId))?.bytesUsed)).toBe(100);
    expect(emitted.filter((e) => e.event === "file.deleted").length).toBe(0);
  });
});

describe("sign-upload SVG rejection for the avatar relation — Phase 29 / IDA-02, D-6", () => {
  test("image/svg+xml ⇒ err('mime_not_allowed')", async () => {
    const tenantId = newTenantId("svg");
    const r = await signUpload(
      { ownerModule: OWNER_MODULE, kind: "user", mimeType: "image/svg+xml", byteSize: 1024 },
      makeCtx(tenantId, []),
    );
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("mime_not_allowed");
  });
});
