# Phase 28 — Image Transform Pipeline — VERIFICATION

**Milestone:** v1.4 · **Requirements:** IMG-01, IMG-02, IMG-03
**Date:** 2026-06-17 · **Runner:** `bun test` (Bun 1.3.14)

## Test-run evidence (commands + results)

| Command | Result |
|---|---|
| `bun test packages/storage/src/adapters/sharp` | **18 pass / 0 fail** (58 expects) — sharp prebuilt loaded on Windows host (NOT skipped) |
| `bun test packages/storage/src/adapters/imagescript` | **27 pass / 0 fail** (75 expects) |
| `bun test packages/storage/src/adapters` (all) | **77 pass / 21 skip / 0 fail** |
| `DATABASE_URL=… REDIS_URL=… bun test packages/modules/files/src/jobs packages/modules/files/src/hooks` | **11 pass / 0 fail** (40 expects) |
| `DATABASE_URL=… REDIS_URL=… bun test packages/modules/files` | **87 pass / 0 fail** (313 expects) |

---

## SC#1 — Phase-entry spike S-1 GREEN + durable gate artifact

**Evidence:**
- Spike S-1 operator-verified inside `oven/bun:1` (x64) BEFORE this workflow:
  `SHARP_OK bytes=86 fmt=webp w=50 isWebp=true` — sharp resize + webp encode +
  metadata under Bun, no native-binding error.
- Committed gate artifact: `packages/storage/src/adapters/sharp/__smoke__/bun-docker-spike.test.ts`
  → test `"resize baseline 100x100 → 50px webp + metadata under Bun"` (RIFF/WEBP
  magic + `info.width===50` + `info.format==='webp'` + metadata 100×100 png).
  Ran GREEN on the Windows host; self-skips where the sharp prebuilt is absent,
  re-runs as the hard gate in CI/Docker.

**Status:** ✅ MET.

---

## SC#2 — Env-selectable factory + shared conformance (resize / WebP / EXIF / metadata)

**Evidence:**
- Factory: `IMAGE_TRANSFORM_PROVIDER=sharp|imagescript` (default `sharp`) returns
  the selected adapter (`packages/storage/src/factory.ts`, Phase 24 wiring backed
  by real impls).
- Shared suite `runImageTransformConformance` in
  `packages/storage/src/adapters/__tests__/image-transform-conformance.ts`,
  consumed by `sharp/image-transform.test.ts` and `imagescript/image-transform.test.ts`.
  Per-adapter passing tests include:
  - `"resize produces non-empty output with correct magic + width"` (per format)
  - `"webp output has RIFF....WEBP container magic"`
  - `"metadata reads baseline dims (100x100, 10000 px)"`
  - `"transformed output carries no EXIF/XMP/GPS metadata (no injection)"`
  - `"EXIF/GPS stripped from an EXIF-bearing input"`
- imagescript webp **encode** covered honestly; webp **decode** gap handled via
  `caps.canDecodeWebp=false` (round-trip re-read skipped, byte-scan + magic still run).
  Documented in the adapter header — not faked.

**Status:** ✅ MET (sharp 18/18, imagescript 27/27).

---

## SC#3 — file.completed → BullMQ image-transform → variants in files.transforms (traced)

**Evidence:**
- Enqueue subscriber (`hooks/on-tenant-created.ts`, file `enqueue-on-completed.test.ts`):
  - `"GATE 1: non-image MIME does not enqueue"`
  - `"GATE 2: image whose relation declares no variants does not enqueue"`
  - `"image + relation with variants enqueues files:transform-image"`
  - `"missing row does not enqueue (defensive)"`
- Worker handler (`jobs/transform-image.ts`, file `transform-image.test.ts`):
  - `"success: variants put at deterministic keys, manifest + ready + quota delta"`
  - `"idempotent re-run nets a 0 quota delta (deterministic overwrite)"`
  - `"ready row is a re-delivery no-op"`
- Live end-to-end (`00-transform-image-live.test.ts`, real LocalFileStorage + Postgres):
  - `"real baseline image ⇒ variants produced, putObject'd, manifest + ready + quota"`
- Determinism: `variantStorageKey(originalKey, name, format)`; manifest +
  `status='ready'` written in one tx with a signed quota delta.
- Trace propagation: Phase 20 producer wrapper injects `_otel`/`_requestId` into
  `job.data`; `apps/api/src/worker.ts` loop reads `_requestId`; `concurrency: 2`
  declared in `index.ts`.

**Status:** ✅ MET.

---

## SC#4 — Three-layer decompression-bomb defense (proven by 50000×50000 fixture)

**Evidence:**
- **(a)** `commands/complete-upload.ts`:
  `if (effectiveMime.startsWith("image/") && authoritativeSize > 20*1024*1024) return reject("image_too_large")`
  — image/* > 20 MB rejected at `/complete` (authoritative `stat()` size).
- **(b)** `sharp/image-transform.ts` `resize()`: `sharp(buf,{limitInputPixels:50_000_000, failOn:"warning"})`
  on every transform. Conformance/worker proves bomb bytes → resize THROWS.
- **(c)** `jobs/transform-image.ts` pre-flight: `meta.pixels > 50_000_000` →
  `status='failed'` + structured `file.transform-failed`, RETURN (no throw).
  - Adapter suite: `"metadata rejects the bomb by pixel count without crashing"`
    (50000×50000, pixels === 2_500_000_000 > 50M) — passes for sharp AND imagescript.
  - Handler: `"bomb metadata: pixels > 50M → failed + structured event, NO throw / NO putObject"`
  - Live: `"real 50000x50000 bomb fixture ⇒ status 'failed' + structured event, NO crash (LAYER c)"`
- Extra: `"real SVG source ⇒ status 'failed' + 'unsupported_source_format', NO librsvg rasterize"`.

**Bomb-reject result:** the 225-byte `bomb-50000x50000.png` (IHDR 2.5e9 px) is read
by `metadata()` WITHOUT decoding, flagged > 50M, and produces a structured
`file.transform-failed` (`reason: "pixel_limit_exceeded"`) with NO putObject and NO
worker crash. ✅

**Status:** ✅ MET.

---

## SC#5 — EXIF stripped from every variant + concurrency 2 + failure isolation

**Evidence:**
- EXIF strip: conformance `"EXIF/GPS stripped from an EXIF-bearing input"` —
  input `exif-bearing.jpg` asserted to CARRY real `Exif`/GPS/`BaseworksCam`/
  `Phase28-Model` markers (gate-sanity test
  `"EXIF-bearing fixture genuinely carries EXIF/GPS/camera markers"`), every
  variant output asserted marker-free across png/jpeg/webp for both adapters.
  sharp: no `.withMetadata()`; imagescript: emits no Exif/XMP chunk.
- Concurrency: `index.ts` job `"files:transform-image"` → `concurrency: 2`.
- Failure isolation: handler `"failure isolation: resize throws → failed + event + RE-THROW"`
  — catch sets `status='failed'`, emits `file.transform-failed` (fixed reason code,
  NO err.message leak), RE-THROWs so BullMQ + worker `on("failed")` capture it; BullMQ
  isolates per-job throws → worker process never crashes. Also
  `"missing row: emits not_found, no throw"`.

**EXIF-strip result:** transforming an EXIF+GPS-bearing JPEG yields variants with
zero `Exif`/`EXIF`/`eXIf`/`XMP`/GPS/camera markers (latin1 byte-scan). ✅

**Status:** ✅ MET.

---

## Summary

| SC | Requirement | Status |
|----|-------------|--------|
| 1 | IMG-01 (spike S-1 green + smoke gate) | ✅ MET |
| 2 | IMG-02 (factory + shared conformance) | ✅ MET |
| 3 | IMG-01 (BullMQ pipeline + trace + manifest) | ✅ MET |
| 4 | IMG-03 (3-layer bomb defense) | ✅ MET |
| 5 | IMG-03 (EXIF strip + concurrency 2 + failure isolation) | ✅ MET |

**All 5 success criteria met.** sharp verified on the Windows dev host (prebuilt
loaded) AND gated for CI/Docker via the committed smoke test; imagescript fallback
runs unconditionally. No open blockers.
