/**
 * Phase 27 / MOD-03 — cascade soft-delete subscriber LIVE-DB tests (SC#5).
 *
 * Runs against the REAL Postgres (DATABASE_URL). `@baseworks/config` is mocked
 * only to inject the real DATABASE_URL + STORAGE_DEFAULT_QUOTA_BYTES, and
 * `@baseworks/observability` is mocked to keep getErrorTracker() inert; the DB
 * layer is NOT mocked, so the cascade tx hits Postgres. No FileStorage is needed —
 * the cascade is DB-only (physical objects are swept in Phase 31).
 *
 * The auth-side producer of `auth.user-deleted` does not exist until Phase 29, so
 * SC#5 is proven by EMITTING the canonical `{tenantId, recordId}` deletion event
 * in-test and asserting the subscriber's effect.
 *
 * Cases (SC#5):
 *   - emitting `<ownerModule>.<recordType>-deleted` for a relation declared
 *     onDelete:'cascade' soft-deletes the owner's files (deleted_at set, status
 *     'deleted') and decrements bytes_used by the SUM of counted rows
 *   - files of a NON-cascade relation for the same recordId are left untouched
 *   - a `file.deleted` event is emitted per tombstoned row
 */

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

const TEST_DB_URL =
  process.env.DATABASE_URL ?? "postgres://baseworks:baseworks@localhost:5432/baseworks";
const DEFAULT_QUOTA = 1_073_741_824;

mock.module("@baseworks/config", () => ({
  env: {
    DATABASE_URL: TEST_DB_URL,
    STORAGE_DEFAULT_QUOTA_BYTES: DEFAULT_QUOTA,
  },
}));
mock.module("@baseworks/observability", () => ({
  getErrorTracker: () => ({ captureException: () => {} }),
}));

const { registerFilesHooks } = await import("../hooks/on-tenant-created");
const { createDb, files, tenantStorageUsage } = await import("@baseworks/db");
const { fileRelationsRegistry } = await import("@baseworks/storage");
const { eq, inArray, sql } = await import("drizzle-orm");

// A cascade relation (recordType 'csc_user') + a NON-cascade relation in the same
// module (recordType 'csc_doc'). The subscriber must wire only the cascade event.
const OWNER_MODULE = "csc-auth";
const CASCADE_RT = "csc_user";
const ORPHAN_RT = "csc_doc";
fileRelationsRegistry.register(OWNER_MODULE, "user", {
  recordType: CASCADE_RT,
  allowedMimeTypes: ["image/png"],
  maxByteSize: 5_000_000,
  onDelete: "cascade",
});
fileRelationsRegistry.register(OWNER_MODULE, "doc", {
  recordType: ORPHAN_RT,
  allowedMimeTypes: ["image/png"],
  maxByteSize: 5_000_000,
  onDelete: "orphan",
});

let db: ReturnType<typeof createDb>;
const createdTenantIds = new Set<string>();
const createdFileIds = new Set<string>();

function newTenantId(tag: string): string {
  const id = `csc27_${tag}_${crypto.randomUUID().slice(0, 12)}`;
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
      storageKey: `${args.tenantId}/csc/${crypto.randomUUID()}`,
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

/** Minimal in-process event bus double: stores handlers, awaits them on emit. */
function makeBus() {
  const handlers = new Map<string, Array<(d: unknown) => Promise<void>>>();
  const emitted: Array<{ event: string; data: any }> = [];
  return {
    emitted,
    on(event: string, handler: (d: unknown) => Promise<void>) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    emit(event: string, data: unknown) {
      emitted.push({ event, data: data as any });
      const list = handlers.get(event) ?? [];
      return Promise.all(list.map((h) => h(data)));
    },
  };
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
  const handle = (db as unknown as { $sql?: { end: (o?: { timeout?: number }) => Promise<void> } })
    .$sql;
  if (handle) await handle.end({ timeout: 5 });
});

describe("cascade soft-delete subscriber (Phase 27 / MOD-03, SC#5, live DB)", () => {
  test("owner-deletion event ⇒ cascade soft-delete + bytes_used decrement; non-cascade untouched", async () => {
    const tenantId = newTenantId("cascade");
    const U1 = "U1";

    // Two CASCADE files (100 + 100) + one NON-cascade file (50) for the same
    // record. bytes_used reflects all three counted rows = 250.
    const f1 = await seedFile({
      tenantId,
      ownerRecordType: CASCADE_RT,
      ownerRecordId: U1,
      byteSize: 100,
      status: "uploaded",
    });
    const f2 = await seedFile({
      tenantId,
      ownerRecordType: CASCADE_RT,
      ownerRecordId: U1,
      byteSize: 100,
      status: "uploaded",
    });
    const orphan = await seedFile({
      tenantId,
      ownerRecordType: ORPHAN_RT,
      ownerRecordId: U1,
      byteSize: 50,
      status: "uploaded",
    });
    await seedUsage(tenantId, 250);

    // Wire the generic subscriber from the (populated) relations registry, then
    // fire the canonical owner-deletion event.
    const bus = makeBus();
    registerFilesHooks(bus);
    await bus.emit(`${OWNER_MODULE}.${CASCADE_RT}-deleted`, { tenantId, recordId: U1 });

    // Both cascade files tombstoned.
    for (const id of [f1, f2]) {
      const row = await readFileRow(id);
      expect(row?.status).toBe("deleted");
      expect(row?.deleted_at).not.toBeNull();
    }

    // Non-cascade file for the SAME record is untouched.
    const orphanRow = await readFileRow(orphan);
    expect(orphanRow?.status).toBe("uploaded");
    expect(orphanRow?.deleted_at).toBeNull();

    // bytes_used decremented by the SUM of the cascade rows (200), leaving 50.
    expect(Number((await readUsage(tenantId))?.bytesUsed)).toBe(50);

    // One file.deleted emitted per tombstoned cascade row.
    const deletedEvents = bus.emitted.filter((e) => e.event === "file.deleted");
    expect(deletedEvents.length).toBe(2);
    expect(deletedEvents.map((e) => e.data.fileId).sort()).toEqual([f1, f2].sort());
    for (const e of deletedEvents) {
      expect(e.data.tenantId).toBe(tenantId);
      expect(e.data.ownerRecordId).toBe(U1);
    }
  });

  test("cascade refunds byte_size + variant bytes for a transformed row (SC#3 conservation)", async () => {
    // Phase 28 regression: a transformed (status 'ready') file carries a variant
    // manifest whose bytes were credited into bytes_used by the transform job. The
    // cascade refund MUST debit byte_size AND the manifest sum, else variant bytes
    // leak on owner deletion.
    const tenantId = newTenantId("cascadexf");
    const U2 = "U2";
    const variants = [
      { name: "thumb", storageKey: "k/thumb.webp", mimeType: "image/webp", byteSize: 120 },
      { name: "small", storageKey: "k/small.jpg", mimeType: "image/jpeg", byteSize: 80 },
    ];
    const variantBytes = variants.reduce((a, v) => a + v.byteSize, 0); // 200
    const original = 100;
    const f = await seedFile({
      tenantId,
      ownerRecordType: CASCADE_RT,
      ownerRecordId: U2,
      byteSize: original,
      status: "ready",
      transforms: variants,
    });
    await seedUsage(tenantId, original + variantBytes); // 300

    const bus = makeBus();
    registerFilesHooks(bus);
    await bus.emit(`${OWNER_MODULE}.${CASCADE_RT}-deleted`, { tenantId, recordId: U2 });

    expect((await readFileRow(f))?.status).toBe("deleted");
    // Full conservation: 300 − (100 + 200) = 0.
    expect(Number((await readUsage(tenantId))?.bytesUsed)).toBe(0);
  });

  test("deletion event for a record that owns no files ⇒ no-op (no decrement, no emit)", async () => {
    const tenantId = newTenantId("noop");
    await seedUsage(tenantId, 777);

    const bus = makeBus();
    registerFilesHooks(bus);
    await bus.emit(`${OWNER_MODULE}.${CASCADE_RT}-deleted`, { tenantId, recordId: "no-such" });

    expect(Number((await readUsage(tenantId))?.bytesUsed)).toBe(777);
    expect(bus.emitted.filter((e) => e.event === "file.deleted").length).toBe(0);
  });
});
