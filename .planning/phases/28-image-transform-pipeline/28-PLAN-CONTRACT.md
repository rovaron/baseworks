# Phase 28 — Image Transform Pipeline — LOCKED CONTRACT

**Milestone:** v1.4 File Storage · **Requirements:** IMG-01, IMG-02, IMG-03
**Header convention for every touched file:** cite `Phase 28 / <REQ>`.
**Result convention:** `{ success: true, ... } | { error: string }` (handlers throw to fail a job).

> **SPIKE S-1 IS GREEN (pre-verified by operator).** sharp 0.35.1 resizes+webp+metadata under
> Bun in `oven/bun:1`. Output: `SHARP_OK bytes=86 fmt=webp w=50 isWebp=true`. **sharp is the
> DEFAULT — do not re-litigate.** The smoke test is still authored + committed as the durable
> CI/Docker gate artifact (SC#1).

---

## 0. Probe results (verified on the Windows dev host, Bun 1.3.14, this session)

| Capability | sharp@0.35.1 | imagescript@1.3.1 |
|---|---|---|
| resize | yes | `Image.resize(w, Image.RESIZE_AUTO)` / `fit()` |
| encode PNG | yes (`.png()`) | yes (`.encode()`) → magic `89504e47` |
| encode JPEG | yes (`.jpeg()`) | yes (`.encodeJPEG(q)`) → magic `ffd8ff` |
| **encode WebP** | **yes** (`.webp()`) → RIFF/WEBP | **YES** (`.encodeWEBP(q)`) → valid `RIFF....WEBP`, 82 bytes |
| **decode WebP (input)** | yes | **NO** — `Image.decode(webp)` throws `Unsupported image type` |
| header-only metadata | yes (`.metadata()`) | **NO** — only full `decode()` which allocates the whole pixel buffer |
| EXIF on output by default | **stripped** (unless `withMetadata()`) | **stripped** (JPEG output has no `Exif` APP1 marker) |
| bomb `metadata()` | THROWS `Input image exceeds pixel limit` unless `limitInputPixels:false` | would OOM (full decode of 2.5B px) |
| bomb dims via `metadata({limitInputPixels:false})` | reads `50000×50000` = 2.5e9 px without decoding | n/a (header parser needed) |
| bomb `resize({limitInputPixels:50M, failOn:'warning'})` | THROWS `Input image exceeds pixel limit` | n/a |

**Headline correction to the brief's hypothesis:** imagescript 1.3.1 **DOES encode WebP**. The real
gap is it **cannot DECODE WebP** and has **no header-only metadata reader**. The conformance suite +
adapter design below are built around those two real limitations, not the (false) "no WebP encode"
assumption.

---

## 1. sharp adapter — `packages/storage/src/adapters/sharp/image-transform.ts`

Pinned: **`sharp@0.35.1`** (EXACT, no caret — native-binding ABI stability across Bun/Docker; matches
the spike). Lives as a dependency of **`@baseworks/storage`** and is therefore transitively present in
the worker app.

### `resize(args)`
```
const QUALITY_DEFAULT = 80;
const fit = args.fit ?? "cover";              // maps 1:1 to sharp fit ("cover"|"contain"|"inside")
let p = sharp(Buffer.from(args.input), {
  limitInputPixels: 50_000_000,               // LAYER (b) — hard pixel ceiling on EVERY transform
  failOn: "warning",                          // LAYER (b) — reject malformed/truncated/bomb inputs
});
p = p.resize(args.width, args.height, { fit, withoutEnlargement: false });
// EXIF STRIP = do NOT call .withMetadata(); sharp drops all metadata by default (verified).
switch (args.format) {
  case "webp": p = p.webp({ quality: args.quality ?? QUALITY_DEFAULT }); mime = "image/webp"; break;
  case "jpeg": p = p.jpeg({ quality: args.quality ?? QUALITY_DEFAULT, mozjpeg: true }); mime = "image/jpeg"; break;
  case "png":  p = p.png();                                              mime = "image/png";  break;
}
const { data, info } = await p.toBuffer({ resolveWithObject: true });
return { output: new Uint8Array(data), mimeType: mime, width: info.width, height: info.height };
```
- `quality` is ignored for png (lossless) — documented.
- Return `width/height` from sharp's `info` (authoritative post-resize dims), NOT the requested values.

### `metadata(input)`
```
const m = await sharp(Buffer.from(input), { limitInputPixels: false }).metadata();
//                                          ^^^^^^^^^^^^^^^^^^^^^^^^^^ MUST disable, else sharp THROWS
//                                          on the bomb BEFORE we can read dims (verified).
const width = m.width ?? 0, height = m.height ?? 0;
return { width, height, format: m.format ?? "unknown", pixels: width * height };
```
- **Load-bearing:** `limitInputPixels:false` here is what lets the Phase-28 pre-flight (layer c) READ
  `50000×50000` and reject it with a *structured* error instead of sharp throwing an opaque native error.
  The 50M ceiling is re-enforced inside `resize` (layer b) regardless.

---

## 2. imagescript adapter — `packages/storage/src/adapters/imagescript/image-transform.ts`

Pinned: **`imagescript@1.3.1`** (EXACT). Pure-JS, always loads under Bun — the emergency fallback when
sharp's native binding is unavailable.

### `resize(args)`
```
const img = await Image.decode(Buffer.from(args.input));   // decodes PNG/JPEG/GIF input ONLY
// fit semantics:
//   "cover"  -> img.cover(w, h ?? w-derived) (center-crop fill) — imagescript: img.fit? use cover via crop
//   "contain"/"inside" -> img.contain(w, h) OR resize preserving AR
// Simplest correct mapping for the variant specs we actually emit (width + optional height):
let out = args.height ? img.resize(args.width, args.height) : img.resize(args.width, Image.RESIZE_AUTO);
let bytes, mime;
switch (args.format) {
  case "png":  bytes = await out.encode();                          mime = "image/png";  break;
  case "jpeg": bytes = await out.encodeJPEG(args.quality ?? 80);    mime = "image/jpeg"; break;
  case "webp": bytes = await out.encodeWEBP(args.quality ?? 80);    mime = "image/webp"; break;
}
return { output: new Uint8Array(bytes), mimeType: mime, width: out.width, height: out.height };
```
- WebP **encode** works → the imagescript adapter is NOT WebP-incapable on the output side.
- **Input limitation:** `Image.decode()` throws `Unsupported image type` on WebP **input**. Acceptable:
  source uploads are png/jpeg/gif (relations never declare webp *sources*); variant *outputs* are webp.

### `metadata(input)` — **lightweight header parser, NOT `Image.decode()`**
imagescript has no header-only reader and `decode()` of the bomb would OOM. The adapter ships a tiny
pure-JS header parser (`lib/image-header.ts`, see file list) that reads dims from magic bytes:
- PNG: bytes `[16..24]` of IHDR → big-endian width/height; format `"png"`.
- JPEG: scan APP/SOFn markers for `SOF0/1/2/3` → height(2B), width(2B); format `"jpeg"`.
- GIF: bytes `[6..10]` little-endian width/height; format `"gif"`.
- WebP: VP8/VP8L/VP8X chunk dims; format `"webp"`.
Returns `{ width, height, format, pixels: width*height }`. Never decodes pixels → bomb-safe (layer c
works identically under the fallback adapter). Unknown magic → throw `unsupported_image` (structured).

> The same header parser is the canonical metadata source; the sharp adapter MAY also delegate layer-c
> dimensions to it, but sharp's native `metadata({limitInputPixels:false})` is preferred for sharp.

---

## 3. Shared ImageTransform conformance suite — `packages/storage/src/adapters/__tests__/image-transform-conformance.ts`

Mirrors the Phase 25 `conformance.ts` shape: a named (non-`*.test.ts`) export
`runImageTransformConformance(label, makeTransform, caps)` imported by two thin per-adapter
`*.test.ts` files. `caps` declares format support so the WebP-decode gap is handled honestly, not faked.

```
interface TransformCaps {
  formats: ReadonlyArray<"webp"|"jpeg"|"png">;  // formats this adapter ENCODES
  canDecodeWebp: boolean;                        // imagescript=false, sharp=true
  reReadMetadata: ImageTransform;                // adapter used to RE-READ variant bytes (always sharp
}                                                //   when available; see note)
```

**Behaviors (run per declared format):**
1. `name` discriminator is a non-empty string.
2. **resize** baseline-100x100 → 50px: output is non-empty, magic bytes match the format, returned
   `width === 50`.
3. **WebP output** (only when `"webp" ∈ caps.formats`): output magic is `RIFF....WEBP`. **Both adapters
   run this** (imagescript encodes webp — verified).
4. **EXIF strip** round-trip: transform → re-read metadata via `caps.reReadMetadata` → assert NO
   `exif`, NO GPS, NO camera-model fields. For webp outputs the re-reader MUST be able to decode webp;
   since imagescript cannot, `reReadMetadata` is **always the sharp instance when sharp is loadable**;
   when sharp is NOT loadable on the host, the webp EXIF assertion for the imagescript run is SKIPPED
   (png/jpeg EXIF still asserted) and the limitation is documented. (Container inspection fallback:
   assert the webp byte stream contains no `EXIF`/`XMP ` chunk fourCC.)
5. **metadata** on baseline → `{width:100,height:100,format,pixels:10000}`.
6. **bomb pre-flight**: `metadata(bomb-50000x50000.png)` → `pixels === 2_500_000_000` (read without
   crash); the suite asserts `pixels > 50_000_000` (the policy the worker enforces).

**Gating (mirrors Phase 25 S3 gating):**
- imagescript run: **unconditional** (pure JS, always loads).
- sharp run: wrapped in `describe.skipIf(!sharpLoadable)` where `sharpLoadable` is a one-time
  `try { require/import sharp; sharp(tiny).metadata() } catch → false`. On the Windows host sharp
  loaded fine this session, so it runs locally; the committed Docker smoke test (SC#1) + CI are the
  hard gate regardless.

---

## 4. SC#1 — sharp Docker smoke test (gate artifact)

`packages/storage/src/adapters/sharp/__smoke__/bun-docker-spike.test.ts` — `bun:test`. Loads
`baseline-100x100.png`, runs `sharp(...).resize(50,50).webp().toBuffer()` + `.metadata()`, asserts
`RIFF/WEBP` magic, `bytes>0`, `width===50`. This is the durable re-runnable proof that sharp's native
binding works inside `oven/bun:1-debian-slim` (x64+arm64). Committed even though the spike is already
green so CI/Docker re-execute it on every build.

---

## 5. BullMQ job — `packages/modules/files/src/jobs/transform-image.ts`

Queue name: **`image-transform`**. Registered in the files `ModuleDefinition.jobs`:
```
jobs: { "files:transform-image": { queue: "image-transform", handler: transformImage } }
```
**Concurrency:2** — set on the worker. The shared `createWorker` defaults to concurrency 5, so the
worker loop in `apps/api/src/worker.ts` is extended to read an optional per-job
`concurrency` and pass `{ concurrency }` (see §8). `JobDefinition` gains an optional
`concurrency?: number` field in `packages/shared/src/types/module.ts`.

### Job payload (`job.data`)
`{ fileId, tenantId, _requestId?, _otel?, _tenantId?, _userId? }` — trace fields injected by
`createQueue`'s producer wrapper automatically (Phase 20 D-02); the worker loop already reads
`_requestId`, and `wrapProcessorWithAls` reconstructs the parent span from `_otel`. **No manual trace
plumbing needed on enqueue** — the active obsContext frame at `queue.add()` time is captured.

### Handler `transformImage(data)` algorithm
1. Load the files row raw (tenant-scoped, allow-listed): `SELECT id, tenant_id, owner_module,
   owner_record_type, storage_key, bucket, mime_type, byte_size, status FROM files WHERE id=$fileId
   AND tenant_id=$tenantId AND deleted_at IS NULL`. Missing → emit `file.transform-failed` + return
   (no throw — nothing to retry).
2. Idempotency / status gate: proceed only when `status ∈ {uploaded, transforming}`. If already
   `ready`, return (job re-delivery no-op).
3. Recover relation via `findRelationByRecordType(owner_module, owner_record_type)`; read
   `relation.generateVariants`. Empty/absent → flip status `uploaded → ready`, return (defensive; the
   enqueue gate should already prevent this).
4. Flip `status → 'transforming'` (conditional `WHERE status='uploaded'`; tolerate re-entry).
5. `bytes = getObject({ bucket, key: storage_key })`.
6. **LAYER (c) PRE-FLIGHT:** `meta = getImageTransform().metadata(bytes)`; if
   `meta.pixels > 50_000_000` → emit `file.transform-failed { fileId, tenantId, reason:
   'pixel_limit_exceeded', width, height }`, set `status='failed'`, **return without throwing**
   (structured rejection, no crash — this is what the 50000×50000 fixture proves).
7. For each `variant` in `generateVariants`:
   - `key = variantStorageKey(storage_key, variant.name, variant.format)` — **deterministic** (§5.1).
   - `{ output, mimeType, width, height } = getImageTransform().resize({ input: bytes, width,
     height?, format, quality })`. sharp's `limitInputPixels:50M + failOn:'warning'` (layer b) fires
     here too — a bomb that slipped past step 6 still throws.
   - `putObject({ bucket, key, body: output, mimeType })`.
   - Collect `FileTransform { name, storageKey: key, mimeType, byteSize: output.byteLength, width,
     height }`.
8. **Manifest write** (single UPDATE): set `files.transforms = <FileTransform[]>` and `status='ready'`
   for `id=$fileId AND tenant_id=$tenantId`. Overwrite (idempotent: re-run regenerates the full set
   under the same deterministic keys → same manifest).
9. Emit `file.transform-ready { fileId, tenantId, variants: names }` (optional, cheap; mirrors
   complete-upload's symmetric event).
10. **Failure isolation:** the whole body is wrapped so that any throw (decode error, putObject
    failure, single-variant failure) is caught → emit `file.transform-failed { fileId, tenantId,
    reason }`, set `status='failed'`, and **re-throw** so BullMQ records the failure + the
    worker-loop `worker.on("failed")` captures it via ErrorTracker. The worker process does NOT crash
    (BullMQ isolates per-job throws; the loop already proves this for billing/example). Per-variant
    policy: **a single variant failing fails the whole job** (atomic manifest — partial variant sets
    are not written); retries (BullMQ attempts:3) regenerate all.

### 5.1 Deterministic variant storage key
`variantStorageKey(originalKey, variantName, format)`:
```
// original: {tenant}/{module}/{kind}/{nanoid24}.png
// variant:  {tenant}/{module}/{kind}/{nanoid24}/{variantName}.{ext}
const ext = { webp:"webp", jpeg:"jpg", png:"png" }[format];
const base = originalKey.replace(/\.[^/.]+$/, "");      // strip original extension
return `${base}/${variantName}.${ext}`;
```
Deterministic from `{originalKey (≡ fileId's stored key), variant.name, format}` → re-runs overwrite,
never pile up. New helper in `packages/modules/files/src/lib/build-storage-key.ts` (single source of
key construction — header already states that invariant). **Never returned in any API response.**

### 5.2 Variant quota accounting (DECISION — see Risks)
Variant bytes ARE counted toward `tenant_storage_usage.bytes_used` via `decrementUsed`/increment.
**Phase 28 decision: count variant bytes as used** — after the manifest write, increment `bytes_used`
by `Σ FileTransform.byteSize` in the same transaction as the manifest UPDATE (new tiny helper
`addUsed(tx, tenantId, size)` mirroring `decrementUsed`). Rationale: variants are real stored objects
consuming the tenant's quota. Re-runs must NOT double-count → because keys are deterministic and the
manifest is overwritten, the worker computes the delta as `Σnew − Σold(from existing row.transforms)`
and applies that signed delta (idempotent under retry). The cascade/delete paths (Phase 27) already
only decrement the row's own `byte_size`; **a follow-up (noted as a risk) is that delete does not yet
sweep variant objects or refund their bytes** — flagged for Phase 31 cleanup.

---

## 6. Enqueue subscriber on `file.completed` — `packages/modules/files/src/hooks/on-tenant-created.ts` (`registerFilesHooks`)

Add a third subscription inside `registerFilesHooks` (runs in the API process, where
`file.completed` is emitted by complete-upload). Pattern mirrors `registerExampleHooks`:
```
let transformQueue: Queue | null = null;
function getTransformQueue(): Queue | null {
  if (!transformQueue && env.REDIS_URL) transformQueue = createQueue("image-transform", env.REDIS_URL);
  return transformQueue;
}

eventBus.on("file.completed", async (data) => {
  const { fileId, tenantId, mimeType } = data as FileCompletedEvent;
  try {
    // GATE 1: image only.
    if (!mimeType.startsWith("image/")) return;
    // GATE 2: the relation must declare generateVariants. Recover relation from the row's
    //         (owner_module, owner_record_type) — load those two columns raw, tenant-scoped.
    const row = <SELECT owner_module, owner_record_type FROM files WHERE id=$fileId AND tenant_id=$tenantId AND deleted_at IS NULL>;
    if (!row) return;
    const relation = findRelationByRecordType(row.owner_module, row.owner_record_type);
    if (!relation?.generateVariants?.length) return;
    const queue = getTransformQueue();
    if (!queue) { /* dev-without-redis log + return */ return; }
    // Trace propagation: createQueue's producer wrapper injects _otel/_requestId/_tenantId/_userId
    // from the active obsContext frame automatically. One trace spans API→enqueue→worker.
    await queue.add("files:transform-image", { fileId, tenantId });
  } catch (err) { getErrorTracker().captureException(err, { tenantId, tags:{module:"files",hook:"file.completed"} }); }
});
```
- **Best-effort:** a throw here never crashes complete-upload (emit is fire-and-forget; try/catch +
  ErrorTracker, consistent with the existing two subscribers).
- `FileCompletedEvent = { fileId, tenantId, byteSize, mimeType }` — exactly Phase 27's emit payload.

---

## 7. Three-layer decompression-bomb defense (exact locations)

| Layer | Where | Mechanism | Proof |
|---|---|---|---|
| **(a)** image/* > 20 MB rejected BEFORE sharp | `packages/modules/files/src/commands/complete-upload.ts` (step 5 region) | After the authoritative `stat`, if `mimeType.startsWith("image/") && authoritativeSize > 20*1024*1024` → `reject("image_too_large")` (HARD cleanup path; maps to 413). Sits in the API, before any enqueue → sharp never sees it. | unit: 21 MB image row → reject; `byte_size` over cap |
| **(b)** sharp pixel + warning guard on EVERY transform | `packages/storage/src/adapters/sharp/image-transform.ts` `resize()` | `sharp(input, { limitInputPixels: 50_000_000, failOn: "warning" })` on the constructor of every resize. | conformance/worker test: bomb bytes → resize THROWS (verified) |
| **(c)** pre-flight `metadata()` pixel-count check | `packages/modules/files/src/jobs/transform-image.ts` step 6 | `metadata(bytes).pixels > 50_000_000` → structured `file.transform-failed { reason:'pixel_limit_exceeded' }`, status `failed`, **no throw / no crash**. | worker test: `bomb-50000x50000.png` → preflight rejects, returns 2.5e9 px, no crash |

> Note: the >20 MB byte cap (layer a) and the 50 M pixel cap (layers b/c) are independent ceilings — a
> small-byte high-pixel bomb (the 225-byte 50000×50000 fixture) sails past (a) and is caught by (b)/(c);
> a large legit photo is caught by (a) only if it exceeds 20 MB. Relations may set a lower
> `maxByteSize` (already enforced at complete step 5) — layer (a) is the absolute image ceiling on top.

---

## 8. Worker + deps + env wiring

- **`apps/api/src/worker.ts`**: add `"files"` to `modules: ["example","billing"]` →
  `["example","billing","files"]`. Extend the job loop to honor per-job concurrency:
  `createWorker(jobDef.queue, processor, redisUrl, { concurrency: jobDef.concurrency })` (the loop
  already builds the processor + failed/completed handlers — only the 4th arg is added). With
  `jobDef.concurrency` undefined for existing jobs they keep the default 5; the image-transform job
  declares `concurrency: 2`.
- **`packages/shared/src/types/module.ts`**: `JobDefinition` gains `concurrency?: number`.
- **`packages/storage/package.json`**: add `"sharp": "0.35.1"` + `"imagescript": "1.3.1"` to
  `dependencies` (the adapters live here; worker gets them transitively). EXACT pins, no caret.
- **Env**: `IMAGE_TRANSFORM_PROVIDER` is already read by `factory.ts` (default `"sharp"`). No new env
  var required. `validateStorageEnv` may optionally assert the value ∈ {sharp,imagescript}; not
  required by any SC.
- **Docker:** base image MUST be `oven/bun:1-debian-slim` (NOT Alpine — sharp needs glibc). The
  spike + ROADMAP Phase 31 already pin this; no Dockerfile change needed if already debian-slim
  (verify in the executor step).

---

## 9. File list

**New:**
- `packages/storage/src/adapters/sharp/__smoke__/bun-docker-spike.test.ts` — SC#1 gate artifact.
- `packages/storage/src/adapters/__tests__/image-transform-conformance.ts` — shared suite (no `.test`).
- `packages/storage/src/adapters/sharp/image-transform.test.ts` — runs conformance (skipIf sharp).
- `packages/storage/src/adapters/imagescript/image-transform.test.ts` — runs conformance (always).
- `packages/storage/src/lib/image-header.ts` — pure-JS PNG/JPEG/GIF/WebP header dim parser (imagescript
  `metadata()` source; bomb-safe, no pixel decode).
- `packages/modules/files/src/jobs/transform-image.ts` — the BullMQ handler.
- `packages/modules/files/src/jobs/__tests__/transform-image.test.ts` — handler called directly with
  `job.data` (deterministic); bomb-fixture rejection; EXIF round-trip; failure isolation.
- `packages/modules/files/src/hooks/__tests__/enqueue-on-completed.test.ts` — gate tests (non-image
  skip, no-variants skip, image+variants enqueues; optional live-Redis enqueue).

**Edited (fill/extend):**
- `packages/storage/src/adapters/sharp/image-transform.ts` — fill resize+metadata.
- `packages/storage/src/adapters/imagescript/image-transform.ts` — fill resize+metadata.
- `packages/storage/package.json` — add pinned sharp + imagescript.
- `packages/shared/src/types/module.ts` — `JobDefinition.concurrency?`.
- `packages/modules/files/src/index.ts` — add `jobs: { "files:transform-image": … }`.
- `packages/modules/files/src/commands/complete-upload.ts` — LAYER (a) >20 MB image reject.
- `packages/modules/files/src/hooks/on-tenant-created.ts` — `file.completed` → enqueue subscriber.
- `packages/modules/files/src/lib/build-storage-key.ts` — `variantStorageKey` helper.
- `packages/modules/files/src/lib/quota.ts` — `addUsed` (variant byte accounting).
- `apps/api/src/worker.ts` — add `"files"` module + per-job concurrency arg.

Run `bun biome check --write` on every touched file.

---

## 10. Risks

1. **sharp on the Windows dev host** — loaded + resized + metadata fine THIS session (win32-x64
   prebuilt, sharp 0.35.1). If a teammate's host lacks the prebuilt, the conformance `describe.skipIf`
   degrades gracefully and the committed Docker smoke test + CI remain the hard gate. imagescript
   (pure JS) always runs, so the suite is never fully skipped.
2. **imagescript cannot decode WebP** — the EXIF round-trip for webp outputs must re-read via sharp
   (or fall back to webp-chunk fourCC inspection) when sharp is absent. png/jpeg EXIF is asserted
   unconditionally. Documented as the fallback's known limitation (sharp is the WebP-capable default).
3. **imagescript `metadata()` must not call `decode()`** — full decode of the 50000×50000 bomb would
   OOM the worker, defeating layer (c). Mitigated by the dedicated header parser (`lib/image-header.ts`).
   If a malformed header slips through, layer (b)/the decode throw still isolates per-job.
4. **Variant quota accounting double-count under retry** — BullMQ attempts:3 can re-run a job. The
   signed-delta approach (`Σnew − Σold from existing row.transforms`) makes re-runs idempotent, but it
   assumes the manifest UPDATE + `addUsed` happen in ONE transaction; if they diverge, `bytes_used`
   drifts. Phase 31's `quota:reconcile-tenant-usage` job is the backstop.
5. **Delete path does not sweep variant objects/bytes** — Phase 27 delete/cascade only tombstones the
   parent row + refunds its `byte_size`; variant objects + their counted bytes are orphaned until
   Phase 31 cleanup. Flagged, out of scope here.
6. **Atomic-manifest vs partial variants** — one failed variant fails the whole job (no partial
   manifest). For relations with many variants this re-does all on retry; acceptable for the starter
   (variant counts are small: 2–4).
7. **sharp `metadata({limitInputPixels:false})`** intentionally disables sharp's own guard FOR THE
   HEADER READ ONLY — the 50M policy is re-applied in app code (layer c) and the resize guard (layer b)
   never disables it. Verified sharp still reads bomb dims (2.5e9) without decoding pixels.
8. **`file.completed` enqueue does an extra raw DB read** (owner_module/recordType) per completed
   image to recover the relation — acceptable (1 indexed PK lookup); the alternative (widening the
   event payload) couples the producer to transform concerns.
