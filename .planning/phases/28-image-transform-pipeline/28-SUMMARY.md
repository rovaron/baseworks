# Phase 28 — Image Transform Pipeline — SUMMARY

**Milestone:** v1.4 File Storage & Uploads
**Requirements:** IMG-01, IMG-02, IMG-03
**Status:** Complete (sharp default verified on the Windows dev host AND CI/Docker-gated; imagescript fallback always-on)
**Executed from:** `28-PLAN-CONTRACT.md` (single LOCKED contract, mirroring Phases 25–27)
**Date:** 2026-06-17

---

## What was built

Async image-variant generation wired end-to-end: API `file.completed` → BullMQ
`image-transform` queue → transform worker → `files.transforms` jsonb manifest,
with `sharp` as the default `ImageTransform` adapter, `imagescript` as the
env-selectable pure-JS fallback, three layers of decompression-bomb defense, and
EXIF stripped from every variant.

### Adapters (`packages/storage`)

- **`SharpImageTransform` (default)** — fills the Phase 24 throwing scaffold.
  `resize()` builds the sharp pipeline with `limitInputPixels: 50_000_000` +
  `failOn: "warning"` on EVERY transform (bomb layer b); encodes webp/jpeg/png;
  drops ALL metadata by default (no `.withMetadata()` call → EXIF strip).
  `metadata()` reads the header with `limitInputPixels: false` so it can REPORT a
  bomb's dimensions without throwing (feeds the layer-c pre-flight).
- **`ImagescriptImageTransform` (fallback)** — pure JS, always loads under Bun.
  Probed capabilities (imagescript@1.3.1): DECODE png/jpeg/gif only (NOT webp);
  ENCODE png/jpeg/**webp** (valid RIFF/WEBP container); EXIF stripped from output
  by default. Its `metadata()` uses a dedicated pure-JS header parser
  (`lib/image-header.ts`) — it NEVER calls `Image.decode()` (which would allocate
  the full pixel buffer and OOM on the bomb fixture), so the layer-c pre-flight
  works identically under the fallback.
- **Factory** — `IMAGE_TRANSFORM_PROVIDER=sharp|imagescript` (default `sharp`)
  returns the selected adapter (Phase 24 wiring, now backed by real impls).

### imagescript WebP status

imagescript CAN **encode** webp (`encodeWEBP(q)`), so its conformance covers webp
output too — NOT faked. The one real gap is webp **decode**: imagescript throws
`Unsupported image type` on `Image.decode(webp)`. This is handled honestly in the
shared conformance via the `ImageTransformCaps.canDecodeWebp` flag — the optional
webp round-trip RE-READ is skipped for imagescript, but the decode-free EXIF
container byte-scan and the webp magic-byte assertion still run. Relations never
declare webp *sources*, so the decode gap does not affect the variant pipeline.
sharp remains the WebP-decode-capable default.

### Shared conformance suite (IMG-02)

`packages/storage/src/adapters/__tests__/image-transform-conformance.ts` —
adapter-agnostic `runImageTransformConformance(label, makeTransform, caps)`
exercising ONLY the port surface (`resize` + `metadata`). Consumed by both
per-adapter `*.test.ts` files (sharp under `describe.skipIf(!sharpLoadable)`,
imagescript unconditionally). Covers: resize + correct returned width, per-format
magic bytes, explicit RIFF…WEBP container check, metadata dims + pixel count, the
bomb pixel-count rejection, EXIF non-injection (clean baseline), and the
load-bearing EXIF-STRIP regression gate (transform of `exif-bearing.jpg` with real
GPS + camera Make/Model → all markers gone).

### BullMQ pipeline (IMG-01)

- `hooks/on-tenant-created.ts` `registerFilesHooks` adds the `file.completed`
  subscriber: gates on raster `image/*` (excludes svg) + relation declaring
  `generateVariants`, then enqueues `files:transform-image` on the
  `image-transform` queue. `createQueue` is imported DYNAMICALLY so registering
  hooks never pulls `@baseworks/queue`/`wrapQueue` into the import graph.
- `jobs/transform-image.ts` `transformImage(job.data)` — loads original bytes,
  runs the layer-c pre-flight + source-format allow-list, generates each variant
  at a DETERMINISTIC key (`variantStorageKey(originalKey, name, format)`),
  `putObject`s it, and writes the `files.transforms` manifest + flips
  `status='ready'` in one tx, applying a SIGNED variant-byte quota delta so
  retries never double-count. Trace propagation is automatic — the Phase 20
  producer wrapper injects `_otel`/`_requestId` into `job.data` on enqueue and
  `wrapProcessorWithAls` reconstructs the parent span (one trace API→enqueue→worker).
- `index.ts` registers the job with `concurrency: 2`. `apps/api/src/worker.ts`
  module list extended to `["example","billing","files"]` and binds the transform
  event sink to the registry bus (`setTransformEventSink`).

### Three-layer decompression-bomb defense (IMG-03)

- **(a)** `commands/complete-upload.ts` — any `image/*` whose AUTHORITATIVE size
  (`stat()`, never the client claim) exceeds 20 MB is rejected at `/complete`
  BEFORE it can be enqueued (`image_too_large`). Uses the resolved `effectiveMime`
  so a lie about MIME at sign-time cannot bypass the image ceiling.
- **(b)** sharp `limitInputPixels: 50_000_000` + `failOn: "warning"` on every
  `resize()` — a bomb/malformed/truncated buffer THROWS before pixel allocation.
- **(c)** worker pre-flight `metadata()` rejects `> 50_000_000` pixels with a
  STRUCTURED `file.transform-failed` event + `status='failed'`, RETURNING WITHOUT
  THROWING (no crash, no retry). The 50000×50000 fixture (225-byte PNG, IHDR
  2.5e9 px) sails past the 20 MB byte cap and is caught here.

### Extra hardening (source-format allow-list)

Beyond the contract: the worker also rejects any source whose detected raster
format is not in `{png,jpeg,webp,gif}` (`unsupported_source_format`) BEFORE handing
bytes to the adapter — closes the librsvg SSRF/external-entity surface even if a
relation mistakenly allows `image/svg+xml`. The enqueue subscriber also refuses
svg up front (defense in depth).

### EXIF strip (IMG-03 / SC#5)

sharp drops metadata by default (no `.withMetadata()`); imagescript emits no
Exif/XMP chunk. Proven by the EXIF-bearing round-trip gate: the suite first
asserts the INPUT carries real `Exif`/GPS/camera markers (so a fixture regression
can't neuter the gate), then asserts every variant output is marker-free
(including the specific `BaseworksCam`/`Phase28-Model` camera fields).

---

## Spike S-1 result — GREEN

`sharp` resizes the baseline fixture + encodes webp + reads metadata under Bun
inside `oven/bun:1` (worker base image, x64) — operator-verified BEFORE this
workflow: `SHARP_OK bytes=86 fmt=webp w=50 isWebp=true`. The default was NOT
re-litigated. The durable gate artifact
`packages/storage/src/adapters/sharp/__smoke__/bun-docker-spike.test.ts` is
committed so CI and every Docker build re-execute the proof; on a host without the
sharp prebuilt it self-skips (`describe.skipIf(!sharpLoadable)`).

---

## Local vs Docker/CI-gated

| Surface | Where it ran |
|---|---|
| imagescript conformance (pure JS) | Local — always (27 pass / 0 fail) |
| sharp conformance + smoke | Local Windows host — sharp's win32-x64 prebuilt loaded, so it RAN (NOT skipped): 18 pass / 0 fail. Also the hard gate on Docker/CI via the committed smoke test. |
| transform job handler + enqueue subscriber | Local unit (handler called directly with `job.data`) — 11 pass / 0 fail |
| live image transform (real LocalFileStorage + Postgres) | Local against Docker Postgres — `00-transform-image-live.test.ts` |
| Full files module | Local against Docker Postgres — 87 pass / 0 fail |

---

## Files touched

**New (storage):**
- `packages/storage/src/adapters/sharp/__smoke__/bun-docker-spike.test.ts`
- `packages/storage/src/adapters/sharp/image-transform.test.ts`
- `packages/storage/src/adapters/imagescript/image-transform.test.ts`
- `packages/storage/src/adapters/__tests__/image-transform-conformance.ts`
- `packages/storage/src/lib/image-header.ts` (pure-JS header parser)
- `packages/storage/__test-fixtures__/exif-bearing.jpg`

**Modified (storage):**
- `packages/storage/src/adapters/sharp/image-transform.ts` (scaffold → impl)
- `packages/storage/src/adapters/imagescript/image-transform.ts` (scaffold → impl)
- `packages/storage/src/test-support/fixtures.ts`, `__test-fixtures__/manifest.json`,
  `scripts/generate-fixtures.ts`, `packages/storage/package.json` (sharp + imagescript deps)

**New (files module):**
- `packages/modules/files/src/jobs/transform-image.ts` (+ `__tests__/transform-image.test.ts`)
- `packages/modules/files/src/lib/transform-events.ts`
- `packages/modules/files/src/hooks/__tests__/enqueue-on-completed.test.ts`
- `packages/modules/files/src/__tests__/00-transform-image-live.test.ts`

**Modified (files module + api):**
- `packages/modules/files/src/index.ts` (jobs + events entries)
- `packages/modules/files/src/hooks/on-tenant-created.ts` (file.completed enqueue subscriber)
- `packages/modules/files/src/commands/complete-upload.ts` (bomb layer a)
- `apps/api/src/worker.ts` (module list + transform-event sink bind)

---

## Adversarial review outcome — 2 blockers + 4 warnings, all addressed

**Blockers**
1. **librsvg SSRF surface** — nothing filtered the SOURCE format before the
   adapter; a relation allowing `image/svg+xml` would hand an SVG to sharp's
   librsvg (external-entity / `<image href=…>` resource load). Added the worker
   source-format allow-list (`{png,jpeg,webp,gif}`) + enqueue-time svg refusal.
2. **Import-graph break** — a static `createQueue` import pulled
   `wrapQueue`/`@baseworks/observability` into the graph, breaking hook tests that
   stub observability with a partial mock. Fixed with a DYNAMIC import deferred to
   enqueue time.

**Warnings**
1. **Event payload leak** — the catch block originally risked emitting
   `err.message`, which embeds bucket + storage_key for a LocalFileStorage ENOENT.
   Now emits ONLY a fixed reason code; the raw error is preserved via RE-THROW to
   the worker's `on("failed")` ErrorTracker (sanctioned sink).
2. **Quota double-count on retry** — a regenerating retry could inflate
   `bytes_used`. Fixed with a SIGNED delta (`newVariantBytes - oldVariantBytes`)
   in the manifest-write tx.
3. **Layer-a MIME bypass** — a >20 MB image signed under a non-image MIME could
   dodge the byte cap. Resolved by gating on the resolved `effectiveMime` from the
   magic-byte verdict, not the client-declared MIME.
4. **sharp host availability** — sharp could be unloadable on some dev hosts.
   Gated both sharp conformance and the smoke test behind `describe.skipIf` with
   the committed Docker smoke as the hard CI gate; imagescript (pure JS) always
   runs.
