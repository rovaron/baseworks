# Stack Research — v1.4 File Storage & Uploads

**Domain:** File storage / signed direct uploads / image transforms / per-tenant quota / generic attachments
**Researched:** 2026-05-05
**Overall confidence:** MEDIUM (one HIGH-impact verification spike required: sharp on Bun in production Docker)

---

## Scope Note

This document covers **only the additions required for v1.4**. The Baseworks core stack (Bun, Elysia, Drizzle/postgres.js, BullMQ, better-auth, Zod, pino, Tailwind 4, shadcn, Eden Treaty) is locked and not re-evaluated here.

---

## Recommended Stack — File Storage v1.4

### Core Additions (Backend)

| Technology | Version | Purpose | Why | Bun-compat | Confidence |
|------------|---------|---------|-----|------------|------------|
| **`Bun.S3Client`** (built-in) | Bun ^1.1.44+ | Primary S3 / S3-compatible client (PUT, GET, DELETE, presign GET/PUT, list, stat, multipart) | Zero-dependency, native, ~5x faster uploads than `@aws-sdk/client-s3`. Documented endpoints for AWS S3, R2, MinIO, DigitalOcean Spaces, Supabase, GCS XML. Synchronous `presign()` (no network). Same primitive serves all 3 adapters (AWS / S3-compat / Local-via-MinIO-in-dev). | NATIVE | HIGH |
| **`@aws-sdk/s3-presigned-post`** | ^3.700+ | Generate **POST policy** presigned forms with size + content-type conditions | `Bun.S3Client.presign()` only signs PUT URLs and **does NOT support POST policy with conditions** (confirmed via [Bun issue #16667](https://github.com/oven-sh/bun/issues/16667), still open). POST policy is the canonical way to enforce server-defined `Content-Length-Range`, `Content-Type`, and key-prefix constraints on direct browser uploads. Imported server-side only — never bundled into Next.js client. | YES (server-side only, pure JS via `@smithy/*`) | HIGH |
| **`sharp`** | ^0.34.5+ (Nov 2025) | Image transforms: resize, format conversion (WebP/AVIF), variant generation for avatars + org logos | The de facto Node image library; ~5x faster than ImageMagick; built on libvips. Supports Node-API v9 → "all runtimes that provide Node-API v9 including Node.js, Deno and Bun" per official changelog. Built-in `limitInputPixels` for decompression-bomb DoS prevention (default 0x3FFF² ≈ 268M px). Always run inside the **BullMQ worker**, never inline on the request path. | YES (with verification spike — see below) | MEDIUM |
| **`file-type`** | ^19.x or ^20.x (latest as of 2026, ESM-only) | Server-side magic-byte MIME detection from buffer / stream | `Content-Type` from the browser is spoofable. After upload-success callback, the API reads the first ~4KB of the uploaded object and validates the actual signature matches what the client claimed before recording metadata. Pure JS, no native deps, "works in Deno, Bun, Cloudflare Workers" per maintainer notes. | YES (pure ESM JS) | HIGH |
| **`nanoid`** | ^5.0+ (already in stack) | URL-safe object-storage key path components (e.g. `tenants/{tenantId}/files/{nanoid21}-{slug}.{ext}`) | Already in deps. 21-char default has ~126 bits entropy → collision-safe at fork-user scale. NOT used as PK (PKs remain `gen_random_uuid()` per existing convention). | YES (pure JS) | HIGH |

### Core Additions (Frontend)

| Technology | Version | Purpose | Why | Bun-compat | Confidence |
|------------|---------|---------|-----|------------|------------|
| **`react-dropzone`** | ^14.3+ (current latest train; v15 also OK if released) | Headless drag-and-drop hook (`useDropzone`) for the `packages/ui` uploader | ~11.2 KB gzipped, hook-based, requires React ≥16.8 (works under React 19 — `useDropzone` is a plain hook). Does NOT do uploads itself — leaves HTTP layer to `@tanstack/react-query` mutations (already in stack). Matches "headless primitive + project-owned upload logic" pattern that fits shadcn's philosophy. | YES (build-time only via Vite/Next.js) | HIGH |

### What we are NOT adding to the frontend

- **Uppy / `@uppy/core`** — too heavy, opinionated UI, brings its own state management. Conflicts with our `react-query` + `react-hook-form` patterns. Uppy excels when you need provider integrations (Dropbox/Instagram/etc), which is out of scope for v1.4.
- **`@aws-sdk/client-s3`** in the customer Next.js bundle — never imported on the client. All signing happens on the Elysia API.

---

## Adapter-by-Adapter Mapping

| `FileStorage` adapter | Implementation primitive | Notes |
|------------------------|--------------------------|-------|
| **S3 (AWS)** | `Bun.S3Client` with `region` + AWS creds | Default endpoint. POST policy signed via `@aws-sdk/s3-presigned-post`. |
| **S3-compatible** (MinIO / R2 / Garage / Ceph / DO Spaces) | `Bun.S3Client` with explicit `endpoint` URL + `virtualHostedStyle: false` for path-style backends | Same code path, just config. POST policy: same `@aws-sdk/s3-presigned-post` with custom `endpoint`. **Verify per-backend** that POST policy is honored — MinIO yes, R2 has known quirks (R2 does not enforce all S3 POST policy conditions; document in operator runbook). |
| **Local (dev / self-host)** | Node FS + Elysia route serving signed URLs through the API itself (HMAC-signed `?sig=` short-lived tokens) | No `Bun.S3Client` involvement. Use a tiny custom signer (HMAC-SHA256 over `key + expiresAt`) — no extra dep. |

| `ImageTransform` adapter | Implementation primitive |
|--------------------------|--------------------------|
| **sharp** (default) | `sharp` ^0.34.5 inside the BullMQ worker; `.metadata()` first to gate on `width × height` before decode; produce 64/128/256/512 variants for avatars and org logos. |
| **fallback (if spike fails)** | `wasm-vips` (libvips compiled to WASM) — same API surface as sharp, no native bindings. Slower. Document as escape hatch, do not ship by default. |

---

## Supporting Libraries (Already in Stack — Reuse Verbatim)

| Library | Reuse for v1.4 |
|---------|----------------|
| `drizzle-orm` + `drizzle-zod` | `files`, `file_variants`, `tenant_storage_usage` tables — reuse tenant-scoped DB wrapper from v1.0 |
| `bullmq` + `wrapQueue` / `wrapProcessorWithAls` (Phase 20) | Async image-variant generation queue + reconcile-quota job. Trace propagation already wired. |
| `@tanstack/react-query` | Upload mutation, polling for variant-ready state, optimistic file-list updates |
| `react-hook-form` + `zod` | Upload form validation (file size, count, accepted MIME) on the client, mirrored on the server |
| `pino` + observability ports (Phase 17–20) | Structured logs with `{requestId, traceId, tenantId, fileId, byteSize, mimeType}`; `ErrorTracker.captureException` on transform failures |
| `@elysiajs/cors` | Already configured; will need a small additive rule for the CORS preflight against the bucket origin (boilerplate documented for fork users) |
| `nanoid` | Object-storage key segments |

---

## Drizzle Schema Pattern — `files` Table

Canonical shape, derived from common starter-kit precedents (Makerkit/SaaS Starter), adapted to Baseworks conventions (tenant_id scoping, `gen_random_uuid()` PKs, snake_case columns):

```ts
// packages/modules/files/schema.ts
import { pgTable, uuid, text, integer, bigint, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const files = pgTable(
  "files",
  {
    id:              uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId:        uuid("tenant_id").notNull(),                 // tenant isolation (existing convention)
    ownerModule:     text("owner_module").notNull(),              // e.g. 'auth', 'billing', 'invoices'
    ownerRecordId:   uuid("owner_record_id"),                     // nullable for orphan/intent uploads
    storageAdapter:  text("storage_adapter").notNull(),           // 's3' | 's3-compat' | 'local'
    storageKey:      text("storage_key").notNull(),               // tenants/{tenantId}/files/{nanoid}-{slug}.{ext}
    mimeType:        text("mime_type").notNull(),                 // verified via file-type post-upload
    declaredMime:    text("declared_mime"),                       // what the client claimed (audit)
    byteSize:        bigint("byte_size", { mode: "number" }).notNull(),  // BIGINT — INT4 overflows at ~2.1 GB total
    checksumSha256:  text("checksum_sha256"),                     // optional, from S3 ETag or computed
    visibility:      text("visibility").notNull().default("private"), // 'private' | 'public'
    status:          text("status").notNull().default("pending"), // 'pending' | 'ready' | 'failed' | 'deleted'
    metadata:        jsonb("metadata").$type<Record<string, unknown>>(),  // module-specific (image dims, page count, etc)
    uploadedById:    uuid("uploaded_by_id"),                      // user FK
    createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt:       timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    tenantOwnerIdx:  index("files_tenant_owner_idx").on(t.tenantId, t.ownerModule, t.ownerRecordId),
    storageKeyUnq:   uniqueIndex("files_storage_key_unq").on(t.storageAdapter, t.storageKey),
    tenantStatusIdx: index("files_tenant_status_idx").on(t.tenantId, t.status),
  }),
);

export const fileVariants = pgTable(
  "file_variants",
  {
    id:         uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    fileId:     uuid("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    variant:    text("variant").notNull(),               // '64' | '128' | '256' | '512' | 'original'
    storageKey: text("storage_key").notNull(),
    mimeType:   text("mime_type").notNull(),
    byteSize:   bigint("byte_size", { mode: "number" }).notNull(),
    width:      integer("width"),
    height:     integer("height"),
    createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    fileVariantUnq: uniqueIndex("file_variants_file_variant_unq").on(t.fileId, t.variant),
  }),
);

export const tenantStorageUsage = pgTable(
  "tenant_storage_usage",
  {
    tenantId:    uuid("tenant_id").primaryKey(),
    bytesUsed:   bigint("bytes_used", { mode: "number" }).notNull().default(0),
    fileCount:   integer("file_count").notNull().default(0),
    bytesQuota:  bigint("bytes_quota", { mode: "number" }),       // null = use plan default
    updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
```

---

## Image Decompression-Bomb Prevention Pattern

Even with `sharp.limitInputPixels`, defense-in-depth requires a metadata-first read:

```ts
// In the BullMQ image-transform worker
import sharp from "sharp";

const MAX_PIXELS = 50_000_000;        // 50 Mpx → ~200 MB decoded RGBA worst case
const MAX_BYTES  = 25 * 1024 * 1024;  // 25 MB on-disk before we even read

export async function generateVariants(buf: Buffer) {
  if (buf.byteLength > MAX_BYTES) throw new Error("file_too_large");

  // 1. Read header only — does NOT decode pixel data
  const meta = await sharp(buf, { limitInputPixels: MAX_PIXELS, failOnError: true }).metadata();
  if (!meta.width || !meta.height) throw new Error("unreadable_image");
  if (meta.width * meta.height > MAX_PIXELS) throw new Error("dimensions_too_large");

  // 2. Now safe to decode and resize
  return sharp(buf, { limitInputPixels: MAX_PIXELS })
    .resize(256, 256, { fit: "cover" })
    .webp({ quality: 85 })
    .toBuffer();
}
```

The `file-type` magic-byte check happens **before** sharp ever runs:

```ts
import { fileTypeFromBuffer } from "file-type";
const ft = await fileTypeFromBuffer(headBuf);   // reads first ~4KB
if (!ft || !ALLOWED_IMAGE_MIMES.has(ft.mime)) throw new Error("invalid_file_type");
```

---

## Object Storage Key Convention

```
{adapter-prefix}/tenants/{tenantId}/{ownerModule}/{ownerRecordId|orphan}/{nanoid21}-{kebab-case-original-name-truncated-64}.{ext}
```

- `tenantId` first → easy lifecycle rules per tenant + cheap S3 inventory filtering
- `nanoid21` → collision-safe, URL-safe, no need to query DB to generate
- Original filename slug → operator-friendly (logs, S3 console)
- Variants stored under `…/{nanoid21}-{slug}/v/{variantName}.{ext}` (sibling pseudo-folder)

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `Bun.S3Client` | `@aws-sdk/client-s3` ^3.700+ | If a fork target requires non-S3-API features (S3 Object Lambda, Glacier Restore, S3 Replication APIs). Penalty: ~600 KB additional `node_modules` + slower uploads. |
| `Bun.S3Client` | `aws4fetch` (~3 KB gzipped) | If you ever need to sign from an edge runtime (Cloudflare Workers, browser). For Bun server-side, no advantage over the built-in. |
| `@aws-sdk/s3-presigned-post` | Hand-rolled SigV4 POST policy | Only if bundle weight on the API server matters more than maintenance burden. AWS SigV4 is fiddly (canonical request, signed headers, scope, x-amz-credential field, base64 policy). Not worth it for a starter kit. |
| `sharp` | `wasm-vips` | If sharp's Bun-on-Docker spike fails. Same libvips API surface, ~3-5x slower, no native deps. |
| `sharp` | `imagescript` (pure JS) | Tiny, zero-dep, works everywhere — but no AVIF, basic resize quality, and ~10x slower than sharp. Fallback only if BOTH sharp AND wasm-vips are blocked. |
| `sharp` | `@cf-wasm/photon` | Cloudflare-targeted; useful in edge scenarios. Not v1.4 scope. |
| `sharp` | External services (Cloudinary / imgix / Bunny Optimizer) | Powerful but external dep + paid. The whole point of Baseworks is self-contained — fork users can swap in Cloudinary later by writing an alt adapter against the `ImageTransform` port. |
| `file-type` | `mmmagic` (libmagic native) | libmagic native bindings are a deployment headache, especially on Bun. file-type's pure-JS magic-byte detection is sufficient for the MIME types we care about (image/*, application/pdf, text/csv, etc). |
| `react-dropzone` | `@uppy/core` + `@uppy/react` | If a fork later needs Dropbox/Google-Drive/Instagram providers, multi-step encoding pipeline, or built-in resumable tus protocol. Not v1.4. |
| `react-dropzone` | Hand-rolled `<input type="file">` + drag handlers | Saves 11 KB but reinvents accessible focus management, multiple-file selection, and reject-by-type/size. Not worth it. |
| `nanoid` for keys | `uuid` v7 | UUIDv7 sortable + ~36 chars — heavier in URLs. nanoid's 21 chars is tighter and the ordering benefit doesn't matter once `tenantId` is already a path prefix. |
| `nanoid` for keys | `ulid` | Same trade-off as v7. ULID is sortable but also longer (26 chars, base32). No win here. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@aws-sdk/client-s3` as the **default** S3 client | 5-10x heavier than `Bun.S3Client`, slower under Bun per Bun's own benchmarks, more startup time, larger Docker image | `Bun.S3Client` |
| `@aws-sdk/client-s3` in the customer **Next.js bundle** | Massive client bundle bloat (~600+ KB gzipped). Direct browser→S3 PUT does NOT need the SDK — just `fetch(presignedUrl, { method: "PUT", body })` | Plain `fetch()` against the presigned URL |
| `multer` / `formidable` / `busboy` for multipart parsing on the API | We use **direct browser→S3** uploads. The API never receives the file bytes. Only metadata (key, size, content-type from the upload-success callback) flows through Elysia. | Signed POST/PUT URLs + Elysia JSON metadata route |
| `mime` / `mime-types` packages for validation | These map filename extensions to MIME, which is exactly what attackers control. Useless for security. | `file-type` (magic bytes from the actual buffer) |
| `imagemagick` / native `convert` shell-out | Slower than sharp, security-sensitive (CVEs around ImageMagick parsing untrusted images are legendary), no streaming | `sharp` |
| `tus-js-client` / resumable-upload protocols | Overkill for v1.4. S3 multipart upload (which `Bun.S3Client.write` does internally for large files) covers the resumable case. | `Bun.S3Client.write()` for large server-side uploads; for browser→S3, S3 multipart presigning if files >100MB become routine (defer) |
| `dotenv` for storage creds | Bun loads `.env` natively; existing `@t3-oss/env-core` validates them. No new env library. | Existing env validation pattern |
| Storing files **in PostgreSQL** (BYTEA / large objects) | Disk + backup + IOPS tax; the whole point of S3 is offload | Storage adapter, always |

---

## Bun-Compatibility Status (Per Library)

| Library | Bun-compat | How Verified | Notes |
|---------|------------|--------------|-------|
| `Bun.S3Client` | NATIVE — HIGH | Bun official docs; built into runtime | The reference implementation. Zero risk. |
| `@aws-sdk/s3-presigned-post` | YES — HIGH | Pure JS atop `@smithy/*`; no native bindings; widely used under Bun | Server-side only. Used purely as a SigV4 POST-policy generator — no actual HTTP traffic from this package. |
| `sharp` ^0.34.5 | YES — MEDIUM (verification spike required) | sharp officially declares Node-API v9 → "Node.js, Deno, Bun" supported (changelog Nov 2025). However, [sharp #4549](https://github.com/lovell/sharp/issues/4549), [#4317](https://github.com/lovell/sharp/issues/4317), and [#4215](https://github.com/lovell/sharp/issues/4215) document recurring breakage on **Bun + Alpine Linux musl** and **Bun postinstall optional-dependencies resolution** ([Bun #20472](https://github.com/oven-sh/bun/issues/20472)). | The Baseworks Docker images use multi-stage builds — base image choice (Debian-slim vs. Alpine) directly impacts whether sharp installs cleanly. **See Spike S-1 below.** |
| `file-type` ^19/^20 | YES — HIGH | Pure ESM JS, no native deps, maintainer explicitly lists Bun support | ESM-only since v17 — Baseworks is already ESM-everywhere, no friction. |
| `nanoid` ^5 | YES — HIGH | Already in stack since v1.0 | No change. |
| `react-dropzone` ^14.3 / ^15 | YES — HIGH | Build-time only; Vite + Next.js. React 16.8+ peer; React 19 hooks API stable | No runtime concerns; no SSR concerns (drag-drop is client-only — wrap in `"use client"` boundary in Next.js). |

---

## Verification Spikes Required Before Locking In

### Spike S-1: sharp under Bun in production Docker (BLOCKING)

**Why:** sharp's Bun support is real but historically fragile around (a) Alpine musl base images and (b) Bun's optional-dependencies resolution. Baseworks ships Docker images for `apps/api` and `apps/worker`. A regression here forces a fallback to `wasm-vips`, which changes the worker's perf profile materially.

**Steps:**
1. In a throwaway phase-prep branch, add `sharp@^0.34.5` to `apps/worker/package.json`, run `bun install`, commit lockfile.
2. Rebuild **both** Docker variants:
   - `oven/bun:1-debian` (current default)
   - `oven/bun:1-alpine` (smaller, but musl)
3. From inside each container, run a smoke test:
   ```ts
   import sharp from "sharp";
   const buf = await sharp({ create: { width: 100, height: 100, channels: 3, background: "red" }})
     .png().toBuffer();
   await sharp(buf).resize(50, 50).webp().toBuffer();
   console.log("sharp ok");
   ```
4. Repeat under `linux/arm64` build (Apple Silicon devs + Graviton hosts).
5. **Decision gate:**
   - If clean on Debian-slim x64 + arm64 → ship sharp as default; document Alpine as unsupported in `docs/runbooks/file-storage-image-transforms.md`.
   - If broken on Debian → fall back to `wasm-vips` adapter; sharp downgraded to "experimental, opt-in".

**Owner:** v1.4 phase that introduces the `ImageTransform` port (likely Phase ~25 per roadmapper).

### Spike S-2: POST policy enforcement on S3-compatible backends (NON-BLOCKING)

**Why:** AWS S3 enforces all POST policy conditions strictly. MinIO does. **Cloudflare R2 has documented quirks** — does not enforce all conditions identically, and `aws4fetch`/SDK behave slightly differently against R2.

**Steps:**
1. Generate a POST policy with `Content-Length-Range` [1, 1024] + `Content-Type` "image/png".
2. Attempt 4 uploads against AWS S3 + MinIO + R2 + Garage:
   - Valid (image/png, 500 bytes) → must succeed
   - Oversize (image/png, 2KB) → must fail with policy error
   - Wrong MIME (text/plain, 500 bytes) → must fail with policy error
   - No content-length header → must fail
3. Document per-backend result matrix in `docs/runbooks/file-storage-s3-compat-matrix.md`.
4. Where a backend is permissive, fall back to **server-side post-upload validation** (file-type magic bytes + HEAD size check) as the security gate.

**Owner:** v1.4 phase that ships the S3-compat adapter (right after S-1 closes).

### Spike S-3: file-type ESM under Bun + tree-shake (NON-BLOCKING, low risk)

**Why:** `file-type` v19+ pulls in token decoders for many formats. Verify Bun bundles only the image/PDF subset we need, and that ESM imports don't inflate the worker startup time.

**Steps:** simple `bun run` smoke test + `bun build --target=bun` size measurement. Expected: <50 KB added to worker bundle.

---

## Installation

```bash
# Backend (apps/api + apps/worker)
bun add @aws-sdk/s3-presigned-post file-type sharp

# Frontend (packages/ui consumers — apps/web + apps/admin)
bun add react-dropzone

# No new dev deps — Bun.S3Client is built in; reuses existing @t3-oss/env-core / Zod / drizzle-zod
```

Approximate weight added (production):
- Backend `node_modules`: ~50 MB (sharp prebuilt binaries dominate; ~45 MB)
- Frontend gzipped bundle: ~12 KB (react-dropzone)
- **Zero** added to Next.js client bundle for AWS SDK (kept server-side via API route or Server Action boundary)

---

## Version Compatibility Matrix

| Component | Requires | Notes |
|-----------|----------|-------|
| `Bun.S3Client.presign({ method: "POST" })` | Bun ≥ 1.1.x (basic POST presign) | Does **not** support POST policy with conditions; use `@aws-sdk/s3-presigned-post` for that |
| `@aws-sdk/s3-presigned-post` ^3.700 | `@aws-sdk/client-s3` peer or compatible signer | We import only the post-policy generator, NOT the full client. Treeshaken |
| `sharp` ^0.34.5 | Node-API v9 runtimes (Node ≥ 18.17 / 20.3 / 21+; Bun; Deno) | See spike S-1; Alpine musl is the known risk |
| `sharp` ^0.34 + Bun + Docker | `oven/bun:1-debian` or `oven/bun:1-debian-slim` recommended | Avoid `oven/bun:1-alpine` until S-1 confirms |
| `file-type` ^19/^20 | ESM-only consumers | Baseworks is ESM throughout — no concern |
| `react-dropzone` ^14.3+ | React ≥ 16.8 | Works with React 19; mark consuming components `"use client"` in Next.js |
| Image variant generation pipeline | BullMQ ≥ 5 + ioredis ≥ 5 (already locked) | Reuse `wrapQueue` + `wrapProcessorWithAls` from Phase 20 for trace propagation |

---

## Integration Notes Specific to Baseworks Patterns

### 1. Port + adapter (matches PaymentProvider, ErrorTracker, Tracer)
- `FileStorage` port: `signUploadUrl`, `signReadUrl`, `delete`, `head`, `streamGet`
- `ImageTransform` port: `metadata`, `generateVariant`
- Env-selected factory at module boot: `FILE_STORAGE_DRIVER=s3 | s3-compat | local` and `IMAGE_TRANSFORM_DRIVER=sharp | wasm-vips`
- Conformance test suite (matching the Stripe ↔ Pagar.me + Sentry ↔ GlitchTip parity pattern)

### 2. Tenant-scoped DB wrapper
- `files`, `file_variants`, `tenant_storage_usage` all auto-filtered by `tenantId` via existing `scopedDb` from v1.0
- No raw SQL; same Drizzle patterns

### 3. CQRS commands/queries
- `RequestUploadUrl` (command, returns presigned form/URL + `pending` file row)
- `ConfirmUpload` (command, validates with file-type + HEAD size + updates `tenant_storage_usage` atomically)
- `GetFileSignedReadUrl` (query)
- `DeleteFile` (command, soft-delete + enqueue physical-delete job)
- `GetTenantStorageUsage` (query, surfaces in admin + `/health/detailed`)
- `RegenerateVariants` (command, enqueue BullMQ job)

### 4. BullMQ jobs (with v1.3 trace-propagation wrappers)
- `files:generate-variants` — sharp pipeline; consumed by worker
- `files:reconcile-quota` — periodic; recomputes `tenant_storage_usage` from `files` sum (drift correction)
- `files:purge-deleted` — physical S3 delete after grace period

### 5. Observability (Phase 17–20 reuse)
- Pino mixin already injects `{requestId, traceId, tenantId}` — add `{fileId, byteSize, mimeType}` per log line via `obsContext`-friendly helpers
- `ErrorTracker.captureException` on transform failures, with `scrubPii` already covering arbitrary key shapes
- New metrics (when MetricsProvider noop is replaced): `files.uploads.total`, `files.bytes.total`, `tenant.storage.bytes_used`, `image.transform.duration_ms`

### 6. Health contributor (Phase 22 pattern)
- New `FilesModule` health contributor: `s3_reachability` (HEAD on a known canary key) + `quota_pressure` (% of any tenant over 90% of quota)

---

## Sources

- [Bun S3 documentation](https://bun.com/docs/runtime/s3) — `Bun.S3Client` API surface, presign options, S3-compatible endpoints (HIGH confidence)
- [Bun issue #16667 — S3 Presigned POST Policy Support](https://github.com/oven-sh/bun/issues/16667) — confirms native presign lacks POST policy with conditions (HIGH confidence; issue still open as of search date)
- [@aws-sdk/s3-presigned-post on npm](https://www.npmjs.com/package/@aws-sdk/s3-presigned-post) — POST policy generator API (HIGH)
- [sharp install docs](https://sharp.pixelplumbing.com/install/) — Node-API v9 → "Node.js, Deno and Bun"; prebuilt binary platform list (HIGH)
- [sharp v0.34.5 changelog (6 Nov 2025)](https://sharp.pixelplumbing.com/changelog/v0.34.5/) — current stable version (HIGH)
- [sharp issue #4549, #4317, #4215](https://github.com/lovell/sharp/issues/4549) — known Bun + Alpine + postinstall friction (MEDIUM — explains why spike S-1 is required)
- [Bun issue #20472 — fails installing correct platform binary](https://github.com/oven-sh/bun/issues/20472) — Bun's optional-dependencies edge case relevant to sharp (MEDIUM)
- [sharp Resize / metadata API + limitInputPixels](https://sharp.pixelplumbing.com/api-resize/) — DoS-prevention default 268M px, configurable (HIGH)
- [file-type on npm](https://www.npmjs.com/package/file-type) + [GitHub readme](https://github.com/sindresorhus/file-type) — ESM-only since v17, Bun-compatible, magic-byte detection (HIGH)
- [react-dropzone npm](https://www.npmjs.com/package/react-dropzone) — ~11.2 KB gzipped, hooks API, React ≥ 16.8 (HIGH)
- [Uppy vs react-dropzone npm-trends](https://npmtrends.com/react-dropzone) — react-dropzone ~3.5M weekly vs @uppy/core ~248K (MEDIUM, popularity context only)
- [aws4fetch vs aws-sdk-js-v3 (Cloudflare R2 docs)](https://developers.cloudflare.com/r2/examples/aws/aws4fetch/) — bundle-size and edge-runtime context (MEDIUM, used to dismiss alternative)
- [UUID v7 vs ULID vs nanoid 2026 comparison](https://createuuid.com/articles/uuid-alternatives) — collision-resistance context for object-storage keys (MEDIUM)

---

*Stack research for v1.4 — File Storage & Uploads*
*Researched: 2026-05-05*
*Next consumer: requirements-definition step → gsd-roadmapper agent*
