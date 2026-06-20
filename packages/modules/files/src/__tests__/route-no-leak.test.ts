/**
 * Phase 27 / UPL-04 (SC#2) — route-level no-storage-key-leak scan.
 *
 * SC#2 names "an integration test scanning ALL /api/files/* JSON responses" for
 * the raw storage_key. The per-handler tests (read-url / list-for-record /
 * complete-upload) each assert no-leak on their own DTO; THIS file is the
 * dedicated route-level scan: it mounts the real `filesRoutes` Elysia plugin
 * behind a `.derive`d handlerCtx, drives EVERY /api/files/* endpoint against the
 * live Postgres + a temp-rooted LocalFileStorage, and scans every JSON response
 * body for a leaked storage_key/bucket.
 *
 * Two complementary assertions per response (the no-leak invariant, exactly as
 * the per-handler tests encode it):
 *   1. NO response body — at any nesting depth — carries a field named
 *      `storageKey`, `storage_key`, or `bucket`.
 *   2. For the routes whose DTO contains NO signed URL (complete, attach,
 *      list-for-record, delete) the raw storage key STRING must not appear at
 *      all. sign-upload / read-url are exempt from (2): their signed PUT/GET URL
 *      legitimately embeds the (HMAC-unforgeable) key in its path — the no-leak
 *      rule bans a separate storage_key DTO field, not the signed URL itself
 *      (see read-url.test.ts / signing.ts header, Pitfall 1).
 *
 * Runs against the REAL DB (DB layer NOT mocked — a leaked getDb mock would break
 * sibling live-DB files in the same process); only @baseworks/config is mocked
 * with the REAL DATABASE_URL + storage envs.
 */

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const TEST_DB_URL =
  process.env.DATABASE_URL ?? "postgres://baseworks:baseworks@localhost:5432/baseworks";
const DEFAULT_QUOTA = 1_073_741_824;

const STORAGE_ROOT = resolve(tmpdir(), `bw-nl27-${crypto.randomUUID().slice(0, 8)}`);
process.env.STORAGE_LOCAL_PATH = STORAGE_ROOT;

mock.module("@baseworks/config", () => ({
  env: {
    DATABASE_URL: TEST_DB_URL,
    STORAGE_DEFAULT_QUOTA_BYTES: DEFAULT_QUOTA,
    STORAGE_SIGNED_URL_TTL_SEC: 600,
  },
}));

const { Elysia } = await import("elysia");
const { filesRoutes } = await import("../routes");
const { createDb, files, tenantStorageUsage } = await import("@baseworks/db");
const { LocalFileStorage, fileRelationsRegistry, resetFileStorage, setFileStorage } = await import(
  "@baseworks/storage"
);
const { eq, inArray, sql } = await import("drizzle-orm");

// Real PNG signature + IHDR chunk (file-type v22 reads IHDR). 29 bytes.
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00,
]);

let db: ReturnType<typeof createDb>;
const storage = new LocalFileStorage();
const createdFileIds = new Set<string>();
const TENANT = `nl27_${crypto.randomUUID().slice(0, 12)}`;

const OWNER_MODULE = "nl-mod";
const KIND = "img";
const RECORD_TYPE = "nl_doc";
const RECORD_ID = "nl_rec_1";

fileRelationsRegistry.register(OWNER_MODULE, KIND, {
  recordType: RECORD_TYPE,
  allowedMimeTypes: ["image/png"],
  maxByteSize: 5_000_000,
});

// Mount the REAL routes behind a derived handlerCtx (mirrors the apps/api scoped
// band: tenantMiddleware + handlerCtx derive run before getModuleRoutes()).
const app = new Elysia()
  .derive(() => ({
    handlerCtx: { tenantId: TENANT, userId: "u", db: {}, emit: () => undefined } as any,
  }))
  .use(filesRoutes);

async function seedUsage(pending: number): Promise<void> {
  await db
    .insert(tenantStorageUsage)
    .values({ tenantId: TENANT, bytesUsed: 0, bytesPending: pending, bytesLimit: DEFAULT_QUOTA })
    .onConflictDoUpdate({
      target: tenantStorageUsage.tenantId,
      set: { bytesUsed: 0, bytesPending: pending, bytesLimit: DEFAULT_QUOTA },
    });
}

async function seedFile(args: {
  key: string;
  ownerRecordId: string;
  status: string;
}): Promise<string> {
  const [row] = await db
    .insert(files)
    .values({
      tenantId: TENANT,
      ownerModule: OWNER_MODULE,
      ownerRecordType: RECORD_TYPE,
      ownerRecordId: args.ownerRecordId,
      storageKey: args.key,
      bucket: "files",
      mimeType: "image/png",
      byteSize: PNG.length,
      status: args.status,
      originalFilename: "pic.png",
    })
    .returning({ id: files.id });
  createdFileIds.add(row.id);
  return row.id;
}

/** Recursively collect every object key in a parsed JSON value. */
function allKeys(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, acc);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      acc.push(k);
      allKeys(v, acc);
    }
  }
  return acc;
}

const FORBIDDEN_FIELDS = ["storageKey", "storage_key", "bucket"];

/** Assert a parsed response body leaks no storage_key/bucket field (invariant 1). */
function expectNoLeakFields(label: string, body: unknown): void {
  const keys = allKeys(body);
  for (const forbidden of FORBIDDEN_FIELDS) {
    expect(keys, `${label} leaked field "${forbidden}"`).not.toContain(forbidden);
  }
}

async function call(method: string, path: string, body?: unknown): Promise<{ json: any }> {
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await app.handle(req);
  const text = await res.text();
  return { json: text ? JSON.parse(text) : undefined };
}

beforeAll(async () => {
  db = createDb(TEST_DB_URL);
  await db.execute(sql`SELECT 1`);
  setFileStorage(storage);
  await seedUsage(0);
});

afterAll(async () => {
  if (createdFileIds.size > 0) {
    await db.delete(files).where(inArray(files.id, [...createdFileIds]));
  }
  await db.delete(tenantStorageUsage).where(eq(tenantStorageUsage.tenantId, TENANT));
  resetFileStorage();
  await rm(STORAGE_ROOT, { recursive: true, force: true });
  const handle = (db as unknown as { $sql?: { end: (o?: { timeout?: number }) => Promise<void> } })
    .$sql;
  if (handle) await handle.end({ timeout: 5 });
});

describe("filesRoutes — no storage_key/bucket leak across EVERY /api/files/* response (Phase 27 / SC#2)", () => {
  test("POST /sign-upload ⇒ no leaked storageKey/bucket field", async () => {
    const { json } = await call("POST", "/api/files/sign-upload", {
      ownerModule: OWNER_MODULE,
      kind: KIND,
      mimeType: "image/png",
      byteSize: PNG.length,
    });
    // Signed PUT url legitimately embeds the key — invariant 1 only.
    expectNoLeakFields("sign-upload", json);
    if (json?.fileId) createdFileIds.add(json.fileId);
  });

  test("POST /:fileId/complete ⇒ no leaked field, raw key absent from body", async () => {
    const key = `${TENANT}/nl/complete/${crypto.randomUUID()}.png`;
    await storage.putObject({ bucket: "files", key, body: PNG, mimeType: "image/png" });
    const fileId = await seedFile({ key, ownerRecordId: RECORD_ID, status: "pending" });

    const { json } = await call("POST", `/api/files/${fileId}/complete`);
    expect(json.status).toBe("uploaded");
    expectNoLeakFields("complete", json);
    expect(JSON.stringify(json), "complete leaked the raw storage key").not.toContain(key);
  });

  test("GET /:fileId/read-url ⇒ no leaked storageKey/bucket field", async () => {
    const key = `${TENANT}/nl/read/${crypto.randomUUID()}.png`;
    const fileId = await seedFile({ key, ownerRecordId: RECORD_ID, status: "uploaded" });

    const { json } = await call("GET", `/api/files/${fileId}/read-url`);
    expect(Object.keys(json)).toEqual(["url", "expiresAt"]);
    // Signed GET url legitimately embeds the key — invariant 1 only.
    expectNoLeakFields("read-url", json);
  });

  test("POST /attach ⇒ no leaked field, raw key absent from body", async () => {
    const key = `${TENANT}/nl/attach/${crypto.randomUUID()}.png`;
    const fileId = await seedFile({ key, ownerRecordId: "", status: "pending" });

    const { json } = await call("POST", "/api/files/attach", {
      fileId,
      ownerModule: OWNER_MODULE,
      ownerRecordType: RECORD_TYPE,
      ownerRecordId: RECORD_ID,
    });
    expect(json.fileId).toBe(fileId);
    expectNoLeakFields("attach", json);
    expect(JSON.stringify(json), "attach leaked the raw storage key").not.toContain(key);
  });

  test("GET /list-for-record ⇒ no leaked field, raw key absent from body", async () => {
    const key = `${TENANT}/nl/list/${crypto.randomUUID()}.png`;
    await seedFile({ key, ownerRecordId: "nl_rec_list", status: "uploaded" });

    const { json } = await call(
      "GET",
      `/api/files/list-for-record?ownerModule=${OWNER_MODULE}&ownerRecordType=${RECORD_TYPE}&recordId=nl_rec_list`,
    );
    expect(Array.isArray(json.files)).toBe(true);
    expect(json.files.length).toBeGreaterThan(0);
    expectNoLeakFields("list-for-record", json);
    expect(JSON.stringify(json), "list-for-record leaked the raw storage key").not.toContain(key);
  });

  test("DELETE /:fileId ⇒ no leaked field, raw key absent from body", async () => {
    const key = `${TENANT}/nl/delete/${crypto.randomUUID()}.png`;
    await storage.putObject({ bucket: "files", key, body: PNG, mimeType: "image/png" });
    const fileId = await seedFile({ key, ownerRecordId: RECORD_ID, status: "uploaded" });

    const { json } = await call("DELETE", `/api/files/${fileId}`);
    expect(json.deleted).toBe(true);
    expectNoLeakFields("delete", json);
    expect(JSON.stringify(json), "delete leaked the raw storage key").not.toContain(key);
  });
});
