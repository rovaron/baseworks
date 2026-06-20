/**
 * Phase 28 / IMG-01, IMG-02, IMG-03 — transform-image job handler tests.
 *
 * Calls the handler DIRECTLY with `job.data` (the worker passes `job.data`
 * straight through) for deterministic coverage. ALL dependencies are FAKED
 * IN-FILE so the test is a true unit test AND immune to bun's process-global
 * `mock.module` leakage (a sibling test mocks `@baseworks/db` with a partial
 * stub; bun runs file-by-file, so this file's complete mock wins during its own
 * run): the ImageTransform + FileStorage ports via `setImageTransform` /
 * `setFileStorage`, the DB via a stateful fake `getDb`, and the transform-event
 * sink via `setTransformEventSink`. No real Postgres / Redis required.
 *
 * The fake DB models a single files row + the tenant's `bytes_used` counter:
 * `db.execute(sql)` answers the handler's tenant-scoped SELECT (returns the row)
 * and `addUsed`'s `UPDATE tenant_storage_usage` (applies the signed delta);
 * `db.update(files).set().where()` mutates the row's status/transforms;
 * `db.transaction(fn)` runs inline. Table identity is irrelevant — the fake
 * ignores the drizzle table arg.
 *
 * Cases:
 *   - success            ⇒ variants put at deterministic keys, manifest written,
 *                          status 'ready', bytes_used += Σ variant bytes,
 *                          file.transformed emitted
 *   - re-run (idempotent)⇒ status reset to 'uploaded' + re-run nets a 0 quota
 *                          delta (deterministic keys overwrite)
 *   - ready row          ⇒ re-delivery no-op (no putObject, no event)
 *   - bomb metadata      ⇒ pixels > 50M → status 'failed', file.transform-failed
 *                          { reason: 'pixel_limit_exceeded' }, NO throw, NO putObject
 *   - failure isolation  ⇒ resize throws → status 'failed', file.transform-failed
 *                          emitted, handler RE-THROWS (worker captures it)
 *   - missing row        ⇒ file.transform-failed { reason: 'not_found' }, no throw
 */

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const DEFAULT_QUOTA = 1_073_741_824;

// ---- Stateful fake DB ------------------------------------------------------

interface FileRowState {
  id: string;
  owner_module: string;
  owner_record_type: string;
  storage_key: string;
  bucket: string;
  mime_type: string;
  status: string;
  transforms: any[];
}

const state: { row: FileRowState | null; bytesUsed: number } = { row: null, bytesUsed: 1000 };

/** Drizzle `sql` template interpolated params: a StringChunk has `.value` as an
 *  array (literal SQL); interpolated values are boxed Number/String/Boolean
 *  chunks → unwrap via valueOf(). */
function sqlParams(q: any): any[] {
  return (q.queryChunks ?? [])
    .filter((c: any) => !(c && Array.isArray(c.value)))
    .map((c: any) => (c && typeof c.valueOf === "function" ? c.valueOf() : c));
}

/** Concatenated literal SQL text (StringChunk values) for routing. */
function sqlText(q: any): string {
  return (q.queryChunks ?? [])
    .filter((c: any) => c && Array.isArray(c.value))
    .map((c: any) => c.value.join(""))
    .join(" ? ");
}

const fakeDb: any = {
  async execute(q: any) {
    const text = sqlText(q);
    if (text.includes("tenant_storage_usage")) {
      // addUsed — apply the signed delta (first Param).
      const delta = Number(sqlParams(q)[0] ?? 0);
      state.bytesUsed = Math.max(state.bytesUsed + delta, 0);
      return [];
    }
    // The handler's tenant-scoped file SELECT.
    return state.row ? [{ ...state.row }] : [];
  },
  update(_table: unknown) {
    return {
      set(vals: Record<string, unknown>) {
        return {
          where(_w: unknown) {
            if (state.row) Object.assign(state.row, vals);
            return Promise.resolve([]);
          },
        };
      },
    };
  },
  async transaction(fn: (tx: any) => Promise<unknown>) {
    return fn(fakeDb);
  },
};

mock.module("@baseworks/config", () => ({
  env: { DATABASE_URL: "postgres://fake", STORAGE_DEFAULT_QUOTA_BYTES: DEFAULT_QUOTA },
}));
mock.module("@baseworks/db", () => ({
  getDb: () => fakeDb,
  files: {},
  tenantStorageUsage: {},
}));

const { transformImage } = await import("../transform-image");
const { setTransformEventSink } = await import("../../lib/transform-events");
const { variantStorageKey } = await import("../../lib/build-storage-key");
const {
  fileRelationsRegistry,
  resetFileStorage,
  resetImageTransform,
  setFileStorage,
  setImageTransform,
} = await import("@baseworks/storage");

// Relation declaring two variants in two formats (webp + jpeg).
fileRelationsRegistry.register("ti-img", "avatar", {
  recordType: "ti_avatar",
  allowedMimeTypes: ["image/png"],
  maxByteSize: 5_000_000,
  generateVariants: [
    { name: "thumb", width: 50, format: "webp", quality: 80 },
    { name: "small", width: 100, format: "jpeg", quality: 70 },
  ],
});

// ---- Fakes -----------------------------------------------------------------

interface PutCall {
  bucket: string;
  key: string;
  byteSize: number;
  mimeType: string;
}

let putCalls: PutCall[] = [];
let events: Array<{ event: string; data: any }> = [];

const ORIGINAL_BYTES = new Uint8Array([1, 2, 3, 4]);

function installFakes(opts: {
  metaPixels: number;
  metaFormat?: string;
  resizeThrows?: boolean;
  variantBytes?: Record<string, number>;
}): void {
  setFileStorage({
    async getObject() {
      return ORIGINAL_BYTES;
    },
    async putObject(args: any) {
      putCalls.push({
        bucket: args.bucket,
        key: args.key,
        byteSize: args.body.byteLength,
        mimeType: args.mimeType,
      });
    },
    async stat() {
      return null;
    },
    async delete() {},
  } as any);

  setImageTransform({
    name: "fake",
    async metadata() {
      const width = Math.round(Math.sqrt(opts.metaPixels));
      return { width, height: width, format: opts.metaFormat ?? "png", pixels: opts.metaPixels };
    },
    async resize(args: any) {
      if (opts.resizeThrows) throw new Error("decode_failed");
      const bytes = opts.variantBytes?.[`${args.width}`] ?? 100;
      return {
        output: new Uint8Array(bytes),
        mimeType: `image/${args.format}`,
        width: args.width,
        height: args.height ?? args.width,
        format: args.format,
      };
    },
  } as any);
}

function seedRow(opts: { status?: string; storageKey?: string; transforms?: any[] } = {}): {
  fileId: string;
  tenantId: string;
  storageKey: string;
} {
  const fileId = crypto.randomUUID();
  const tenantId = `ti28_${crypto.randomUUID().slice(0, 12)}`;
  const storageKey = opts.storageKey ?? `${tenantId}/files/avatar/abc123.png`;
  state.row = {
    id: fileId,
    owner_module: "ti-img",
    owner_record_type: "ti_avatar",
    storage_key: storageKey,
    bucket: "files",
    mime_type: "image/png",
    status: opts.status ?? "uploaded",
    transforms: opts.transforms ?? [],
  };
  state.bytesUsed = 1000;
  return { fileId, tenantId, storageKey };
}

beforeEach(() => {
  setTransformEventSink((event, data) => events.push({ event, data }));
});

afterEach(() => {
  putCalls = [];
  events = [];
  state.row = null;
});

afterAll(() => {
  setTransformEventSink(null);
  resetImageTransform();
  resetFileStorage();
});

describe("transformImage handler", () => {
  test("success: variants put at deterministic keys, manifest + ready + quota delta", async () => {
    const { fileId, tenantId, storageKey } = seedRow();
    installFakes({ metaPixels: 10_000, variantBytes: { "50": 200, "100": 500 } });

    await transformImage({ fileId, tenantId });

    const thumbKey = variantStorageKey(storageKey, "thumb", "webp");
    const smallKey = variantStorageKey(storageKey, "small", "jpeg");
    expect(thumbKey).toBe(`${tenantId}/files/avatar/abc123/thumb.webp`);
    expect(smallKey).toBe(`${tenantId}/files/avatar/abc123/small.jpg`);
    expect(putCalls.map((p) => p.key).sort()).toEqual([smallKey, thumbKey].sort());

    expect(state.row?.status).toBe("ready");
    expect(state.row?.transforms).toHaveLength(2);
    const thumb = state.row?.transforms.find((t: any) => t.name === "thumb");
    expect(thumb.storageKey).toBe(thumbKey);
    expect(thumb.mimeType).toBe("image/webp");
    expect(thumb.byteSize).toBe(200);
    expect(thumb.width).toBe(50);

    // Quota: seeded 1000 + Σ variant bytes (200 + 500).
    expect(state.bytesUsed).toBe(1000 + 700);

    const transformed = events.find((e) => e.event === "file.transformed");
    expect(transformed).toBeDefined();
    expect(transformed?.data.variants.sort()).toEqual(["small", "thumb"]);
  });

  test("idempotent re-run nets a 0 quota delta (deterministic overwrite)", async () => {
    const { fileId, tenantId } = seedRow();
    installFakes({ metaPixels: 10_000, variantBytes: { "50": 200, "100": 500 } });

    await transformImage({ fileId, tenantId });
    expect(state.bytesUsed).toBe(1700);

    // Reset status so the handler re-processes; transforms manifest is RETAINED
    // (deterministic keys) → oldVariantBytes=700 → signed delta nets 0.
    if (state.row) {
      state.row.status = "uploaded";
      state.bytesUsed = 1700;
    }
    await transformImage({ fileId, tenantId });

    expect(state.bytesUsed).toBe(1700);
    expect(state.row?.status).toBe("ready");
    expect(state.row?.transforms).toHaveLength(2);
  });

  test("ready row is a re-delivery no-op", async () => {
    const { fileId, tenantId } = seedRow({ status: "ready" });
    installFakes({ metaPixels: 10_000 });

    await transformImage({ fileId, tenantId });

    expect(putCalls).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  test("bomb metadata: pixels > 50M → failed + structured event, NO throw / NO putObject", async () => {
    const { fileId, tenantId } = seedRow();
    installFakes({ metaPixels: 2_500_000_000 });

    await transformImage({ fileId, tenantId });

    expect(putCalls).toHaveLength(0);
    expect(state.row?.status).toBe("failed");
    const failed = events.find((e) => e.event === "file.transform-failed");
    expect(failed).toBeDefined();
    expect(failed?.data.reason).toBe("pixel_limit_exceeded");
    expect(state.bytesUsed).toBe(1000);
  });

  test("failure isolation: resize throws → failed + event + RE-THROW", async () => {
    const { fileId, tenantId } = seedRow();
    installFakes({ metaPixels: 10_000, resizeThrows: true });

    await expect(transformImage({ fileId, tenantId })).rejects.toThrow("decode_failed");

    expect(state.row?.status).toBe("failed");
    const failed = events.find((e) => e.event === "file.transform-failed");
    expect(failed).toBeDefined();
    // SECURITY: the emitted reason is a FIXED code, never the raw error message
    // (which can embed bucket + storage_key). The raw error is preserved by the
    // re-throw → captured by the worker's on("failed") ErrorTracker.
    expect(failed?.data.reason).toBe("transform_failed");
  });

  test("unsupported source format (svg) → failed + structured event, NO throw / NO putObject", async () => {
    const { fileId, tenantId } = seedRow();
    // Pixel count is under the ceiling — the SOURCE-format allow-list is what rejects.
    installFakes({ metaPixels: 10_000, metaFormat: "svg" });

    await transformImage({ fileId, tenantId });

    expect(putCalls).toHaveLength(0);
    expect(state.row?.status).toBe("failed");
    const failed = events.find((e) => e.event === "file.transform-failed");
    expect(failed).toBeDefined();
    expect(failed?.data.reason).toBe("unsupported_source_format");
    // No quota credited for a rejected source.
    expect(state.bytesUsed).toBe(1000);
  });

  test("missing row: emits not_found, no throw", async () => {
    state.row = null;
    installFakes({ metaPixels: 10_000 });

    await transformImage({ fileId: crypto.randomUUID(), tenantId: "ti28_missing" });

    const failed = events.find((e) => e.event === "file.transform-failed");
    expect(failed).toBeDefined();
    expect(failed?.data.reason).toBe("not_found");
    expect(putCalls).toHaveLength(0);
  });
});
