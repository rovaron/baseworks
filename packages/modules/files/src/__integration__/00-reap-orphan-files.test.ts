/**
 * Phase 31 / OPS-02 — cleanup-reap-orphan-files SAFETY tests (NO false delete).
 *
 * `00-`-prefixed to run BEFORE the @baseworks/db-faking unit suites (see
 * 00-reap-pending-uploads.test.ts header). Real config + real Postgres. The
 * reaper dispatches owner-existence via fileRelationsRegistry resolvers seeded
 * here; proves the §3 decision table — every branch is SKIP except a definitive
 * `false` on an old, live file.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://baseworks:baseworks@localhost:5432/baseworks";
process.env.NODE_ENV ??= "test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-min-32-chars-long-xxxxxxxxxxxxxxx";
process.env.STORAGE_PROVIDER = "local";

const TEST_DB_URL = process.env.DATABASE_URL;
const DEFAULT_QUOTA = 1_073_741_824;

const { reapOrphanFiles } = await import("../jobs/reap-orphan-files");
const { setCleanupEventSink } = await import("../lib/cleanup-events");
const { createDb, files, tenantStorageUsage, storageJobRuns } = await import("@baseworks/db");
const { fileRelationsRegistry, resetFileStorage, setFileStorage } = await import(
  "@baseworks/storage"
);
const { eq, inArray, sql } = await import("drizzle-orm");

const OWNER_MODULE = "orp-mod";
const RT_ALIVE = "orp_alive";
const RT_UNKNOWN = "orp_unknown";
const RT_THROW = "orp_throw";
const RT_NORESOLVER = "orp_noresolver";
const RT_GONE = "orp_gone";

const base = { allowedMimeTypes: ["image/png"], maxByteSize: 5_000_000 };
fileRelationsRegistry.register(OWNER_MODULE, "alive", {
  ...base,
  recordType: RT_ALIVE,
  ownerExists: async () => true,
});
fileRelationsRegistry.register(OWNER_MODULE, "unknown", {
  ...base,
  recordType: RT_UNKNOWN,
  ownerExists: async () => "unknown",
});
fileRelationsRegistry.register(OWNER_MODULE, "throw", {
  ...base,
  recordType: RT_THROW,
  ownerExists: async () => {
    throw new Error("db down");
  },
});
fileRelationsRegistry.register(OWNER_MODULE, "noresolver", {
  ...base,
  recordType: RT_NORESOLVER,
});
fileRelationsRegistry.register(OWNER_MODULE, "gone", {
  ...base,
  recordType: RT_GONE,
  ownerExists: async () => false,
});

const fakeStorage = {
  name: "fake",
  async signUpload() {
    throw new Error("unused");
  },
  async signRead() {
    throw new Error("unused");
  },
  async stat() {
    return null;
  },
  async delete() {},
  async getObject() {
    return new Uint8Array();
  },
  async putObject() {},
};

let db: ReturnType<typeof createDb>;
const createdTenantIds = new Set<string>();
const createdFileIds = new Set<string>();

function newTenantId(tag: string): string {
  const id = `orph_${tag}_${crypto.randomUUID().slice(0, 12)}`;
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
  recordType: string;
  recordId: string;
  byteSize: number;
  createdAt: Date;
  transforms?: Array<Record<string, unknown>>;
}): Promise<string> {
  const [row] = await db
    .insert(files)
    .values({
      tenantId: args.tenantId,
      ownerModule: OWNER_MODULE,
      ownerRecordType: args.recordType,
      ownerRecordId: args.recordId,
      storageKey: `${args.tenantId}/o/${crypto.randomUUID()}`,
      bucket: "files",
      mimeType: "image/png",
      byteSize: args.byteSize,
      status: "uploaded",
      createdAt: args.createdAt,
      ...(args.transforms ? { transforms: args.transforms as never } : {}),
    })
    .returning({ id: files.id });
  createdFileIds.add(row.id);
  return row.id;
}

async function readRow(id: string) {
  const rows = (await db.execute(
    sql`SELECT id, status, deleted_at FROM files WHERE id = ${id}`,
  )) as unknown as Array<{ id: string; status: string; deleted_at: string | null }>;
  return rows[0];
}
async function readUsage(tenantId: string) {
  const [row] = await db
    .select()
    .from(tenantStorageUsage)
    .where(eq(tenantStorageUsage.tenantId, tenantId));
  return row;
}

const OLD = () => new Date(Date.now() - 48 * 3600_000);
const RECENT = () => new Date(Date.now() - 60_000);

beforeAll(async () => {
  db = createDb(TEST_DB_URL);
  await db.execute(sql`SELECT 1`);
  setFileStorage(fakeStorage as never);
});

afterAll(async () => {
  setCleanupEventSink(null);
  if (createdFileIds.size > 0) {
    await db.delete(files).where(inArray(files.id, [...createdFileIds]));
  }
  if (createdTenantIds.size > 0) {
    await db
      .delete(tenantStorageUsage)
      .where(inArray(tenantStorageUsage.tenantId, [...createdTenantIds]));
  }
  await db.delete(storageJobRuns).where(eq(storageJobRuns.jobName, "cleanup-reap-orphan-files"));
  resetFileStorage();
  const handle = (db as unknown as { $sql?: { end: (o?: { timeout?: number }) => Promise<void> } })
    .$sql;
  if (handle) await handle.end({ timeout: 5 });
});

describe("reapOrphanFiles (Phase 31 / OPS-02, live DB, NO false delete)", () => {
  test("SKIP every non-definitive branch; REAP only the definitive-false old live file", async () => {
    const tenantId = newTenantId("all");

    const aliveId = await seedFile({
      tenantId,
      recordType: RT_ALIVE,
      recordId: "r-alive",
      byteSize: 100,
      createdAt: OLD(),
    });
    const unknownId = await seedFile({
      tenantId,
      recordType: RT_UNKNOWN,
      recordId: "r-unknown",
      byteSize: 100,
      createdAt: OLD(),
    });
    const throwId = await seedFile({
      tenantId,
      recordType: RT_THROW,
      recordId: "r-throw",
      byteSize: 100,
      createdAt: OLD(),
    });
    const noResolverId = await seedFile({
      tenantId,
      recordType: RT_NORESOLVER,
      recordId: "r-nores",
      byteSize: 100,
      createdAt: OLD(),
    });
    const graceId = await seedFile({
      tenantId,
      recordType: RT_GONE,
      recordId: "r-grace",
      byteSize: 100,
      createdAt: RECENT(), // definitive-false BUT within grace window ⇒ SKIP
    });
    // Unattached (owner_record_id = '' sentinel) old live file whose resolver would
    // return a definitive false — MUST be SKIPPED. The orphan reaper is the
    // cascade-backstop for ATTACHED files only; a never-attached upload must never
    // be reaped on a false ownerExists('') signal (Phase 31 data-safety fix).
    const unattachedId = await seedFile({
      tenantId,
      recordType: RT_GONE,
      recordId: "",
      byteSize: 100,
      createdAt: OLD(),
    });
    const reapId = await seedFile({
      tenantId,
      recordType: RT_GONE,
      recordId: "r-gone",
      byteSize: 1000,
      createdAt: OLD(),
      transforms: [{ name: "t", storageKey: "k/t.webp", mimeType: "image/webp", byteSize: 250 }],
    });

    // 100*4 (skips) + 100 (grace) + 100 (unattached) + 1000 + 250 (reap target) = 1850.
    await seedUsage(tenantId, 100 * 4 + 100 + 100 + 1000 + 250);

    const emitted: Array<{ event: string; data: Record<string, unknown> }> = [];
    setCleanupEventSink((event, data) => emitted.push({ event, data: data as never }));

    await reapOrphanFiles({});

    for (const id of [aliveId, unknownId, throwId, noResolverId, graceId, unattachedId]) {
      const row = await readRow(id);
      expect(row?.status).toBe("uploaded");
      expect(row?.deleted_at).toBeNull();
    }

    const reaped = await readRow(reapId);
    expect(reaped?.status).toBe("deleted");
    expect(reaped?.deleted_at).not.toBeNull();

    // 1850 - (1000 + 250) = 600.
    expect(Number((await readUsage(tenantId))?.bytesUsed)).toBe(600);

    const deletedEvents = emitted.filter((e) => e.event === "file.deleted");
    expect(deletedEvents.length).toBe(1);
    expect(deletedEvents[0]?.data.fileId).toBe(reapId);
    expect(deletedEvents[0]?.data.reason).toBe("orphan-reap");
  });
});
