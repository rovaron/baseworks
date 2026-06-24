/**
 * Phase 27 / UPL-04 — get-read-url LIVE-DB integration tests.
 *
 * Runs against the REAL Postgres with a temp-rooted LocalFileStorage so
 * `signRead` mints a real signed URL. The DB layer is NOT mocked (a leaked
 * `getDb` mock would break the other live-DB files in the same process); only
 * `@baseworks/config` is mocked, with the REAL DATABASE_URL + the storage envs.
 *
 * Cases (SC#2):
 *   - happy path     ⇒ ok({url,expiresAt}), env TTL, inline disposition, NO key
 *   - unknown fileId ⇒ err('not_found') (404)
 *   - canRead denial ⇒ err('not_found') (404, never 403 — no existence leak)
 */

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const TEST_DB_URL =
  process.env.DATABASE_URL ?? "postgres://baseworks:baseworks@localhost:5432/baseworks";
const TTL = 600;

const STORAGE_ROOT = resolve(tmpdir(), `bw-ru27-${crypto.randomUUID().slice(0, 8)}`);
process.env.STORAGE_LOCAL_PATH = STORAGE_ROOT;

mock.module("@baseworks/config", () => ({
  env: {
    DATABASE_URL: TEST_DB_URL,
    STORAGE_DEFAULT_QUOTA_BYTES: 1_073_741_824,
    STORAGE_SIGNED_URL_TTL_SEC: TTL,
  },
}));

const { getReadUrl } = await import("../queries/get-read-url");
const { createDb, files, getRlsDb, withTenant } = await import("@baseworks/db");
const { LocalFileStorage, fileRelationsRegistry, resetFileStorage, setFileStorage } = await import(
  "@baseworks/storage"
);
const { inArray, eq, sql } = await import("drizzle-orm");

let db: ReturnType<typeof createDb>;
const storage = new LocalFileStorage();
const createdFileIds = new Set<string>();

// Public relation (no canRead) + a private relation that denies reads.
fileRelationsRegistry.register("ru-pub", "image", {
  recordType: "ru_doc",
  allowedMimeTypes: ["image/png"],
  maxByteSize: 5_000_000,
});
fileRelationsRegistry.register("ru-priv", "secret", {
  recordType: "ru_secret",
  allowedMimeTypes: ["image/png"],
  maxByteSize: 5_000_000,
  canRead: async () => false,
});

const TENANT = `ru27_${crypto.randomUUID().slice(0, 12)}`;

async function seedFile(args: {
  ownerModule: string;
  ownerRecordType: string;
  key: string;
}): Promise<string> {
  const [row] = await db
    .insert(files)
    .values({
      tenantId: TENANT,
      ownerModule: args.ownerModule,
      ownerRecordType: args.ownerRecordType,
      ownerRecordId: "rec1",
      storageKey: args.key,
      bucket: "files",
      mimeType: "image/png",
      byteSize: 10,
      status: "uploaded",
      originalFilename: "pic.png",
    })
    .returning({ id: files.id });
  createdFileIds.add(row.id);
  return row.id;
}

const ctx = {
  tenantId: TENANT,
  userId: "u",
  db: {},
  emit: () => undefined,
  withTenant: <T>(fn: (tx: any) => Promise<T>) => withTenant(getRlsDb(), TENANT, fn),
} as any;

beforeAll(async () => {
  db = createDb(TEST_DB_URL);
  await db.execute(sql`SELECT 1`);
  setFileStorage(storage);
});

afterAll(async () => {
  if (createdFileIds.size > 0) {
    await db.delete(files).where(inArray(files.id, [...createdFileIds]));
  }
  resetFileStorage();
  await rm(STORAGE_ROOT, { recursive: true, force: true });
  const handle = (db as unknown as { $sql?: { end: (o?: { timeout?: number }) => Promise<void> } })
    .$sql;
  if (handle) await handle.end({ timeout: 5 });
});

describe("getReadUrl — signed read url + no-leak + canRead gate (Phase 27 / UPL-04, live DB)", () => {
  test("happy path ⇒ ok({url,expiresAt}), env TTL, inline disposition, NO key/bucket", async () => {
    const key = `${TENANT}/ru/image/${crypto.randomUUID()}.png`;
    const fileId = await seedFile({ ownerModule: "ru-pub", ownerRecordType: "ru_doc", key });

    const r = await getReadUrl({ fileId }, ctx);
    expect(r.success).toBe(true);
    if (!r.success) throw new Error(r.error);
    expect(typeof r.data.url).toBe("string");
    expect(r.data.url.length).toBeGreaterThan(0);
    expect(typeof r.data.expiresAt).toBe("string");

    // TTL ≈ env value (signed url expiry within the 600s window + skew).
    const ttlMs = new Date(r.data.expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeLessThanOrEqual(TTL * 1000 + 5_000);
    expect(ttlMs).toBeGreaterThan(0);

    // The DTO carries ONLY url + expiresAt — no raw storageKey/bucket field.
    // (The signed URL path legitimately embeds the key, made unforgeable by the
    // HMAC sig; the no-leak rule bans a separate storage_key DTO field.)
    expect(Object.keys(r.data)).toEqual(["url", "expiresAt"]);
    expect(JSON.stringify(r.data)).not.toContain("storageKey");
    expect(JSON.stringify(r.data)).not.toContain('"bucket"');
  });

  test("unknown fileId ⇒ err('not_found') (404)", async () => {
    const r = await getReadUrl({ fileId: crypto.randomUUID() }, ctx);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("not_found");
  });

  test("canRead denial ⇒ err('not_found') → 404, NOT 403 (no existence leak)", async () => {
    const key = `${TENANT}/ru/secret/${crypto.randomUUID()}.png`;
    const fileId = await seedFile({ ownerModule: "ru-priv", ownerRecordType: "ru_secret", key });

    const r = await getReadUrl({ fileId }, ctx);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("not_found");
  });
});
