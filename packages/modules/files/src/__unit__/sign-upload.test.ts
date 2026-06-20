/**
 * Phase 26 / UPL-01, UPL-03, MOD-02 — sign-upload unit tests.
 *
 * Unit-level coverage of the validation + response contract (the LIVE-DB flow +
 * 50-concurrent quota race are the Verify phase's job). The raw drizzle instance
 * (`@baseworks/db` getDb) is mocked so these tests run without Postgres; the real
 * `fileRelationsRegistry` is used (a test relation is registered), and
 * `getFileStorage()` is stubbed via `setFileStorage`.
 *
 * ISOLATION (load-bearing — do not move back into ../__tests__): this is the ONLY
 * files suite that `mock.module("@baseworks/db", …)` with a fake `getDb` + fake
 * schema tables (and no `createDb`). bun's `mock.module` is process-global and the
 * first registration wins for the whole run, so when this shares a process with
 * the LIVE-DB suites (admin-files, attach-and-list, quota, cascade, …) the fake db
 * leaks in → `createDb` undefined / `delete from $1` on the fake `files` object.
 * It manifests on CI's file order, not Windows'. So it lives in its own
 * `__unit__/` directory and the root `package.json` "test" script runs it as a
 * SEPARATE `bun test` invocation.
 *
 * Cases:
 *   - unknown (ownerModule, kind) ⇒ err("unknown_relation")  → route 400 (MOD-02)
 *   - MIME not in allow-list      ⇒ err("mime_not_allowed")  → route 400
 *   - byteSize > maxByteSize      ⇒ err("file_too_large")    → route 400
 *   - quota reservation 0 rows    ⇒ err("quota_exceeded")    → route 413 (QUO-02)
 *   - happy path                  ⇒ ok({...}) with NO storage_key field (R4)
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

// --- Mock the raw drizzle instance (no Postgres needed for unit tests) ---
// Mutable knobs so individual tests steer reserveQuota's UPDATE-row result.
let executeRows: unknown[] = [{ bytes_used: 0, bytes_pending: 100, bytes_limit: 1_000_000 }];
const insertedFileId = "file_test_123";

// Spy on the rollback DELETE so the post-reserve-failure test can assert the
// orphan pending row is cleaned up.
const deleteWhere = mock(async () => undefined);

const fakeDb = {
  insert: () => ({
    values: () => ({
      // reserveQuota's idempotent ON CONFLICT DO NOTHING (awaited, no rows used)
      onConflictDoNothing: async () => undefined,
      // sign-upload's files insert (.returning({ id }))
      returning: async () => [{ id: insertedFileId }],
    }),
  }),
  // reserveQuota / releaseQuota raw UPDATE ... RETURNING
  execute: async () => executeRows,
  // sign-upload rollback path: db.delete(files).where(...)
  delete: () => ({ where: deleteWhere }),
};

mock.module("@baseworks/config", () => ({
  env: {
    DATABASE_URL: "postgres://test:test@localhost:5432/testdb",
    STORAGE_DEFAULT_QUOTA_BYTES: 1_073_741_824,
  },
}));
mock.module("@baseworks/db", () => ({
  getDb: () => fakeDb,
  files: { id: "files.id" },
  tenantStorageUsage: { tenantId: "tenant_storage_usage.tenant_id" },
}));

const { signUpload } = await import("../commands/sign-upload");
const { fileRelationsRegistry, setFileStorage } = await import("@baseworks/storage");

// Stub the FileStorage singleton so signUpload returns a deterministic envelope
// that carries NO storage key (mirrors the real SignedUpload type).
const signUploadStub = mock(async (_args: { expiresInSec: number }) => ({
  method: "PUT" as const,
  url: "https://signed.example/upload?sig=abc",
  expiresAt: new Date(Date.now() + 900_000).toISOString(),
}));
setFileStorage({
  name: "stub",
  signUpload: signUploadStub,
  signRead: async () => ({ url: "", expiresAt: "" }),
  stat: async () => null,
  delete: async () => undefined,
  getObject: async () => new Uint8Array(),
  putObject: async () => undefined,
} as any);

const OWNER_MODULE = "test-mod";
const KIND = "avatar";
const RECORD_TYPE = "test_user";

// Register a known relation into the real registry (SC#4 lookup path).
fileRelationsRegistry.register(OWNER_MODULE, KIND, {
  recordType: RECORD_TYPE,
  allowedMimeTypes: ["image/png", "image/jpeg"],
  maxByteSize: 5_000_000,
});

const ctx = {
  tenantId: "tnt_unit",
  userId: "usr_unit",
  db: {},
  emit: () => undefined,
} as any;

describe("signUpload — validation + response contract (Phase 26)", () => {
  beforeEach(() => {
    executeRows = [{ bytes_used: 0, bytes_pending: 100, bytes_limit: 1_000_000 }];
    signUploadStub.mockClear();
    deleteWhere.mockClear();
  });

  test("unknown (ownerModule, kind) ⇒ err('unknown_relation') (MOD-02)", async () => {
    const r = await signUpload(
      { ownerModule: "nope", kind: "nope", mimeType: "image/png", byteSize: 1024 },
      ctx,
    );
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("unknown_relation");
  });

  test("disallowed MIME ⇒ err('mime_not_allowed')", async () => {
    const r = await signUpload(
      { ownerModule: OWNER_MODULE, kind: KIND, mimeType: "application/pdf", byteSize: 1024 },
      ctx,
    );
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("mime_not_allowed");
  });

  test("oversize (byteSize > maxByteSize) ⇒ err('file_too_large')", async () => {
    const r = await signUpload(
      { ownerModule: OWNER_MODULE, kind: KIND, mimeType: "image/png", byteSize: 9_999_999 },
      ctx,
    );
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("file_too_large");
  });

  test("quota reservation returns 0 rows ⇒ err('quota_exceeded') (QUO-02)", async () => {
    executeRows = []; // reserveQuota UPDATE matches no row ⇒ over limit
    const r = await signUpload(
      { ownerModule: OWNER_MODULE, kind: KIND, mimeType: "image/png", byteSize: 1024 },
      ctx,
    );
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("quota_exceeded");
    // signing must never be attempted once the quota gate fails
    expect(signUploadStub).not.toHaveBeenCalled();
  });

  test("happy path ⇒ ok with signed url and NO storage_key field (R4 / UPL-01)", async () => {
    const r = await signUpload(
      { ownerModule: OWNER_MODULE, kind: KIND, mimeType: "image/png", byteSize: 2048 },
      ctx,
    );
    expect(r.success).toBe(true);
    if (!r.success) throw new Error(`expected success, got ${r.error}`);

    expect(r.data.fileId).toBe(insertedFileId);
    expect(r.data.method).toBe("PUT");
    expect(r.data.url).toContain("https://signed.example/upload");
    expect(typeof r.data.expiresAt).toBe("string");

    // TTL ≤ 15 min (UPL-01)
    const ttlMs = new Date(r.data.expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeLessThanOrEqual(900_000 + 5_000);

    // R4 — no storage key (in any form) leaks into the response body.
    const keys = Object.keys(r.data);
    expect(keys).not.toContain("storageKey");
    expect(keys).not.toContain("storage_key");
    expect(keys).not.toContain("key");
    expect(keys).not.toContain("bucket");
    expect(JSON.stringify(r.data)).not.toContain("tnt_unit/test-mod/avatar/");

    // signUpload was invoked with a TTL within the 15-min ceiling.
    expect(signUploadStub).toHaveBeenCalledTimes(1);
    const arg = signUploadStub.mock.calls[0]?.[0];
    expect(arg?.expiresInSec).toBeLessThanOrEqual(900);
  });

  test("post-reserve failure ⇒ err('sign_upload_failed') — raw DB error never leaks (info-disclosure)", async () => {
    // Simulate a storage failure AFTER the files row + quota are committed. The
    // real risk is a Postgres unique-violation whose text names the constraint /
    // storage_key; assert that text never reaches the response.
    signUploadStub.mockImplementationOnce(async () => {
      throw new Error(
        'duplicate key value violates unique constraint "files_bucket_key_uq" — Key (bucket, storage_key)=(uploads, tnt_unit/test-mod/avatar/secret123)',
      );
    });

    const r = await signUpload(
      { ownerModule: OWNER_MODULE, kind: KIND, mimeType: "image/png", byteSize: 2048 },
      ctx,
    );

    expect(r.success).toBe(false);
    if (!r.success) {
      // Fixed code only — no internal/DB detail.
      expect(r.error).toBe("sign_upload_failed");
      expect(r.error).not.toContain("files_bucket_key_uq");
      expect(r.error).not.toContain("storage_key");
      expect(r.error).not.toContain("secret123");
    }

    // Rollback: the orphan pending row is deleted and quota is released
    // (releaseQuota issues one execute() UPDATE).
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });
});
