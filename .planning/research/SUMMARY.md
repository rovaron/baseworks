# Research Summary — v1.4 File Storage & Uploads

**Milestone:** v1.4 — File Storage & Uploads
**Goal:** Ship a typed `FileStorage` port with S3 + S3-compatible + Local adapters, signed direct uploads, automatic image transforms via sharp (with `imagescript`/`wasm-vips` fallback), per-tenant quota tracking, and a reusable UI uploader component.
**Synthesis date:** 2026-05-05
**Source files:** [STACK.md](./STACK.md) · [FEATURES.md](./FEATURES.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [PITFALLS.md](./PITFALLS.md)

---

## 1. TL;DR

- **What ships:** central `files` table + `tenant_storage_usage` counter; `FileStorage` port (3 adapters) and `ImageTransform` port (2 adapters) under a new `packages/storage/` workspace; `packages/modules/files/` module owning routes, CQRS, BullMQ jobs, health contributor; `<FileUpload>` headless hook + component in `packages/ui`; auth/org wiring (avatars, org logos).
- **Highest-risk item:** **Sharp under Bun in Docker.** Native bindings + Alpine musl + Bun's optionalDependencies resolution is documented-fragile. The TRANSFORM phase MUST run a smoke spike on the target Docker image before lock-in. Fallback: `imagescript` (pure JS) or `wasm-vips`.
- **Architectural keystone:** **single central `files` table** + `fileRelations` field on `ModuleDefinition`. Modules don't own files tables — they declare polymorphic relations (allowed MIMEs, max size, variant specs, `canRead`/`canWrite`/`onDelete` hooks). Registry collects them at boot, exactly like the Phase 22 `health` contributor pattern.
- **Upload contract:** **PUT presigned by default** (via `Bun.S3Client.presign()`); **POST policy opt-in** for adapters that fully support it (AWS S3 + MinIO yes, R2 quirky) via `@aws-sdk/s3-presigned-post`. `UploadDescriptor` is a discriminated union (`s3-put` | `s3-post` | `local`) so the UI uploader switches on `kind`.
- **Operator surface integrates with v1.3:** new `HealthContributor` for storage (top-N tenants by usage, quota pressure) plugs into the Phase 22 worst-of-N aggregator. New runbook + Sentry alert templates mirror the v1.3 closing rhythm.
- **What we explicitly do NOT add:** `@aws-sdk/client-s3` as primary client, Uppy, `multer`/`busboy`, browser cropping libraries.
- **Key reuse:** Phase 20 BullMQ trace-propagation wrappers, scoped DB wrapper (v1.0), CQRS bus, EventBus, `@t3-oss/env-core`, pino auto-context, vitest+jsdom + vitest-axe a11y suite (v1.2), packages/i18n (v1.1).

---

## 2. Stack Additions (delta only)

Baseworks core stack (Bun, Elysia, Drizzle, BullMQ, better-auth, Zod, pino, Tailwind 4, shadcn, Eden Treaty) is **locked**.

| Library | Version | Purpose | Bun-compat | Source |
|---|---|---|---|---|
| `Bun.S3Client` (built-in) | Bun ^1.1.44+ | Primary S3 / S3-compatible client (PUT, GET, DELETE, presign GET/PUT, list, stat, multipart) | NATIVE — HIGH | STACK §Recommended Stack |
| `@aws-sdk/s3-presigned-post` | ^3.700+ | POST policy generator (size + MIME conditions) — `Bun.S3Client.presign()` does NOT support POST policy | YES — HIGH (server-side only) | STACK §Core Additions |
| `sharp` | ^0.34.5+ | Image transforms (resize, WebP, variant generation) | YES — **MEDIUM (spike required)** | STACK + PITFALLS Pitfall 12 |
| `imagescript` (fallback) | latest | Pure-JS image fallback if sharp spike fails | YES — HIGH | STACK §Adapter Mapping |
| `file-type` | ^19.x or ^20.x (ESM-only) | Server-side magic-byte MIME detection | YES — HIGH | STACK |
| `react-dropzone` | ^14.3+ | Headless drag-drop hook for `<FileUpload>` | YES — HIGH | STACK |
| `nanoid` (already in stack) | ^5 | Unguessable storage-key segments | reuse | PITFALLS Pitfall 1 |

**Explicitly NOT added:** `@aws-sdk/client-s3` as default S3 client (Bun.S3Client is native, ~5x faster); hand-rolled SigV4 POST policy; Uppy (too heavy/opinionated); `multer`/`formidable`/`busboy` (direct-to-S3 uploads, API never receives bytes); `mime`/`mime-types` (extension-based, useless for security); `imagemagick` shell-out (CVE-prone); `tus-js-client` (overkill for v1.4).

---

## 3. Feature Catalog (table stakes vs differentiators vs anti-features)

| # | Category | Table Stakes (must) | Differentiator (should) | Anti-Feature (NEVER) |
|---|---|---|---|---|
| 1 | **Direct upload flow** | Server-signed PUT URL, server-side `complete` step with magic-byte verify, size cap at sign-time, CORS docs | POST policy opt-in (AWS+MinIO), optimistic `fileId` allocation in `pending` state | Server-proxied uploads, long-lived (>1h) URLs, trusting browser `Content-Type` |
| 2 | **Signed read URLs** | Per-request mint, tenant+owner authorization, short TTL (5–15 min), per-request memoization | Batched URL minting, `Content-Disposition` override, range-request, audit-trail logging | Public buckets by default, 24h+ cached client URLs, raw S3 URLs in API responses |
| 3 | **Image transforms** | Async via BullMQ worker, avatar variants (64/128/256/512 webp), org logo variants (64/256/640), strip EXIF, deterministic variant keys | Sync fast-path for <1MB images, AVIF output, idempotent jobs | Sync transforms on API thread, transform-on-read, browser-side resize replacing original, in-app crop UI |
| 4 | **Per-tenant quota** | `tenant_storage_usage` counter, atomic increment in commit txn, sign-time check, default quota env var, `/health/detailed` exposure | Nightly reconciliation job, quota grace period, Sentry 90/100% alerts | `SUM(size)` per check, Redis-only counter, report-only no enforcement |
| 5 | **Module file-ownership** | Central `files` table, module declares `fileRelations` in descriptor, soft-delete + sweep, declarative `onDelete: 'cascade' \| 'orphan'` | `attachFile()` typed helper, `file.committed`/`file.deleted` events on EventBus | Per-module files tables, BYTEA blobs, FK constraints across modules |
| 6 | **Identity asset wiring** | Avatar upload UI (web+admin), variants populated on `file.committed`, default `<AvatarFallback>` initials, org logo upload, `avatar_url` denormalized accessor, replacement deletes old | DiceBear/identicon defaults, content-hash immutable URLs for org logos behind CDN | base64 in user row, JIT URL signing on every render |
| 7 | **Generic tenant-attachment** | Two-step `signUpload` + `commitUpload`, `attachFile()` helper for server-generated files, `getFilesForRecord` query, module-defined `kind` discriminator | Eden Treaty type narrowing per `(ownerModule, kind)`, bulk attach | Per-module sign endpoints, attach-by-URL hotlinks |
| 8 | **UI uploader** | `<FileUploader>` with drag-drop + input fallback, XHR upload progress, per-file error states, image preview, single+multi mode, cancel/retry, i18n + a11y | Paste-from-clipboard, client-side resize, quota-aware live progress, MIME-restricted picker | In-browser cropping/filters/rotation, WebRTC camera, sparklines/ETAs |
| 9 | **Anti-features (defer/never)** | — | — | Image cropping UI, video transcoding, CSV imports, multi-region replication, file-access audit log, virus scanning, public CDN bucket, browser SHA-256, HEIC conversion |

See FEATURES.md for per-category dependency graph and full prioritization matrix.

---

## 4. Architecture Keystones

- **Ports live in `packages/storage/`** (NEW workspace). Mirrors `packages/observability/` precedent. Two ports: `FileStorage` (signUpload, signRead, stat, delete, getObject, putObject) and `ImageTransform` (resize, metadata). Adapters under `packages/storage/src/adapters/{local,s3,s3compat,sharp,imagescript}/`.
- **Module lives in `packages/modules/files/`** (NEW first-party module). Owns `/api/files/*` routes, CQRS commands (`sign-upload`, `complete-upload`, `delete-file`), queries (`get-signed-read-url`, `list-files-for-record`), BullMQ jobs (`image-transform`, `cleanup-pending`), health contributor.
- **Schema:** single central `files` table (`id, tenantId, ownerModule, ownerRecordType, ownerRecordId, storageKey, bucket, mimeType, byteSize bigint, checksum, transforms jsonb, status, uploadedByUserId, ...`) + `tenant_storage_usage` (`tenantId PK, bytesUsed, bytesLimit`). Schema lives in `packages/db/src/schema/storage.ts`. `bigint mode "number"` safe to ~9 PB.
- **`fileRelations` extends `ModuleDefinition`** in `packages/shared/src/types/module.ts`: `fileRelations?: Record<string, FileRelation>` where `FileRelation = { recordType, allowedMimeTypes, maxByteSize, generateVariants?, onDelete?, canRead?, canWrite? }`. Registry collects them at boot (analogous to Phase 22 health-contributor block at `apps/api/src/core/registry.ts:101-103`). `fileRelationsRegistry` singleton in `@baseworks/module-files`.
- **Upload signing flow:** `POST /api/files/sign-upload` → CQRS `sign-upload` → validate input → look up relation → `canWrite` hook → atomic quota check (`SELECT ... FOR UPDATE` on `tenant_storage_usage`) → generate `storage_key` → `getFileStorage().signUpload()` → INSERT `files` row `status='pending'` → return `{ fileId, signedUpload }`. Browser PUT/POST direct to S3. `POST /api/files/:fileId/complete` → stat verify (authoritative `byteSize`!) → magic-byte MIME check → atomic `UPDATE files.status='uploaded'` + `bytes_used += $1` → optional `enqueue('image-transform', {fileId})` → emit `file.uploaded`.
- **Polymorphic association:** modules NEVER import each other for file logic. They declare `fileRelations`; the `files` module consults the registry. Cascade-on-delete uses `TypedEventBus` (e.g., `auth.user-deleted`), not better-auth `databaseHooks` (brittle for `organization`).

See ARCHITECTURE §11 for new-vs-modified file inventory and §12 for the 8-phase build order.

---

## 5. Top 10 Pitfalls (Watch Out For)

Distilled from PITFALLS.md (22 total). Ordered by severity / unfixability cost.

| # | Pitfall | Prevention | Phase |
|---|---|---|---|
| 1 | **Cross-tenant authorization bypass on file read** (Pitfall 5) — Direct `db.select().from(files)` bypasses scopedDb; tenant prefix in `storage_key` is informational only. | Port-only access (`fileStorage.getById(ctx, id)` uses scopedDb internally); Biome GritQL ban on direct `files` table access; cross-tenant test returns 404. | PORT + TEST |
| 2 | **Trusting client-reported `byte_size` for quota math** (Pitfall 4) — client lies → quota drift → unbounded storage. | `/complete` MUST `HeadObject` and use the *authoritative* size from S3 stat, never the client's claim. | SIGN-API + QUOTA |
| 3 | **Sharp + Bun native-binding fragility** (Pitfall 12) — Alpine musl, optionalDependencies quirks. | Phase-entry smoke test on target Docker image (debian-slim x64 + arm64); fallback `ImageTransform` adapter (`imagescript`) wired and selectable via env. | TRANSFORM |
| 4 | **Predictable storage keys leak content existence** (Pitfall 1) — `tenants/{slug}/avatars/{userId}.jpg` enumerable. | Mandatory unguessable `nanoid(24)` segment; `buildStorageKey()` is the only constructor; no human-meaningful inputs. | PORT |
| 5 | **Image-decompression bombs OOM the worker** (Pitfall 9) — 10KB PNG → 10GB decoded. | Pre-flight `metadata()` check with explicit pixel cap; sharp's `limitInputPixels: 50_000_000`; `failOn: "warning"`; dedicated transform Worker `concurrency: 2` + memory ceiling; refuse `image/*` >20MB before sharp. | TRANSFORM + OPS |
| 6 | **MIME-type spoofing via client `Content-Type`** (Pitfall 10) — `payload.exe` as `image/jpeg`; SVG with `<script>` → stored XSS. | `file-type` magic-byte detection on first 4KB at `/complete`; mismatch → DELETE object; default `Content-Disposition: attachment`; `X-Content-Type-Options: nosniff`; reject SVG in image kinds. | SIGN-API |
| 7 | **Concurrent quota race** (Pitfall 6) — read-modify-write across requests, both pass at 95MB used / 100MB quota. | Option A (default): atomic `bytes_pending` UPSERT at sign-time with `WHERE (used+pending+size) <= quota`; decrement on `/complete` failure or 1h timeout. Load test gate: 50 concurrent near-quota uploads. | QUOTA |
| 8 | **Local adapter — missing volume + no real signing** (Pitfall 14) — files vanish on restart; "signed" URLs are guessable IDs. | `UploadDescriptor` discriminated union; HMAC-signed `{fileId, expiresAt, op}` tokens; named volume mandatory in compose; **boot-time refusal** if `STORAGE_ADAPTER=local && NODE_ENV=production`. | ADAPTER-LOCAL |
| 9 | **CORS misconfiguration blocks browser uploads** (Pitfall 11) — wildcard origin in prod, missing `ETag` in `ExposeHeaders`, missing `x-amz-checksum-sha256` in `AllowedHeaders`. | Per-backend templates (`docs/file-storage/cors/{aws-s3,r2,minio,garage}.json`); `bun run validate-cors` script asserts no wildcard, ETag exposed, methods present. | OPS + ADAPTER-S3 |
| 10 | **No bucket lifecycle = unbounded cost growth** (Pitfall 18) — abandoned multipart, `pending` files never completed, soft-deleted objects never hard-deleted. | Three layers: bucket lifecycle (AbortIncompleteMultipartUpload 7d, tmp/ 1d), `cleanup:reap-orphan-files` daily job, `cleanup:reap-soft-deleted` weekly job. Surface counts in `/health/detailed`. | CLEANUP |

See PITFALLS §Pitfall-to-Phase Mapping for full 22-pitfall coverage and §"Looks Done But Isn't" for the verification checklist.

---

## 6. Open Research Spikes Required

| Spike | Severity | Owner Phase |
|---|---|---|
| **S-1: Sharp under Bun + Docker base image** — Smoke test sharp on `oven/bun:1-debian` x64 + arm64 (and Alpine for documentation). Decision gate: clean → ship sharp; broken → `imagescript`/`wasm-vips` fallback as default. | **BLOCKING** for TRANSFORM | First deliverable of TRANSFORM (Phase 28) |
| **S-2: POST policy enforcement matrix per S3-compat backend** — AWS S3 strict, MinIO strict, R2 quirky, Garage version-dependent. Generate POST policy with `content-length-range` + MIME, attempt valid/oversize/wrong-MIME against all 4. Document matrix; fall back to server-side validation where backend is permissive. | NON-BLOCKING (PUT covers fallback) | ADAPTER-S3 (Phase 25) |
| **S-3: `aws-sdk-client-mock` Bun compatibility** — Historical Bun-runtime quirks. If shaky, MinIO-in-CI as primary harness + thin custom S3Client double for unit tests. | NON-BLOCKING (MinIO covers it) | TEST infrastructure phase |

---

## 7. Roadmap Implications (for gsd-roadmapper)

**Suggested phase decomposition: 8 phases (Phases 24–31).**

| # | Phase | Scope | Why this order | Risk |
|---|---|---|---|---|
| 24 | **Foundation: Port + Schema** | `packages/storage/` ports + types + factory skeletons (Noop adapters), `files` + `tenant_storage_usage` schema + migration `0002_v14_file_storage.sql`, env additions, extend `ModuleDefinition.fileRelations`, registry boot integration, scopedDb enforcement + Biome GritQL ban on direct `files` access. | Schema + port + scoping rules are foundational; expensive to retrofit. Pitfalls 1, 5, 7, 13, 20, 21. | LOW |
| 25 | **TEST infrastructure + Adapters: Local + S3 + S3-compat** | MinIO-in-CI service container, sharp fixture set (100×100 baseline, 5000×5000 photo, 50000×50000 bomb, truncated, SVG-with-script), adapter conformance suite (mirrors PaymentProvider Stripe↔Pagar.me parity from v1.1), all 3 adapters, `forcePathStyle` presets, **CORS validate-script** + per-backend templates. Spike S-2 runs here. | Conformance suite drives the adapters, not the other way around. | MEDIUM |
| 26 | **Files Module Skeleton + Sign-Upload + Quota** | Module shell, `sign-upload` command + relations registry + atomic quota check (`bytes_pending` pattern), `tenant_storage_usage` UPSERT + tenant-create hook, add to `moduleImportMap`. Endpoint live end-to-end with one mock relation. Load-test gate: 50 concurrent near-quota uploads. | First end-to-end signing flow; concentrates security review. Pitfalls 2, 3, 4, 6, 7, 10. | HIGH (security surface) |
| 27 | **Complete-Upload + Read Flow + Delete** | `complete-upload` (HEAD stat verify + magic-byte check + quota increment + emit event), `get-signed-read-url`, `list-files-for-record`, `delete-file` (soft-delete pattern), authorizer registry. Closes synchronous loop. | Pitfalls 4, 10, 21. | MEDIUM |
| 28 | **Image Transform Pipeline (sharp spike + fallback)** | **Spike S-1 first.** Then `ImageTransform` port + Sharp adapter + `imagescript` fallback, `image-transform` BullMQ job (re-using Phase 20 wrapper for trace propagation), `transforms` jsonb manifest writes, `transform_status` field, decompression-bomb caps. | Highest research-flag risk. Pitfalls 9, 12, 16. | **HIGHEST** |
| 29 | **Auth + Org Identity Wiring** | Auth module declares `fileRelations: { user, organization }`, `get-profile` resolves `avatarUrl` from latest user-file, customer-app avatar/logo upload pages. First real consumer; proves cross-module decoupling. | Validates polymorphic association. | LOW-MED |
| 30 | **UI Uploader in `packages/ui`** | `<FileUpload>` + `useFileUpload` hook, drag-drop with `dragover preventDefault` on body, XHR with File body (no `arrayBuffer()`), upload progress, image preview via `URL.createObjectURL`, beforeunload nav-block, `UploadDescriptor` `kind` switch, processing-state for variants, vitest+jsdom + vitest-axe a11y suite, i18n strings (en + pt-BR). Wire admin tenant-files browser. | Backend stable; hook design depends on full sign→PUT→complete→variants flow being settled. | **LOWEST** |
| 31 | **Cleanup + Reconciliation + Operator Surface** | `cleanup-pending` hourly, `cleanup:reap-orphan-files` daily, `cleanup:reap-soft-deleted` weekly, `quota:reconcile-tenant-usage` daily, `HealthContributor` registered with worst-of-N rollup, runbook (`docs/runbooks/file-storage-*`), Sentry alert templates, integration docs, Docker base-image pin doc, CDN/Cache-Control guidance. | Mirrors v1.3's Phase 23 closing rhythm. | LOW |

**Optional 31.5:** Virus-scanning hook port + Noop adapter (decimal-phase precedent from Phase 20.1). Out of scope per PROJECT.md but the port shape can be reserved.

**Dependency rules:**
- 24 → 25 → 26 strictly serial.
- 27 depends on 26.
- 28 can branch off 26 in parallel with 27 if a second contributor available; Phase 25 conformance suite must be green first.
- 29 depends on 27 + 28.
- 30 depends on 27 (sign+complete contract stable); benefits from 28 (processing-state UX).
- 31 depends on everything; pure ops/docs polish.

**Parallel-execution opportunities:** 27 ∥ 28 (with conformance suite green); within 28, sharp spike runs first, then adapter + job in parallel.

---

## 8. Open Questions for Requirements

- **Default tenant quota:** 5 GiB placeholder. Confirm vs. per-plan via better-auth org metadata?
- **Bucket-per-tenant vs prefix-per-tenant:** Default is **prefix-per-tenant** for IAM-policy friendliness. Confirm fork users won't need bucket-per-tenant (compliance/data-residency)?
- **Local adapter URL serving in dev:** HMAC-signed `?sig=` short-lived tokens via Elysia route `/api/files/local/{token}` — confirm shape, especially for `Content-Disposition` override.
- **`files.kind` discriminator:** registry-validated (each module declares allowed kinds in `fileRelations`) vs free-form text? Recommendation: registry-validated.
- **Virus-scanning hook port:** Ship the *port shape* in v1.4 (Noop adapter only), or defer entirely to v1.5+? PROJECT.md says deferred; ARCHITECTURE.md flags as "31.5 optional."
- **Default `Content-Disposition` policy:** `attachment` for everything except whitelisted inline-safe MIMEs (jpeg/png/webp/gif)? Confirm.
- **Org logo SVG support:** FEATURES Cat 6 lists `image/svg+xml` for org logos. Pitfall 10 strongly recommends NOT accepting SVG without sanitizer. Decision needed.
- **POST policy default vs PUT default:** Architecture and Stack land on **PUT default + POST policy opt-in**. Confirm; some operators may want POST default for stronger size enforcement.
- **Reconciliation cadence:** daily vs on-demand? Recommend daily.
- **Multi-file upload UX:** opt-in via prop (`multi`)? Default count limit? Confirm.

---

## 9. What v1.4 Will NOT Ship

**From PROJECT.md (explicit defers):** in-browser image cropping/editing, video transcoding, bulk CSV/Excel imports, multi-region replication, file-access audit log, virus scanning.

**Additional deferrals from research:** POST policy as default (PUT covers it; POST is opt-in); S3 multipart upload for large (>100MB) files; synchronous fast-path transforms for tiny (<1MB) images; AVIF output (webp + jpeg only); per-module quota sub-buckets; quota grace periods; pre-upload client-side resize; paste-from-clipboard; HEIC → JPEG conversion (libheif system dep); browser-side SHA-256 hashing; animated avatars (multi-frame WebP); public CDN bucket / hotlinking; per-spec transform versioning; Eden Treaty type narrowing per `(ownerModule, kind)`; resumable uploads (`tus-js-client` / multipart resume); WebRTC camera capture; DiceBear/identicon default avatars.

---

## 10. Cross-references

| Synthesis section | Source file | Key passages |
|---|---|---|
| §1 TL;DR | All 4 | All summary sections |
| §2 Stack additions | STACK.md | §Recommended Stack, §What we are NOT adding, §What NOT to Use |
| §3 Feature catalog | FEATURES.md | All 9 categories + §Feature Prioritization Matrix |
| §4 Architecture keystones | ARCHITECTURE.md | §1 Decision Summary, §2 Schema, §3 Ports, §4 Module Integration, §10 Polymorphic Association |
| §5 Top 10 pitfalls | PITFALLS.md | Pitfalls 1, 4, 5, 6, 9, 10, 11, 12, 14, 18 |
| §6 Spikes | STACK §Verification Spikes, PITFALLS §Pitfall 12, 22 | S-1 to S-3 |
| §7 Roadmap implications | ARCHITECTURE §12, PITFALLS §Phase Ordering Implications, FEATURES §Suggested phase ordering | All three converge on 8-phase 24–31 decomposition |
| §8 Open questions | All 4 | Quota defaults; SVG (FEATURES Cat 6 vs PITFALLS 10); virus-scanning (ARCHITECTURE §12 31.5); local adapter (PITFALLS 14) |
| §9 Defer list | PROJECT.md, FEATURES §Category 9, STACK §Alternatives | Out-of-scope + deferral rationales |

---

## Confidence Assessment

| Area | Confidence | Notes |
|---|---|---|
| **Stack** | MEDIUM-HIGH | `Bun.S3Client` HIGH; `@aws-sdk/s3-presigned-post` HIGH; `sharp` MEDIUM (spike S-1 required); `file-type` HIGH; `react-dropzone` HIGH. One blocking spike. |
| **Features** | MEDIUM-HIGH | High on S3 patterns, sharp, MIME validation, quota; medium on uploader UI shape and reconciliation cadence. Aligned with established Baseworks patterns. |
| **Architecture** | HIGH | All integration points verified against live code. New patterns added are minimal. |
| **Pitfalls** | HIGH (security/multitenancy/ops); MEDIUM (Bun-platform-specific) | S3/sharp/multitenant pitfalls well-documented. Bun-specific items need empirical validation in S-1. |
| **Overall** | **MEDIUM-HIGH** | One blocking spike (S-1 sharp); one high-leverage security phase (26 sign-upload + 27 complete); rest is pattern-extension on top of locked v1.0–v1.3 foundations. |

---

*Synthesis for: Baseworks v1.4 — File Storage & Uploads*
*Synthesized: 2026-05-05 from 4 parallel researcher outputs*
*Next consumer: requirements-definition step → gsd-roadmapper agent*
