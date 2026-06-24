/**
 * Phase 27 / ATT-01, ATT-02 — attach-file + list-for-record tests.
 *
 * Integration-level: runs against the real Postgres (`files` table; Docker up,
 * no FK on tenant_id so arbitrary tenant ids insert cleanly). Only
 * `@baseworks/config` is mocked (to supply env.DATABASE_URL without the full
 * env-schema validation, mirroring sign-upload.test.ts).
 *
 * The canRead/canWrite gates are driven through the REAL `findRelationByRecordType`
 * by registering relations into the shared `fileRelationsRegistry` under a unique
 * module (`att-mod`) with a distinct recordType per scenario. We deliberately do
 * NOT `mock.module("../lib/relation-lookup")`: bun's mock.module is process-global
 * and a relative-path mock of a shared internal module (a) strips its other
 * exports (breaking read-url.test.ts's `dispositionFor` import) and (b) leaks a
 * stale steering value into the complete-upload live-DB file. Registering real,
 * uniquely-keyed relations keeps this file fully isolated.
 *
 * Cases:
 *   - attach links the previously-unattached row (direct command)
 *   - attach via a SIMULATED ctx.dispatch (the production bus path)
 *   - cross-tenant fileId ⇒ err("not_found")  → route 404 (R2 no leak)
 *   - relation mismatch ⇒ err("relation_mismatch")
 *   - canWrite false ⇒ err("forbidden")  → route 403
 *   - list returns ONLY the tenant's non-deleted rows, no storageKey/bucket
 *   - list canRead false ⇒ err("not_found")  → route 404 (no existence leak)
 *   - list canRead true ⇒ returns the rows
 */

import { afterAll, describe, expect, mock, test } from "bun:test";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://baseworks:baseworks@localhost:5432/baseworks";

mock.module("@baseworks/config", () => ({ env: { DATABASE_URL } }));

const { files, getDb, getRlsDb, withTenant } = await import("@baseworks/db");
const { fileRelationsRegistry } = await import("@baseworks/storage");
const { sql } = await import("drizzle-orm");
const { attachFileCommand, attachFile } = await import("../commands/attach-file");
const { listForRecord } = await import("../queries/list-for-record");

const db = getDb(DATABASE_URL);

const OWNER_MODULE = "att-mod";
// Distinct recordTypes → distinct real relations, so each gate scenario is
// independent and no per-test mutation of shared state is needed.
const RT_PLAIN = "att_plain"; // no relation registered ⇒ no gate
const RT_WDENY = "att_wdeny"; // canWrite:false
const RT_RDENY = "att_rdeny"; // canRead:false
const RT_RALLOW = "att_rallow"; // canRead:true

fileRelationsRegistry.register(OWNER_MODULE, "wdeny", {
  recordType: RT_WDENY,
  allowedMimeTypes: ["image/png"],
  maxByteSize: 1_000_000,
  canWrite: async () => false,
});
fileRelationsRegistry.register(OWNER_MODULE, "rdeny", {
  recordType: RT_RDENY,
  allowedMimeTypes: ["image/png"],
  maxByteSize: 1_000_000,
  canRead: async () => false,
});
fileRelationsRegistry.register(OWNER_MODULE, "rallow", {
  recordType: RT_RALLOW,
  allowedMimeTypes: ["image/png"],
  maxByteSize: 1_000_000,
  canRead: async () => true,
});

// Unique run prefix so parallel/repeat runs never collide and cleanup is a single
// prefix DELETE.
const RUN = `tnt_p27att_${Math.random().toString(36).slice(2, 8)}`;
const TENANT_A = `${RUN}_a`;
const TENANT_B = `${RUN}_b`;

function makeCtx(tenantId: string): any {
  return {
    tenantId,
    userId: "usr_test",
    db: {},
    emit: () => undefined,
    // Mirror the apps/api request context: tenant DB work runs through an
    // RLS-role transaction with app.tenant_id set transaction-locally.
    withTenant: <T>(fn: (tx: any) => Promise<T>) => withTenant(getRlsDb(), tenantId, fn),
  };
}

let keySeq = 0;
async function insertFile(o: {
  tenantId: string;
  ownerRecordId: string;
  ownerModule?: string;
  ownerRecordType?: string;
  status?: string;
  deleted?: boolean;
}): Promise<string> {
  keySeq += 1;
  const [row] = await db
    .insert(files)
    .values({
      tenantId: o.tenantId,
      ownerModule: o.ownerModule ?? OWNER_MODULE,
      ownerRecordType: o.ownerRecordType ?? RT_PLAIN,
      ownerRecordId: o.ownerRecordId,
      storageKey: `${o.tenantId}/k/${RUN}-${keySeq}-${Math.random().toString(36).slice(2)}`,
      bucket: "files",
      mimeType: "image/png",
      byteSize: 123,
      status: o.status ?? "uploaded",
      deletedAt: o.deleted ? new Date() : null,
    })
    .returning({ id: files.id });
  return row.id;
}

// Raw-SQL read helper — the `db.select().from(files)` builder is banned repo-wide
// by the GritQL plugin (no path-allowlist), so assertions read via db.execute too.
async function fetchOwnerRecordId(fileId: string): Promise<string | undefined> {
  const rows = (await db.execute(
    sql`SELECT owner_record_id FROM files WHERE id = ${fileId} LIMIT 1`,
  )) as unknown as Array<{ owner_record_id: string }>;
  return rows[0]?.owner_record_id;
}

afterAll(async () => {
  await db.delete(files).where(sql`${files.tenantId} LIKE ${`${RUN}%`}`);
});

describe("attachFile — link a signed row (Phase 27 / ATT-02)", () => {
  test("direct command links the previously-unattached row", async () => {
    const fileId = await insertFile({ tenantId: TENANT_A, ownerRecordId: "", status: "pending" });

    const r = await attachFileCommand(
      {
        fileId,
        ownerModule: OWNER_MODULE,
        ownerRecordType: RT_PLAIN,
        ownerRecordId: "rec_1",
      },
      makeCtx(TENANT_A),
    );

    expect(r.success).toBe(true);
    if (!r.success) throw new Error(r.error);
    expect(r.data).toEqual({ fileId, ownerRecordId: "rec_1" });

    expect(await fetchOwnerRecordId(fileId)).toBe("rec_1");
  });

  test("helper prefers ctx.dispatch (the production bus path)", async () => {
    const fileId = await insertFile({ tenantId: TENANT_A, ownerRecordId: "" });

    const dispatched: string[] = [];
    const ctx = makeCtx(TENANT_A);
    // Simulate the apps/api self-referential dispatch wired to a bus that knows
    // the files:attach-file command.
    ctx.dispatch = async (command: string, input: unknown) => {
      dispatched.push(command);
      if (command === "files:attach-file") return attachFileCommand(input as any, ctx);
      return { success: false, error: "COMMAND_NOT_FOUND" };
    };

    const r = await attachFile(ctx, {
      fileId,
      ownerModule: OWNER_MODULE,
      ownerRecordType: RT_PLAIN,
      ownerRecordId: "rec_dispatch",
    });

    expect(dispatched).toEqual(["files:attach-file"]);
    expect(r.success).toBe(true);
    if (!r.success) throw new Error(r.error);
    expect(r.data.ownerRecordId).toBe("rec_dispatch");

    expect(await fetchOwnerRecordId(fileId)).toBe("rec_dispatch");
  });

  test("cross-tenant fileId ⇒ err('not_found') (R2 — no existence leak)", async () => {
    // Row belongs to TENANT_A; caller is TENANT_B.
    const fileId = await insertFile({ tenantId: TENANT_A, ownerRecordId: "" });

    const r = await attachFileCommand(
      {
        fileId,
        ownerModule: OWNER_MODULE,
        ownerRecordType: RT_PLAIN,
        ownerRecordId: "rec_x",
      },
      makeCtx(TENANT_B),
    );

    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("not_found");

    // The row must remain unattached — no cross-tenant write happened.
    expect(await fetchOwnerRecordId(fileId)).toBe("");
  });

  test("owner relation mismatch ⇒ err('relation_mismatch')", async () => {
    const fileId = await insertFile({ tenantId: TENANT_A, ownerRecordId: "" });

    const r = await attachFileCommand(
      {
        fileId,
        ownerModule: "billing", // row was minted for "att-mod"
        ownerRecordType: RT_PLAIN,
        ownerRecordId: "rec_y",
      },
      makeCtx(TENANT_A),
    );

    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("relation_mismatch");
  });

  test("relation.canWrite false ⇒ err('forbidden') (403)", async () => {
    const fileId = await insertFile({
      tenantId: TENANT_A,
      ownerRecordId: "",
      ownerRecordType: RT_WDENY,
    });

    const r = await attachFileCommand(
      {
        fileId,
        ownerModule: OWNER_MODULE,
        ownerRecordType: RT_WDENY,
        ownerRecordId: "rec_denied",
      },
      makeCtx(TENANT_A),
    );

    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("forbidden");

    // Denied link must not have mutated the row.
    expect(await fetchOwnerRecordId(fileId)).toBe("");
  });
});

describe("listForRecord — owner-scoped, tenant-scoped (Phase 27 / ATT-01)", () => {
  test("returns only the tenant's non-deleted rows, no storageKey/bucket", async () => {
    const RECORD = "rec_list_1";
    const f1 = await insertFile({ tenantId: TENANT_A, ownerRecordId: RECORD, status: "uploaded" });
    const f2 = await insertFile({ tenantId: TENANT_A, ownerRecordId: RECORD, status: "uploaded" });
    // Noise that must be excluded:
    await insertFile({ tenantId: TENANT_A, ownerRecordId: RECORD, deleted: true }); // soft-deleted
    await insertFile({ tenantId: TENANT_B, ownerRecordId: RECORD }); // other tenant
    await insertFile({ tenantId: TENANT_A, ownerRecordId: "other_record" }); // other record

    const r = await listForRecord(
      { ownerModule: OWNER_MODULE, ownerRecordType: RT_PLAIN, recordId: RECORD },
      makeCtx(TENANT_A),
    );

    expect(r.success).toBe(true);
    if (!r.success) throw new Error(r.error);

    const ids = r.data.files.map((f: any) => f.fileId).sort();
    expect(ids).toEqual([f1, f2].sort());

    // No storage internals leak in any DTO.
    for (const dto of r.data.files) {
      const keys = Object.keys(dto);
      expect(keys).not.toContain("storageKey");
      expect(keys).not.toContain("storage_key");
      expect(keys).not.toContain("bucket");
    }
    expect(JSON.stringify(r.data)).not.toContain("/k/");
  });

  test("canRead false ⇒ err('not_found') (no existence leak; NOT 403)", async () => {
    const RECORD = "rec_list_2";
    await insertFile({ tenantId: TENANT_A, ownerRecordId: RECORD, ownerRecordType: RT_RDENY });

    const r = await listForRecord(
      { ownerModule: OWNER_MODULE, ownerRecordType: RT_RDENY, recordId: RECORD },
      makeCtx(TENANT_A),
    );

    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("not_found");
  });

  test("canRead true ⇒ returns the rows", async () => {
    const RECORD = "rec_list_3";
    const f1 = await insertFile({
      tenantId: TENANT_A,
      ownerRecordId: RECORD,
      ownerRecordType: RT_RALLOW,
    });

    const r = await listForRecord(
      { ownerModule: OWNER_MODULE, ownerRecordType: RT_RALLOW, recordId: RECORD },
      makeCtx(TENANT_A),
    );

    expect(r.success).toBe(true);
    if (!r.success) throw new Error(r.error);
    expect(r.data.files.map((f: any) => f.fileId)).toEqual([f1]);
  });
});
