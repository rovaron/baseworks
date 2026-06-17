/**
 * Phase 28 / IMG-01, IMG-02, IMG-03 — transform-image handler END-TO-END proof.
 *
 * Unlike the in-file-faked unit test (src/jobs/__tests__/transform-image.test.ts,
 * which proves the orchestration deterministically), this exercises the FULL real
 * chain: the actual sharp ImageTransform adapter + a temp-rooted LocalFileStorage
 * + live Postgres. It proves SC#3 (variants genuinely produced from real bytes,
 * putObject'd, recorded in files.transforms, status→'ready', bytes_used credited)
 * and SC#4c (the committed 50000x50000 bomb fixture → structured 'failed' + event,
 * NO process crash) against the production adapter — not a fake.
 *
 * Filename is `00-` prefixed so it sorts FIRST in the package's `bun test` run.
 * bun `mock.module` replacements leak for the rest of the process, and sibling
 * files (sign-upload.test.ts, src/jobs/__tests__/transform-image.test.ts) replace
 * `@baseworks/db` with a fake. This suite relies on the REAL `createDb`/live
 * Postgres, so it MUST import `@baseworks/db` before any of those mocks register.
 * Only @baseworks/config is mocked here (real DATABASE_URL — a real-URL mock is
 * safe to leak, matching complete-upload.test.ts).
 *
 * Gated by `describe.skipIf(!sharpLoadable)`: on a host whose sharp native binding
 * is unavailable the suite skips (the committed Docker smoke test + CI remain the
 * hard sharp gate); on this Windows host sharp loads (win32-x64 prebuilt).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const TEST_DB_URL =
  process.env.DATABASE_URL ?? "postgres://baseworks:baseworks@localhost:5432/baseworks";
const DEFAULT_QUOTA = 1_073_741_824;

// Temp storage root — LocalFileStorage reads STORAGE_LOCAL_PATH on every call.
const STORAGE_ROOT = resolve(tmpdir(), `bw-ti28live-${crypto.randomUUID().slice(0, 8)}`);
process.env.STORAGE_LOCAL_PATH = STORAGE_ROOT;
// Force the DEFAULT adapter (sharp) regardless of any ambient env.
process.env.IMAGE_TRANSFORM_PROVIDER = "sharp";

const { mock } = await import("bun:test");
mock.module("@baseworks/config", () => ({
  env: { DATABASE_URL: TEST_DB_URL, STORAGE_DEFAULT_QUOTA_BYTES: DEFAULT_QUOTA },
}));

const { transformImage } = await import("../jobs/transform-image");
const { variantStorageKey } = await import("../lib/build-storage-key");
const { setTransformEventSink } = await import("../lib/transform-events");
const { createDb, files, tenantStorageUsage } = await import("@baseworks/db");
const {
  LocalFileStorage,
  fileRelationsRegistry,
  resetFileStorage,
  resetImageTransform,
  setFileStorage,
} = await import("@baseworks/storage");
const { eq, inArray, sql } = await import("drizzle-orm");

// Committed Phase 25 fixtures (packages/storage/__test-fixtures__).
const FIXTURE_DIR = join(import.meta.dir, "..", "..", "..", "..", "storage", "__test-fixtures__");
const BASELINE = readFileSync(join(FIXTURE_DIR, "baseline-100x100.png"));
const BOMB = readFileSync(join(FIXTURE_DIR, "bomb-50000x50000.png"));
const SVG = readFileSync(join(FIXTURE_DIR, "svg-with-script.svg"));

// Is the sharp native binding loadable on this host? (mirrors the conformance gate)
let sharpLoadable = false;
try {
  const sharp = (await import("sharp")).default;
  await sharp(BASELINE).metadata();
  sharpLoadable = true;
} catch {
  sharpLoadable = false;
}

// Relation declaring two variants in two formats (webp + jpeg) — real encodes.
fileRelationsRegistry.register("ti28live", "avatar", {
  recordType: "ti28live_avatar",
  allowedMimeTypes: ["image/png"],
  maxByteSize: 10_000_000,
  generateVariants: [
    { name: "thumb", width: 50, format: "webp", quality: 80 },
    { name: "small", width: 64, format: "jpeg", quality: 70 },
  ],
});

let db: ReturnType<typeof createDb>;
const storage = new LocalFileStorage();
const createdTenantIds = new Set<string>();
const createdFileIds = new Set<string>();
let events: Array<{ event: string; data: any }> = [];

function newTenantId(tag: string): string {
  const id = `ti28live_${tag}_${crypto.randomUUID().slice(0, 12)}`;
  createdTenantIds.add(id);
  return id;
}

async function seedUsage(tenantId: string): Promise<void> {
  await db
    .insert(tenantStorageUsage)
    .values({ tenantId, bytesUsed: 0, bytesPending: 0, bytesLimit: DEFAULT_QUOTA })
    .onConflictDoUpdate({
      target: tenantStorageUsage.tenantId,
      set: { bytesUsed: 0, bytesPending: 0, bytesLimit: DEFAULT_QUOTA },
    });
}

async function seedFile(tenantId: string, key: string): Promise<string> {
  const [row] = await db
    .insert(files)
    .values({
      tenantId,
      ownerModule: "ti28live",
      ownerRecordType: "ti28live_avatar",
      ownerRecordId: "",
      storageKey: key,
      bucket: "files",
      mimeType: "image/png",
      byteSize: 218,
      status: "uploaded",
    })
    .returning({ id: files.id });
  createdFileIds.add(row.id);
  return row.id;
}

async function readFileRow(id: string) {
  const rows = (await db.execute(
    sql`SELECT id, status, transforms FROM files WHERE id = ${id}`,
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

beforeAll(async () => {
  db = createDb(TEST_DB_URL);
  await db.execute(sql`SELECT 1`);
  setFileStorage(storage);
  resetImageTransform(); // clear any leaked singleton → next get builds real sharp
  setTransformEventSink((event, data) => events.push({ event, data }));
});

afterAll(async () => {
  setTransformEventSink(null);
  if (createdFileIds.size > 0) {
    await db.delete(files).where(inArray(files.id, [...createdFileIds]));
  }
  if (createdTenantIds.size > 0) {
    await db
      .delete(tenantStorageUsage)
      .where(inArray(tenantStorageUsage.tenantId, [...createdTenantIds]));
  }
  resetFileStorage();
  resetImageTransform();
  await rm(STORAGE_ROOT, { recursive: true, force: true });
  const handle = (db as unknown as { $sql?: { end: (o?: { timeout?: number }) => Promise<void> } })
    .$sql;
  if (handle) await handle.end({ timeout: 5 });
});

describe.skipIf(!sharpLoadable)(
  "transformImage — REAL sharp + LocalFileStorage + live DB (Phase 28 / IMG-01..03)",
  () => {
    test("real baseline image ⇒ variants produced, putObject'd, manifest + ready + quota", async () => {
      events = [];
      const tenantId = newTenantId("ok");
      const key = `${tenantId}/files/avatar/${crypto.randomUUID().slice(0, 12)}.png`;
      await seedUsage(tenantId);
      await storage.putObject({ bucket: "files", key, body: BASELINE, mimeType: "image/png" });
      const fileId = await seedFile(tenantId, key);

      await transformImage({ fileId, tenantId });

      // Deterministic variant keys exist as real objects in storage.
      const thumbKey = variantStorageKey(key, "thumb", "webp");
      const smallKey = variantStorageKey(key, "small", "jpeg");
      const thumbStat = await storage.stat({ bucket: "files", key: thumbKey });
      const smallStat = await storage.stat({ bucket: "files", key: smallKey });
      expect(thumbStat).not.toBeNull();
      expect(smallStat).not.toBeNull();

      // Real bytes: webp variant is a RIFF/WEBP container, resized to 50px wide.
      const webpBytes = await storage.getObject({ bucket: "files", key: thumbKey });
      expect(webpBytes.byteLength).toBeGreaterThan(0);
      expect(Array.from(webpBytes.subarray(0, 4))).toEqual([0x52, 0x49, 0x46, 0x46]); // RIFF
      expect(Array.from(webpBytes.subarray(8, 12))).toEqual([0x57, 0x45, 0x42, 0x50]); // WEBP
      // EXIF strip (IMG-03): no Exif/XMP marker anywhere in the real variant bytes.
      const latin1 = Buffer.from(webpBytes).toString("latin1");
      expect(latin1.includes("Exif")).toBe(false);
      expect(latin1.includes("XMP ")).toBe(false);

      // Manifest recorded in files.transforms + status ready.
      const row = await readFileRow(fileId);
      expect(row?.status).toBe("ready");
      const manifest = row?.transforms as any[];
      expect(manifest).toHaveLength(2);
      const thumb = manifest.find((t) => t.name === "thumb");
      expect(thumb.storageKey).toBe(thumbKey);
      expect(thumb.mimeType).toBe("image/webp");
      expect(thumb.width).toBe(50);
      expect(thumb.byteSize).toBeGreaterThan(0);

      // Quota credited with the real variant byte sum.
      const sumBytes = manifest.reduce((a, t) => a + t.byteSize, 0);
      expect(Number((await readUsage(tenantId))?.bytesUsed)).toBe(sumBytes);

      expect(events.find((e) => e.event === "file.transformed")?.data.variants.sort()).toEqual([
        "small",
        "thumb",
      ]);
    });

    test("real 50000x50000 bomb fixture ⇒ status 'failed' + structured event, NO crash (LAYER c)", async () => {
      events = [];
      const tenantId = newTenantId("bomb");
      const key = `${tenantId}/files/avatar/${crypto.randomUUID().slice(0, 12)}.png`;
      await seedUsage(tenantId);
      await storage.putObject({ bucket: "files", key, body: BOMB, mimeType: "image/png" });
      const fileId = await seedFile(tenantId, key);

      // Pre-flight metadata() reads 2.5e9 px without decoding → structured reject.
      // RETURNS (no throw) — the worker would not crash.
      await transformImage({ fileId, tenantId });

      const row = await readFileRow(fileId);
      expect(row?.status).toBe("failed");
      expect(row?.transforms).toEqual([]); // no partial manifest

      const failed = events.find((e) => e.event === "file.transform-failed");
      expect(failed).toBeDefined();
      expect(failed?.data.reason).toBe("pixel_limit_exceeded");

      // No variant objects were written.
      const thumbKey = variantStorageKey(key, "thumb", "webp");
      expect(await storage.stat({ bucket: "files", key: thumbKey })).toBeNull();
      // Quota untouched (no bytes credited for a rejected bomb).
      expect(Number((await readUsage(tenantId))?.bytesUsed)).toBe(0);
    });

    test("real SVG source ⇒ status 'failed' + 'unsupported_source_format', NO librsvg rasterize (source allow-list)", async () => {
      // The SOURCE-format allow-list rejects a non-raster source AFTER the
      // bomb pre-flight but BEFORE resize, so sharp's librsvg never rasterizes a
      // hostile vector (the committed fixture carries an inline <script>).
      events = [];
      const tenantId = newTenantId("svg");
      const key = `${tenantId}/files/avatar/${crypto.randomUUID().slice(0, 12)}.svg`;
      await seedUsage(tenantId);
      await storage.putObject({ bucket: "files", key, body: SVG, mimeType: "image/svg+xml" });
      const fileId = await seedFile(tenantId, key);

      await transformImage({ fileId, tenantId });

      const row = await readFileRow(fileId);
      expect(row?.status).toBe("failed");
      expect(row?.transforms).toEqual([]); // no partial manifest

      const failed = events.find((e) => e.event === "file.transform-failed");
      expect(failed).toBeDefined();
      expect(failed?.data.reason).toBe("unsupported_source_format");

      const thumbKey = variantStorageKey(key, "thumb", "webp");
      expect(await storage.stat({ bucket: "files", key: thumbKey })).toBeNull();
      expect(Number((await readUsage(tenantId))?.bytesUsed)).toBe(0);
    });
  },
);
