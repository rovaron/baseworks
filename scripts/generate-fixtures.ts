#!/usr/bin/env bun
/**
 * Phase 25 / FILE-02 / FILE-03 — deterministic test-fixture generator (D-25-06, contract §5).
 *
 * Produces the committed storage test-fixture set under
 * `packages/storage/__test-fixtures__/`. Every artifact is a pure function of
 * its pixel coordinates / a static string — there is NO `Math.random` and NO
 * `Date.now()` anywhere in this file, so re-running regenerates byte-identical
 * output. `packages/storage/src/test-support/__tests__/fixtures.test.ts`
 * re-hashes the committed files against `manifest.json` to prove both
 * reproducibility AND that nobody hand-edited the binaries.
 *
 * PNGs are built by hand (no `sharp`, no image lib — the storage package stays
 * dependency-light): the 8-byte signature, an IHDR chunk, one IDAT chunk
 * (`zlib` deflate of raw scanlines, each row prefixed with filter byte 0x00),
 * and an IEND chunk. Each chunk carries a deterministic CRC-32 over
 * `type || data`. Compression level is pinned (`level: 9`) so the deflate
 * stream is stable run-to-run.
 *
 * Decompression-bomb technique (`bomb-50000x50000.png`): the IHDR DECLARES a
 * 50000×50000 image (2.5e9 pixels → ~7.5 GB of raw RGB if naively decoded), but
 * the IDAT is a minimal valid zlib stream of a single solid-black scanline. A
 * decoder that trusts IHDR and pre-allocates width×height×channels blows up,
 * while the guard under test (Phase 28 `limitInputPixels` / a pre-flight
 * `metadata()` dimension check) rejects on the declared size BEFORE decoding —
 * so the fixture stays a few hundred bytes on disk instead of ~7 MB.
 *
 * Usage: `bun scripts/generate-fixtures.ts`  (idempotent).
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

// ---------------------------------------------------------------------------
// Output location
// ---------------------------------------------------------------------------
// fileURLToPath so Windows gets "C:\\..." not "/C:/..." (matches validate-docs.ts).
const OUT_DIR = fileURLToPath(new URL("../packages/storage/__test-fixtures__/", import.meta.url));

const DEFLATE_LEVEL = 9;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// ---------------------------------------------------------------------------
// CRC-32 (PNG polynomial, reflected) — deterministic table.
// ---------------------------------------------------------------------------
const CRC_TABLE: number[] = (() => {
  const table = new Array<number>(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Wrap chunk data as `length(4 BE) || type(4) || data || crc(4 BE)`. */
function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

/** IHDR for an 8-bit truecolor (RGB, color type 2) non-interlaced image. */
function ihdr(width: number, height: number): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8; // bit depth
  data[9] = 2; // color type: truecolor RGB
  data[10] = 0; // compression
  data[11] = 0; // filter
  data[12] = 0; // interlace
  return pngChunk("IHDR", data);
}

function assemblePng(width: number, height: number, deflatedIdat: Buffer): Buffer {
  return Buffer.concat([
    PNG_SIGNATURE,
    ihdr(width, height),
    pngChunk("IDAT", deflatedIdat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Raw-scanline builders (filter byte 0x00 + RGB triples).
// ---------------------------------------------------------------------------
/** Build the full raw image (all scanlines) for small images we hold in memory. */
function buildRawRgb(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
): Buffer {
  const rowLen = 1 + width * 3;
  const raw = Buffer.alloc(rowLen * height);
  for (let y = 0; y < height; y++) {
    const base = y * rowLen;
    raw[base] = 0x00; // filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const o = base + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------
interface ManifestEntry {
  bytes: number;
  sha256: string;
  width?: number;
  height?: number;
}
const manifest: Record<string, ManifestEntry> = {};

async function emit(
  name: string,
  bytes: Buffer,
  dims?: { width: number; height: number },
): Promise<void> {
  await writeFile(`${OUT_DIR}${name}`, bytes);
  manifest[name] = {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ...(dims ?? {}),
  };
}

// ---------------------------------------------------------------------------
// Fixture definitions
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  // 1. baseline-100x100.png — every pixel a fixed solid color (220,38,38).
  const baselineRaw = buildRawRgb(100, 100, () => [220, 38, 38]);
  const baselinePng = assemblePng(100, 100, deflateSync(baselineRaw, { level: DEFLATE_LEVEL }));
  await emit("baseline-100x100.png", baselinePng, { width: 100, height: 100 });

  // 2. photo-5000x5000.png — smooth procedural gradient. A real 5000×5000 image
  //    for Phase 28 resize tests, but the gradient (no high-entropy XOR channel)
  //    compresses to <1 MB so it is cheap to commit — vs. ~34 MB if the blue
  //    channel carried `(x ^ y)` noise.
  const photoRaw = buildRawRgb(5000, 5000, (x, y) => [
    Math.floor((x * 255) / 4999),
    Math.floor((y * 255) / 4999),
    Math.floor(((x + y) * 255) / 9998),
  ]);
  const photoPng = assemblePng(5000, 5000, deflateSync(photoRaw, { level: DEFLATE_LEVEL }));
  await emit("photo-5000x5000.png", photoPng, { width: 5000, height: 5000 });

  // 3. bomb-50000x50000.png — IHDR-declared decompression bomb.
  //    A decompression-bomb FIXTURE only needs the IHDR to DECLARE a 2.5e9-pixel
  //    image: the Phase 28 guard (sharp `limitInputPixels` / a pre-flight
  //    `metadata()` check) rejects on the declared width×height BEFORE decoding
  //    the IDAT. So the IDAT is a minimal valid zlib stream of a single
  //    solid-black scanline — the file is a few hundred bytes on disk while a
  //    naive decoder that trusts IHDR and allocates width×height×3 (~7.5 GB)
  //    blows up. (Deflating all 50000 rows would honestly cost ~7 MB because
  //    zlib's 32 KB window can't back-reference a full 150 KB row.)
  const BOMB_DIM = 50000;
  const bombRow = Buffer.alloc(1 + BOMB_DIM * 3, 0); // filter 0x00 + all-zero (black) RGB
  const bombIdat = deflateSync(bombRow, { level: DEFLATE_LEVEL });
  const bombPng = assemblePng(BOMB_DIM, BOMB_DIM, bombIdat);
  await emit("bomb-50000x50000.png", bombPng, {
    width: BOMB_DIM,
    height: BOMB_DIM,
  });

  // 4. truncated.png — first 40% of baseline (valid signature+IHDR, IDAT cut).
  const truncated = baselinePng.subarray(0, Math.floor(baselinePng.length * 0.4));
  await emit("truncated.png", Buffer.from(truncated));

  // 5. svg-with-script.svg — static SVG carrying an inline <script> XSS payload.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' +
    "<script>alert('xss')</script>" +
    '<rect width="100" height="100" fill="#dc2626"/>' +
    "</svg>\n";
  await emit("svg-with-script.svg", Buffer.from(svg, "utf8"));

  // manifest.json — reproducibility oracle, keys sorted for stable diffs.
  const sortedManifest: Record<string, ManifestEntry> = {};
  for (const key of Object.keys(manifest).sort()) {
    sortedManifest[key] = manifest[key];
  }
  await writeFile(`${OUT_DIR}manifest.json`, `${JSON.stringify(sortedManifest, null, 2)}\n`);

  // Report.
  for (const [name, entry] of Object.entries(sortedManifest)) {
    console.log(`${name}\t${entry.bytes} bytes\tsha256=${entry.sha256}`);
  }
  console.log(`manifest.json written (${Object.keys(sortedManifest).length} entries)`);
}

await main();
