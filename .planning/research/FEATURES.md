# Feature Research — File Storage & Uploads (Baseworks v1.4)

**Domain:** Multitenant SaaS file storage / direct uploads / image transforms / per-tenant attachments
**Researched:** 2026-05-05
**Confidence:** MEDIUM-HIGH (high-confidence on S3 patterns, sharp/Bun, MIME validation; medium on UI shape and quota reconciliation specifics)

## Scope Note

This is a v1.4 milestone of an existing app. **Features already shipped (NOT re-researched here):** auth, tenant-scoped DB wrapper, CQRS bus, per-module BullMQ queues with W3C trace propagation, billing port/adapters, admin dashboard, Next.js customer app, pino logging with auto-injecting context, module file-ownership convention. Every new feature below assumes those primitives exist and reuses their patterns.

---

## Category 1 — Direct Upload Flow (Signed PUT/POST Policy)

The single most important UX/architecture call in this milestone. Two viable patterns; one is recommended.

### Table Stakes

| Feature | Why Expected | Complexity | Notes / Dependencies |
|---|---|---|---|
| **Server-signed presigned URL endpoint** (`POST /api/uploads/sign` returning `{ url, fields, fileId }`) | Browser cannot hold AWS keys; server signs short-lived URL bound to tenant + size + MIME. This is the entire model of "direct upload" in modern SaaS. | LOW | Reuses tenant-scoped DB. New CQRS command `signUpload` in a new `files` module. AWS SDK v3 `@aws-sdk/s3-request-presigner`. |
| **Single-file upload via `PUT` presigned URL** (default path) | Simplest, smallest header surface, works identically across S3/R2/MinIO/Garage. Browser does `fetch(url, { method: 'PUT', body: file })`. | LOW | One endpoint, one client helper. Constraint: PUT URL **cannot enforce size or content-type at policy level** — server enforces by signing only after pre-check, then verifies on commit. |
| **Server-side post-upload "commit" step** (`POST /api/uploads/commit { fileId }` — verifies object exists, reads `Content-Length` + first-bytes, records metadata, increments quota) | Without commit, you cannot trust the object actually landed, the size, or the real MIME type. Critical for quota correctness and security. | MEDIUM | New CQRS command. Calls `s3.headObject` + downloads first 64–512 bytes for magic-byte check. Idempotent on `fileId`. |
| **Magic-bytes MIME validation** via `file-type` package | Browser-supplied `Content-Type` is trivially spoofed. Must verify by reading actual bytes. Industry standard 2026. | LOW | `file-type` npm package — Bun-compatible, pure-ish JS. Reads first ~4KB. Runs in commit step. |
| **Size cap enforced at sign time** (per-tenant + per-mime defaults: 10MB images, 50MB docs, configurable) | PUT URL has no policy size enforcement, so server must (a) refuse signing if requested size exceeds limit, (b) abort + delete on commit if `headObject.ContentLength` exceeds cap. | LOW | Pure config + check in `signUpload` handler. |
| **CORS configuration boilerplate + docs** for the bucket | Browser direct-upload **will not work** without bucket CORS allowing PUT/HEAD from app origin. Fork users hit this on day one if undocumented. | LOW | Ship `docs/storage/cors.md` + a JSON snippet per provider (AWS, R2, MinIO). Validate in dev via storage adapter `selfTest()`. |
| **Tenant-prefixed object keys** (`{tenantId}/{ownerModule}/{ownerRecordId}/{fileId}.{ext}`) | Prevents cross-tenant collision; supports prefix-based IAM policies later; matches AWS SaaS Factory guidance. | LOW | Single key-builder helper in `packages/files`. |
| **Short-lived signed URLs** (default 5 min upload, configurable via env) | Limits damage of leaked URLs. AWS allows up to 7 days but bearer tokens should be minimum-lifetime. | LOW | Config via `@t3-oss/env-core`. |
| **Server-side input validation at sign time** (filename sanitization, declared-MIME allowlist per module, size cap, optional dimension cap for images) | Defense-in-depth: catch obvious bad uploads before they hit storage. Magic-byte check on commit catches the rest. | LOW | Zod schema on `signUpload` command. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| **Presigned POST policy** as opt-in alternative to PUT | POST policy enforces size/content-type/key-prefix at the bucket level — the upload is rejected by S3 itself if the file doesn't match. Eliminates the trust gap between sign and commit. | MEDIUM | Worth offering for adapters that fully support it (AWS S3 + R2 do; MinIO partial; Local can simulate). Adapter port should expose both `signPut()` and `signPost()` and let the module pick. Default to PUT for portability. |
| **Multipart upload for large files** (threshold ≥ 100MB, 8–16MB chunks) | Required for files > 5GB (single-PUT cap). Resumability for flaky networks. AWS minimum part size is 5MB, recommended 16–64MB. | HIGH | Defer to v1.4.1 unless a fork user needs it. Most starter-kit content is < 50MB. **Recommendation: ship single-PUT only in v1.4, document multipart as v1.5+ extension.** |
| **Client-side dimension/size pre-check** before requesting URL | Faster failure feedback (don't waste a sign round-trip if file is obviously oversize). | LOW | Just JS in the uploader component. |
| **Optimistic `fileId` allocation at sign-time** | Server allocates a UUID + writes `files` row in `pending` state at sign, browser uploads, commit flips to `committed`. Lets UIs render placeholders before commit. | LOW | One Drizzle insert in `signUpload`. State machine: `pending → committed → deleted`. Sweep job deletes `pending` older than 1h. |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **Server-proxied uploads** (`POST /api/upload` with multipart/form-data, server forwards to S3) | "Simpler" — no CORS, no bucket policy. | Doubles bandwidth cost. Saturates the API instance. Defeats the entire reason for object storage. Worker process gets blocked on I/O. | Direct-to-S3 PUT. Keep server out of the data path. |
| **Long-lived signed URLs (>1 hour for upload)** | "More forgiving" UX. | URL is a bearer token. Long lifetimes = larger blast radius if leaked via logs/Sentry/browser history. | 5–15 min for upload, refresh on retry. |
| **Trusting browser-supplied `Content-Type`** | "Easy filtering." | Trivially spoofed (rename `evil.html` to `image/png`). Stored XSS, SVG payloads, etc. | `file-type` magic-byte check on commit. |
| **Not enforcing size at all** | "We'll catch it in dashboard alerts." | One bad actor uploads a 100GB file, exhausts tenant quota or storage budget. | Hard cap at sign-time. Fail closed. |

### Dependencies on existing components

- Tenant-scoped DB wrapper (Phase 1, v1.0) — `signUpload` writes to `files` table tenant-scoped automatically.
- CQRS bus + module registry — `files` module registers commands like any other module.
- `@t3-oss/env-core` — `STORAGE_DRIVER`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `UPLOAD_MAX_BYTES`, `UPLOAD_URL_TTL_SECONDS`.
- pino logging + auto-injecting context — sign/commit log lines automatically carry `{tenantId, traceId, requestId}` (Phase 19/20 wiring already done).

---

## Category 2 — Signed Read URLs (Private File Access)

### Table Stakes

| Feature | Why Expected | Complexity | Notes / Dependencies |
|---|---|---|---|
| **Per-request signed GET URL** (`GET /api/files/:fileId/url`) | Files are tenant-private; cannot expose direct bucket URLs. Authorization happens once at the API; storage just trusts the signature. | LOW | New CQRS query `getFileUrl`. Calls `s3.getSignedUrl` with 5–15 min TTL. |
| **Tenant + ownership authorization on URL request** | "Only owner/tenant can mint a signed URL." Without this, any authenticated user can mint URLs for other tenants' files by guessing IDs. | LOW | tenant-scoped DB does the heavy lifting — query `files` table scoped by tenant returns 404 if file belongs to another tenant. |
| **Short TTL by default** (5–15 min for inline view; 1h for download links if needed) | Bearer tokens. Minimum useful lifetime. | LOW | Configurable via env. |
| **URL caching within request lifetime** (memoize per `(fileId, ttlBucket)` for the same request) | Avoids re-signing on every list-render of e.g. 50 file thumbnails. | LOW | Simple per-request memo in the query handler. **Do not cache across requests** — defeats per-user authorization. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| **Batched URL minting** (`POST /api/files/urls { ids: [...] }` returning `Map<fileId, url>`) | One round-trip for a gallery of 50 images vs 50 round-trips. Significant perf win in the admin dashboard. | LOW | One CQRS query, takes array. Already a common pattern in the codebase. |
| **Range-request support for video / large files** | Browser `<video>` tag does range requests (`Range: bytes=0-`). S3/R2/MinIO support it natively for signed GETs without extra config. | LOW (verify) | Mostly free — just don't break it. Adapter integration test should confirm range works through the signed URL. |
| **Signed URLs respect `Content-Disposition` override** for download links (`?response-content-disposition=attachment;filename="invoice.pdf"`) | Lets a single stored object serve as both inline view (no override) and forced download (with override). Avoids storing two copies. | LOW | S3 signing supports this query-param override out of the box. |
| **Signed URL audit trail** (log every URL mint with `{userId, fileId, tenantId, traceId}`) | Forensics if a URL leaks. Folds into Sentry/audit-log naturally. | LOW | Already free via pino auto-context. Just log in the query handler. |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **Public buckets / unsigned URLs by default** | "Avatars and logos are public anyway." | Tenant content leaks. Even avatars are arguably PII. One config flip and the whole bucket is indexed by Google. | Always private bucket; signed URLs everywhere. Public assets go to a separate CDN-cached prefix only if explicitly opted in. |
| **Long-lived (24h+) GET URLs cached client-side** | "Reduce API calls." | URL persists in browser cache, history, copy-paste. Authorization is frozen at sign time — revoking access doesn't revoke the URL. | Short TTL + transparent re-mint on use. |
| **Returning the raw S3 URL in API responses** | "Fewer round-trips." | Same as above — and now your DB has long-lived URLs in it. | Always store the storage **key**, not the URL. Mint URLs on demand. |

### Dependencies

- tenant-scoped DB ensures `getFileUrl` cannot cross-tenant.
- `files` table from Category 5 must exist.

---

## Category 3 — Image Transforms (sharp Pipeline)

### Critical Risk Item

**Sharp + Bun compatibility is unresolved as of 2026.** Confirmed in project context (PROJECT.md line 113: "Sharp under Bun is a research item — verify Bun-native compatibility; fall back to imagescript/wasm-vips if not stable") and confirmed externally:

- Sharp [issue #3779](https://github.com/lovell/sharp/issues/3779) — Bun install incompatibility documented.
- [Bun issue #4549](https://github.com/oven-sh/bun/issues/4549) — sharp install fails under bun, workarounds via `npm install --foreground-scripts`.
- Sharp 2026 docs claim Node-API v9 support including Bun, but real-world reports show install-script issues and platform-binary mismatches under Alpine.

**Mitigation:** Phase 0 of the milestone should include a Bun + sharp compatibility spike before committing the rest of Category 3. If sharp doesn't work cleanly, fallbacks (HIGH confidence each is Bun-friendly): `@cf-wasm/photon`, `wasm-vips`, `imagescript`. wasm-vips is the closest functional match (libvips bindings).

### Table Stakes

| Feature | Why Expected | Complexity | Notes / Dependencies |
|---|---|---|---|
| **Async variant generation in BullMQ worker** (commit fires `file.committed` event → `files:generate-variants` job consumes → worker reads original, writes variants, updates `files.variants` JSONB column) | Sharp is CPU-bound; doing it on the upload commit response path blocks the API. BullMQ is already wired with trace propagation (Phase 20). | MEDIUM | New per-module BullMQ queue `files:transforms`. Job carrier inherits `traceparent` automatically (Phase 20 wrapping). |
| **Auto-variants for avatars** (64, 128, 256, 512 px square, webp + jpeg fallback) | shadcn `<Avatar>` and the rest of the UI use these sizes. Storing only the original means re-rendering at every size at runtime — slow + wasteful. | MEDIUM | sharp `resize({fit: 'cover'})` + `webp({ quality: 82 })`. Also write a `.jpg` fallback for older clients (Safari < 14, etc — 2026 mostly safe to drop, but cheap to ship). |
| **Auto-variants for org logos** (64, 256, 640 px, preserve aspect ratio, webp + png fallback) | Logos are rectangular — `fit: 'inside'` not `cover`. PNG fallback preserves transparency. | MEDIUM | Different transform spec from avatars; same pipeline. |
| **Variant naming convention** (`{tenantId}/avatars/{userId}/{size}.webp`) | Predictable paths, no DB lookup needed for thumbnail rendering, easy CDN caching. | LOW | Deterministic key builder. |
| **Skip transforms for tenant content** (only `auth:avatar` and `tenant:logo` get the transform pipeline in v1.4; other modules' attachments are stored as-is) | v1.4 scope discipline. Generic content transforms = unbounded scope (PDFs, video, etc.). | LOW | Module declares `transforms?:` in its file-ownership descriptor. If absent, original-only. |
| **Variant metadata in `files.variants` JSONB** (`{ "256": { key: "...", size: 12345, format: "webp" } }`) | UI needs to know which variants exist and where. Single round-trip to fetch all sizes. | LOW | One JSONB column. |
| **Strip EXIF metadata on transform** | Privacy (GPS coords on phone photos), file size. sharp does this by default with `withMetadata(false)`. | LOW | Default-on. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| **Synchronous transform on commit for tiny images (<1MB)** with async fallback for larger | Avatars are usually 200KB; doing them sync on commit means the user sees their new avatar immediately. Async-only = "image will appear in a moment" UX. | MEDIUM | Threshold + try/catch with timeout. Falls back to job on timeout. |
| **AVIF output alongside webp** | ~30% smaller than webp. 2026 browser support is universal except very old Safari. | LOW | Add to sharp pipeline. Cheap. |
| **Variant generation idempotency** (job keyed by `(fileId, variantSpec hash)`) | Re-runs are safe; failed jobs can retry without duplicate work. | LOW | BullMQ `jobId` = deterministic hash. |
| **Per-file transform spec override** | Module author can pass custom variant specs for a specific upload. | LOW | Optional field on commit. |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **Synchronous transforms on the API thread** | "Fast and simple." | Single 5MB photo upload blocks one Bun thread for ~500ms. 10 concurrent uploads = API stalls. | BullMQ worker. |
| **Transform on read** (mint URL → check if variant exists → generate on demand) | "Lazy, only generate what's used." | Cold-start latency. Cache invalidation hell. Complex caching layer. Better to over-generate at upload time and let CDN handle cache. | Generate-on-write. |
| **Universal transform pipeline for all file types** | "Why not transform tenant content too?" | PDFs need pdf-lib, video needs ffmpeg, audio needs other tooling. Each is its own milestone. v1.4 scope = images only, and only for identity assets. | Identity-only in v1.4. Generic content stored as-is. |
| **Browser-side resize before upload** | "Save bandwidth." | Quality loss is irreversible. Server still has to validate. EXIF stripped client-side cannot be re-added. | Always upload original at full resolution. Server has authority. |
| **In-app image cropping/editing UI** | "Better UX." | Massive scope. Off-the-shelf libraries (react-easy-crop, etc.) aren't free either — they need integration with the upload flow, undo, mobile gestures. | Defer to v1.5+ or never. shadcn Avatar with `<input type="file">` + auto-square crop server-side covers 90% of cases. |

### Dependencies

- Per-module BullMQ queues + Phase 20 trace propagation (already shipped).
- `files` table (Category 5).
- Module file-ownership descriptor (Category 5).

---

## Category 4 — Per-Tenant Quota

### Table Stakes

| Feature | Why Expected | Complexity | Notes / Dependencies |
|---|---|---|---|
| **`tenant_storage_usage` counter table** (`tenant_id PK, bytes_used BIGINT, files_count INT, updated_at`) | One row per tenant. Single counter avoids `SUM(files.size)` scan on every check. | LOW | New Drizzle table. Migration via drizzle-kit. |
| **Increment on commit** (transactional with the `files` row insert) | Cannot drift if commit fails after insert — single transaction. | LOW | Single `UPDATE tenant_storage_usage SET bytes_used = bytes_used + $1 ... ` in same Drizzle txn as files-insert. |
| **Decrement on delete** (transactional with `files` row delete or soft-delete state change) | Same reason. | LOW | Same pattern. |
| **Quota check at sign-time** (`if tenant.bytes_used + requested_size > tenant.quota_bytes: reject`) | Reject *before* the sign so the user gets immediate feedback rather than the upload failing on commit. | LOW | One query in `signUpload` handler. |
| **Default quota per tenant** (env-configurable, e.g., 5GB free tier) | Need a number to enforce against. | LOW | `DEFAULT_TENANT_QUOTA_BYTES` env var. Per-tenant override via `tenant.quota_bytes` column. |
| **Quota exposed in `/health/detailed`** (per Phase 22 HealthContributor pattern) | Operator visibility into which tenants are near limits. | LOW | New `HealthContributor` from `files` module. Returns top-N tenants by usage. Reuses Phase 22 worst-of-N rollup. |
| **`tenant.bytes_used` shown in admin dashboard** (tenants list column + tenant detail page graph over time) | Admin needs to see this for support requests + sales conversations. | MEDIUM | New CQRS query `getTenantStorageUsage`. Reuse existing DataTableCards pattern from v1.1. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| **Reconciliation job** (nightly BullMQ scheduled job: `SELECT tenant_id, SUM(size) FROM files GROUP BY tenant_id` → compare to `tenant_storage_usage` → log drift, optionally auto-fix) | Counters drift over decades — concurrent transactions, manual DB edits, restored backups. Trust-but-verify. | LOW | One scheduled BullMQ job. Logs warnings via pino. Dashboard alert if drift > 1%. |
| **Quota grace period** (allow 10% overage for 7 days, then hard-block) | Real-world UX — users mid-upload don't want to be blocked. | MEDIUM | Two columns: `quota_bytes`, `quota_grace_until`. Sign-time check considers both. |
| **Per-module quota sub-buckets** (e.g., "5GB total, but max 1GB for avatars") | Stops avatars from eating tenant content quota. | MEDIUM | Defer to v1.5+. |
| **Quota Sentry alert at 90% / 100%** | Auto-notify operator. | LOW | Phase 18 ErrorTracker integration. |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **Computing usage on every check via `SUM(size)`** | "Always accurate, no drift." | O(N) scan per upload. At 100K files per tenant, sign-time goes from <10ms to >100ms. | Counter + nightly reconcile. |
| **Storing usage in Redis** | "Fast." | Counter is durable state. Redis loss = data loss. Postgres counter is fine — we already do far hotter writes. | Postgres column. Cache reads in Redis if needed (probably not needed). |
| **No enforcement, only reporting** | "Let users upload, send invoice." | One bad actor pumps 1TB into a free-tier tenant overnight. Real cost on Baseworks operator. | Enforce at sign-time. |

### Dependencies

- tenant-scoped DB (already shipped).
- `/health/detailed` HealthContributor pattern (Phase 22, already shipped).
- BullMQ scheduled jobs (already wired).

---

## Category 5 — Module File-Ownership Pattern

This is the architectural keystone of v1.4. Files don't live in any one module; modules **claim** rows in a central `files` table.

### Table Stakes

| Feature | Why Expected | Complexity | Notes / Dependencies |
|---|---|---|---|
| **Central `files` table** with columns: `id (UUID PK), tenant_id, owner_module (text), owner_record_id (text), key (text — storage key), size (bigint), mime (text), variants (jsonb), state ('pending'\|'committed'\|'deleted'), created_at, created_by (user_id), deleted_at` | Single source of truth for metadata + URL minting + quota. Avoids each module rolling its own files table. | LOW | New Drizzle schema in `packages/modules/files/db.ts`. Tenant-scoped via existing wrapper. |
| **Module declares file relations in its module descriptor** (similar to existing `def.commands`, `def.queries`, `def.health` from Phase 22) | Existing module pattern — files extends it. `def.files: { ownerModule: 'auth', specs: { avatar: { transform: avatarSpec, max: '5MB', mimes: ['image/jpeg','image/png','image/webp'] } } }`. | MEDIUM | New `FileOwnership` contributor type. ModuleRegistry collects at boot, exposes `registry.fileSpec(ownerModule, kind)` for the `signUpload` handler to validate against. |
| **Soft-delete on `state = 'deleted'`, hard-delete sweep job** | Lets us decrement quota immediately on user delete while deferring expensive S3 `deleteObject` calls. Survives "oops" undo flows for a window. | MEDIUM | BullMQ scheduled job `files:sweep-deleted` runs hourly; deletes objects + rows older than X (env-configurable, default 24h). |
| **Cascade behavior on owner-record delete is module-defined** (declarative: `onOwnerDelete: 'cascade' \| 'orphan'`) | Some modules want files dead with the parent (e.g., delete user → delete avatar). Some want orphans for audit (e.g., billing invoices outlive subscription cancellation). | MEDIUM | Module descriptor field. ModuleRegistry calls `files.cascadeOwner({module, recordId})` from the relevant module's delete handler. Or: ship `cascade` as default, modules opt out for orphan. |
| **Orphan cleanup job** (find files where `owner_record_id` no longer exists in owner module's table → delete) | Drift cleanup — same role as quota reconciliation. Keeps storage from growing without bound. | LOW | Scheduled BullMQ job. Runs weekly. |
| **`packages/files` shared package** with the port, adapters, key builder, and FileOwnership types | Avoid every module re-implementing storage glue. | LOW | New workspace package alongside `packages/db`, `packages/i18n`. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| **Drizzle schema-aware FK helper** for `owner_record_id` → owner-module's primary table | Type-safe: `attachFile({ ownerRecord: subscription })` infers `ownerModule = 'billing'`, `ownerRecordId = subscription.id`. | MEDIUM | Module declares its primary entity table in the descriptor; helper reads from registry. |
| **`files.events`** module emits `file.committed`, `file.deleted` events that other modules can subscribe to | Lets a module react when its own files change without polling. e.g., `billing` regenerates invoice index when an attached PDF lands. | LOW | Reuses existing in-process EventBus. |
| **Per-spec versioning for transforms** (`avatarSpec.version: 2`) — old variants regenerate on next access | Lets you roll out a new avatar size without immediately reprocessing 100K avatars. | MEDIUM | Defer to v1.5+. |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **Per-module files tables** (`auth_avatars`, `billing_invoice_files`, ...) | "Each module owns its data." | N tables to migrate. N quota integrations. N URL-minting paths. Loses uniform listing/admin. | One central `files` table. Modules own *rows*, not the table. |
| **Storing files as bytea in Postgres** | "One DB, one backup." | Catastrophic at scale. Postgres + S3 is the standard split for a reason. | S3-compatible storage + Postgres metadata. |
| **Foreign-key constraints from `files.owner_record_id` to module tables** | "Database-enforced integrity." | Violates module isolation. Forces a central schema knowledge. Cross-module deletes become impossible to enforce at FK level since `owner_record_id` is polymorphic. | Application-level cascade via the module-descriptor `onOwnerDelete`. Orphan-sweep job catches drift. |

### Dependencies

- Module registry + descriptor pattern (already shipped, Phase 22 added `health` contributor — same shape).
- Tenant-scoped DB.
- BullMQ scheduled jobs.
- Drizzle migrations.

---

## Category 6 — Identity Asset Wiring (Avatars, Org Logos)

### Table Stakes

| Feature | Why Expected | Complexity | Notes / Dependencies |
|---|---|---|---|
| **Avatar upload flow on user profile page** (Next.js + admin both) | shadcn `<Avatar>` is everywhere; without an upload path the field is read-only. | MEDIUM | New page in `apps/web` (profile settings) + existing admin user-edit. Reuses Category 8 uploader component. |
| **Avatar variants populated in `user.avatar_variants` JSONB on `file.committed`** for the avatar spec | Avatar render code needs `{64: url, 128: url, ...}`. The variants are in `files.variants` already; copy them onto `user` for fast read (avoids JOIN on every render). | LOW | Event handler on `file.committed` filters by `ownerModule === 'auth' && spec === 'avatar'`. |
| **Default avatar fallback (initials)** for users without an upload | shadcn `<AvatarFallback>` already does this. Just wire user's first/last initial. | LOW | Pure UI, no upload involved. |
| **Org logo upload flow on tenant settings page** | Same shape as avatar but on org. | MEDIUM | Reuses uploader. |
| **Replacement on re-upload deletes old variants** | "Upload new avatar" should not leak storage. | LOW | `attachFile({...})` with `ownerRecordId = userId` should detect existing avatar file for this user, soft-delete it, attach new. |
| **`avatar_url` (single-size convenience accessor)** on user table | Many third-party integrations (Sentry user context, email templates) want one URL string. | LOW | Computed: prefer 256px variant, fall back to 64, then to default. Stored as a denormalized column updated on commit. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| **Generated default avatar (gravatar-style or DiceBear initials/identicon)** for users without upload | Less drab UX. DiceBear has free SVG endpoints; can be self-hosted. | LOW | Server-rendered SVG via `@dicebear/core`. Cache-key by user ID hash. |
| **Org logo aggressively cached at edge** (immutable URL by content-hash) | Logo renders on every page; should hit CDN, not API, after first load. | MEDIUM | Variant key includes content-hash; URLs become immutable. Sets `Cache-Control: public, max-age=31536000`. |
| **Animated avatars (GIF/WebM)** | Discord-style. | MEDIUM | Defer. Sharp can handle multi-frame WebP; complexity not v1.4-justified. |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **Storing avatar as base64 in user row** | "One read." | Bloats user table. Kills replication lag. Defeats CDN. (See goauthentik discussion #6824 for community consensus.) | Storage key + variant URLs. |
| **Per-user storage prefix instead of per-tenant** (`/avatars/{userId}/...`) | "Cleaner." | Cross-tenant key collisions if user IDs are not globally unique (they are UUIDs in Baseworks, so technically safe — but tenant-prefix still wins for IAM policies and prefix-based deletion). | `{tenantId}/{ownerModule}/...`. |
| **Computing `avatar_url` JIT at every render** by signing fresh URL | "Always fresh." | Sign-time DB hit on every page render. Avatar URLs live for the variant TTL or are public-with-content-hash. | Pre-compute on commit, update on replacement. |

### Dependencies

- Category 5 module file-ownership.
- Better-auth `user` table schema extension (add `avatar_url` + `avatar_variants` columns).
- Better-auth `organization` table extension (add `logo_url` + `logo_variants`).

---

## Category 7 — Generic Tenant-Attachment Path

The "any module can attach a file to any of its records" API.

### Table Stakes

| Feature | Why Expected | Complexity | Notes / Dependencies |
|---|---|---|---|
| **Two-step attach flow shared across all modules**: (1) `signUpload({ ownerModule, ownerRecordId, kind })` → returns `{ uploadUrl, fileId }`; (2) `commitUpload({ fileId })` → returns committed file row | One canonical path. Modules don't roll their own upload flows. | LOW | Single CQRS command pair in `files` module. Module's own command (e.g., `billing.attachInvoicePdf`) is a thin wrapper that maps domain inputs to `signUpload`. |
| **Module-author API: `attachFile()` helper** in `packages/files` | Sugar on top of signUpload + commitUpload. Module command can do `await files.attachFile({ ownerModule: 'billing', ownerRecordId: sub.id, kind: 'invoicePdf', stream: pdfStream })` for **server-side-generated** files (no browser upload). | MEDIUM | Two paths: browser-direct (sign+commit) vs server-side (direct put + record). Same `files` row outcome. |
| **Querying attached files**: `getFilesForRecord({ ownerModule, ownerRecordId })` | Modules need to render "files attached to this record." | LOW | One CQRS query. |
| **Module-defined `kind` discriminator** (e.g., `billing` has kinds `invoicePdf`, `receipt`, `taxForm`) | Lets a single record have multiple kinds of files. | LOW | `files.kind` text column with module-namespaced enum. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| **Eden Treaty type narrowing per module** (the `signUpload` endpoint refines its `kind` parameter type based on `ownerModule`) | Compile-time error if you try to `signUpload({ ownerModule: 'billing', kind: 'avatar' })`. | MEDIUM | Requires building the module's spec map into the Elysia type. Doable; aligns with existing Eden Treaty pattern. |
| **Bulk attach** (`attachMany([{...}, {...}])`) | Multi-file upload in one transaction. | LOW | Defer until UI multi-file is shipped. |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **Per-module sign endpoints** (`POST /api/billing/uploads/sign`, `POST /api/auth/uploads/sign`, ...) | "Module-owned URL space." | Duplicate sign/validation logic. Inconsistent quota enforcement. | One central `/api/uploads/sign` with module discriminator. Module's domain commands wrap it. |
| **Attaching by URL only (no upload)** (e.g., "paste a Dropbox link") | "Flexible." | Now you have hotlinks, broken-image risk, no quota tracking, no privacy guarantees. | Always upload + own the bytes. |

### Dependencies

- Category 5 (the `files` table + module descriptor).
- Eden Treaty + existing CQRS bus.

---

## Category 8 — UI Uploader Component (`packages/ui`)

### Table Stakes

| Feature | Why Expected | Complexity | Notes / Dependencies |
|---|---|---|---|
| **`<FileUploader>` component** with drag-drop region + file-input fallback | Standard UX. shadcn doesn't ship one — community options exist (`react-dropzone` + custom UI). | MEDIUM | New component in `packages/ui`. Wraps `react-dropzone` (proven, accessible, tiny). |
| **XHR upload with progress via `xhr.upload.onprogress`** | `fetch` API does **not** report upload progress. Required to use XHR for the progress bar. | LOW | Wrap XHR in a Promise. Used by both single-file and (future) multipart. |
| **Image preview before upload** | User sees thumbnail before commit. UX baseline. | LOW | `URL.createObjectURL(file)` for images; render in component. |
| **Per-file error states** (oversize, wrong-MIME, quota-exceeded, network-failed, signed-URL-expired) | Each is a distinct user-actionable failure. Surface specific messages. | LOW | Discriminated union state per file. i18n strings for each. |
| **Single-file mode (default) + multi-file mode (opt-in via prop)** | Avatars are single; tenant attachments often multi. | LOW | Prop on component. |
| **Cancel + retry per file** | Long uploads must be cancellable. | LOW | XHR `abort()`. State machine `idle → uploading → committing → done | error | cancelled`. |
| **i18n integration via existing packages/i18n** | Strings must localize. Pattern established v1.1. | LOW | New `uploader` namespace in `packages/i18n` (en + pt-BR). |
| **Accessibility: keyboard-operable, ARIA states, screen reader announcements per upload status** | a11y baseline established v1.1 with vitest-axe. | MEDIUM | Drag-drop region must have `<input type="file">` fallback and aria-live for status. |
| **Vitest+jsdom test coverage** following v1.2 pattern | Convention established; component must have a11y tests. | LOW | vitest-axe + RTL. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| **Paste-from-clipboard support** | Paste screenshot directly into uploader. Power-user UX. | LOW | `paste` event handler reading `event.clipboardData.files`. |
| **Pre-upload client-side resize for images** (downscale to max dimension before upload) | Saves bandwidth + quota for users uploading 12MP phone photos as avatars. | MEDIUM | Canvas-based resize. Quality loss is a non-issue for avatars. **Caveat:** server still re-runs sharp transforms — client resize is a *bandwidth* optimization, not a *correctness* optimization. |
| **Quota-aware UI** (shows tenant `bytes_used / quota_bytes` progress) | Live feedback before upload starts. | LOW | Reuse `getTenantStorageUsage` query. |
| **Restricted file picker** (`accept="image/jpeg,image/png,image/webp"` derived from module spec) | Native browser filter. Reduces wrong-MIME submissions. | LOW | Pass module spec down as prop. |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **In-browser cropping/rotation/filters** | "Like Twitter/Instagram." | Massive scope. Mobile gestures, undo, perf. Library lock-in. Out of v1.4 scope. | Server-side `fit: 'cover'` + center-crop covers 90%. v1.5+ if demand. |
| **WebRTC camera capture** | "Profile photo from webcam." | `<input type="file" capture>` already does this on mobile (system camera). WebRTC is overkill. | Native `capture` attribute. |
| **Custom progress UI per file with sparklines / ETAs** | "Premium feel." | Each new fancy state = a11y + i18n + test surface. | Plain progress bar + percentage + cancel button. |

### Dependencies

- packages/i18n (already shipped, v1.1).
- packages/ui Tailwind 4 + shadcn (already shipped).
- vitest + jsdom test infra (v1.2).
- Category 1 sign+commit endpoints.
- Category 7 attach API.

---

## Category 9 — Anti-Features for v1.4 (Explicit Defer List)

Already aligned with PROJECT.md "Out of scope (v1.5+)" but expanded with rationale:

| Anti-Feature | Why Tempting | Why Defer | When to Revisit |
|---|---|---|---|
| **In-browser image cropping/editing** | shadcn-adjacent libraries make it look easy. | Massive UX/a11y/i18n surface; mobile gestures hard; library lock-in. v1.4 scope = back-end primitives + minimum UI. | v1.5+ only if a fork user explicitly requests it. |
| **Video transcoding** | "Files include video." | Requires ffmpeg native binary, queue-tier with much larger machines, codec licensing thinking, format negotiation. Multi-week milestone of its own. | Separate `v1.x video` milestone if demand. |
| **Bulk CSV/Excel imports** | "It's also a 'file upload'." | Different problem domain — data import, schema mapping, error reporting, dry-run, partial-failure. Should NOT live in `files` module. | Standalone "data import" milestone if demand. |
| **Multi-region replication** | "Resilience." | Operational complexity, cost, consistency model. Most fork users single-region. S3 + CRR is a one-line bucket config when needed; don't build app-level. | When a fork user runs in 3+ regions and reports DR pain. |
| **File-access audit log** | Compliance ask. | Already partially solved — pino logs every URL mint with tenant + user + trace. Dedicated audit table belongs to a future "audit log" milestone covering all access events, not just file. | Future audit-log milestone. |
| **Virus scanning (ClamAV/etc adapter)** | "Security." | Heavy operational dependency (ClamAV signatures, RAM, update cycle). Belongs in security-focused milestone with rate-limiting + WAF + similar. The port can accommodate it later (`def.scan?: ScanProvider`). | v1.5+ security milestone. |
| **Public CDN bucket / image hotlinking** | "Performance." | Privacy regression — even avatars are arguably PII. Single signed-URL path is the safe default. | Per-fork opt-in via separate adapter, not core. |
| **Browser-side file integrity hashing (SHA-256 before upload)** | "Verify upload integrity." | S3 already verifies via Content-MD5/checksum on PUT. Browser hashing of large files blocks UI thread (worker thread is hard). | If a fork user has compliance need; AWS now supports CRC64 + SHA256 natively in 2026 SDK. |
| **Image format conversion at upload time (HEIC → JPEG)** | iPhone uploads. | sharp 2026 supports HEIC read but requires libheif system dep. Worth flagging as an extension point — not blocking v1.4. | Add as adapter capability flag if `wasm-vips` covers it. |

---

## Feature Dependencies (Graph)

```
[Category 5 — files table + module descriptor]
    |-- prerequisite for --> [Category 1 — sign + commit]
    |-- prerequisite for --> [Category 2 — signed read URLs]
    |-- prerequisite for --> [Category 4 — quota tracking]
    +-- prerequisite for --> [Category 7 — generic attach]

[Category 1 — sign + commit]
    |-- prerequisite for --> [Category 3 — image transforms (commit fires job)]
    +-- prerequisite for --> [Category 6 — avatar/logo upload]

[Category 3 — image transforms]
    +-- prerequisite for --> [Category 6 — avatar/logo (variants populated)]

[Category 7 — generic attach]
    +-- prerequisite for --> [Category 8 — UI uploader (consumer of attach API)]

[Category 4 — quota tracking]
    +-- enhances ----------> [Category 1 — quota check at sign time]

[Sharp + Bun compatibility spike]
    +-- BLOCKS ------------> [Category 3 entirely — choose sharp vs wasm-vips first]
```

### Suggested phase ordering (for roadmap step)

1. **Phase A — Foundation:** Category 5 (`files` table + module descriptor) + storage port + 3 adapters (S3, S3-compat, Local).
2. **Phase B — Sharp spike + Category 3 minimal:** prove image lib works under Bun, ship avatar variant generation as the canonical example.
3. **Phase C — Category 1 + Category 2:** sign-PUT + commit + signed read URLs end-to-end.
4. **Phase D — Category 4:** quota tracking + admin surface.
5. **Phase E — Category 6 + Category 7:** avatar/logo upload pages + generic attach API.
6. **Phase F — Category 8:** UI uploader component, used by Phase E consumers.

Phase B is the highest research-flag risk. If sharp doesn't work under Bun, Phase B converts to a wasm-vips spike + adapter.

---

## MVP Definition

### Launch with v1.4

- [x] **Category 1 (Direct upload):** PUT presigned URL only (POST policy deferred). Sign + commit, magic-byte MIME check, size cap, CORS docs.
- [x] **Category 2 (Signed reads):** Per-request mint, batched, short TTL, `Content-Disposition` override.
- [x] **Category 3 (Image transforms):** Avatar (4 sizes) + org logo (3 sizes), webp + jpeg fallback, async via BullMQ, EXIF stripped.
- [x] **Category 4 (Quota):** Counter table + sign-time check + admin surface + nightly reconciliation.
- [x] **Category 5 (Module file-ownership):** Central `files` table, module descriptor, soft-delete + sweep, declarative cascade.
- [x] **Category 6 (Identity assets):** Avatar + org logo upload pages, default-initials fallback, `avatar_url` denormalized.
- [x] **Category 7 (Generic attach):** `signUpload` + `commitUpload` + `attachFile` helper + `getFilesForRecord` query.
- [x] **Category 8 (UI uploader):** Single-file + multi-file, drag-drop + fallback, progress, image preview, error states, i18n, a11y.

### Defer to v1.4.1 / v1.5+

- POST policy (alternative to PUT)
- Multipart upload (large files)
- Synchronous fast-path transforms (<1MB images)
- AVIF output
- Batched URL minting (if not needed by initial UI)
- Per-module quota sub-buckets
- Quota grace periods
- Pre-upload client-side resize
- Paste-from-clipboard
- HEIC conversion

### Out of scope entirely

- Image cropping/editing UI
- Video transcoding
- Bulk CSV/Excel imports
- Multi-region replication
- File-access audit log
- Virus scanning
- Public CDN bucket

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---|---|---|---|
| Files table + module descriptor (Cat 5) | HIGH | LOW | P1 |
| Sign + commit + magic-bytes (Cat 1) | HIGH | LOW-MED | P1 |
| Signed read URLs (Cat 2) | HIGH | LOW | P1 |
| Quota counter + sign-time enforcement (Cat 4) | HIGH | LOW | P1 |
| BullMQ transform job (Cat 3) | HIGH | MED | P1 |
| Avatar/logo flow (Cat 6) | HIGH | MED | P1 |
| Generic attach API (Cat 7) | HIGH | LOW | P1 |
| `<FileUploader>` UI component (Cat 8) | HIGH | MED | P1 |
| CORS boilerplate + docs | HIGH (devex) | LOW | P1 |
| Reconciliation job | MED (long-term) | LOW | P1 |
| /health/detailed quota contributor | MED (ops) | LOW | P1 |
| Default avatar (initials/dicebear) | MED | LOW | P2 |
| Batched URL minting | MED | LOW | P2 |
| Sync transforms for tiny images | LOW-MED | MED | P2 |
| Quota grace period | LOW-MED | MED | P3 |
| AVIF output | LOW | LOW | P3 |
| POST policy alternative | LOW (portability) | MED | P3 |
| Multipart upload | LOW (until 5GB+) | HIGH | P3 |
| Eden Treaty type-narrowing per kind | MED (devex) | MED | P3 |

---

## Quality Gates Self-Check

- [x] **Categories non-overlapping**: 1=upload signing, 2=read signing, 3=transforms, 4=quota, 5=ownership table, 6=identity wiring, 7=generic attach API, 8=UI. No double-coverage.
- [x] **Complexity noted on every table-stake item**.
- [x] **Dependencies on existing components identified**: tenant-scoped DB, CQRS, BullMQ + trace propagation, EventBus, ModuleRegistry contributor pattern, Phase 22 HealthContributor, packages/ui, packages/i18n, vitest+jsdom, Eden Treaty, pino auto-context.
- [x] **Anti-features explicit with reasoning**: Category 9 + per-category anti-feature tables.
- [x] **Critical risk flagged**: sharp + Bun compatibility (Category 3 lead).

---

## Sources

- [Differences between PUT and POST S3 signed URLs — Advanced Web Machinery](https://advancedweb.hu/differences-between-put-and-post-s3-signed-urls/)
- [S3 Uploads — Proxies vs Presigned URLs vs Presigned POSTs (Zac Charles)](https://zaccharles.medium.com/s3-uploads-proxies-vs-presigned-urls-vs-presigned-posts-9661e2b37932)
- [The illustrated guide to S3 pre-signed URLs (fourTheorem)](https://fourtheorem.com/the-illustrated-guide-to-s3-pre-signed-urls/)
- [AWS — Uploading objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
- [AWS SaaS Factory — S3 multitenancy partitioning](https://github.com/aws-samples/aws-saas-factory-s3-multitenancy)
- [Cloudflare R2 — Presigned URLs (S3-compat)](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [AWS — Amazon S3 multipart upload limits](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html)
- [How to Validate File Type Using Magic Bytes and MIME Type (pye.hashnode.dev)](https://pye.hashnode.dev/how-to-validate-javascript-file-types-with-magic-bytes-and-mime-type)
- [file-type vs mime-types vs mmmagic (PkgPulse)](https://www.pkgpulse.com/blog/file-type-vs-mime-types-vs-mmmagic-file-2026)
- [File Upload Content Type and MIME Type Bypass Vulnerabilities (Sourcery)](https://www.sourcery.ai/vulnerabilities/file-upload-content-type-bypass)
- [Sharp installation docs](https://sharp.pixelplumbing.com/install/)
- [Sharp issue #3779 — Bun install incompatibility](https://github.com/lovell/sharp/issues/3779)
- [Sharp issue #3511 — Support for Bun runtime](https://github.com/lovell/sharp/issues/3511)
- [Bun issue #4549 — sharp install fails under bun](https://github.com/oven-sh/bun/issues/4549)
- [Sharp issue #4215 — Bun + Alpine binary mismatch](https://github.com/lovell/sharp/issues/4215)
- [Bun Compatibility 2026 (alexcloudstar)](https://www.alexcloudstar.com/blog/bun-compatibility-2026-npm-nodejs-nextjs/)
- [The Complete React File Upload Guide (Logan Lee, Medium)](https://medium.com/@dlrnjstjs/the-complete-react-file-upload-guide-from-drag-drop-to-progress-tracking-b2edb40016c2)
- [goauthentik discussion #6824 — avatar URL vs base64 community consensus](https://github.com/goauthentik/authentik/discussions/6824)
- [Multi-Tenant SaaS Storage Strategies (majdarbash)](https://majdarbash.github.io/aws-posts/multi-tenant-saas-storage/)
- Project context: `.planning/PROJECT.md` (v1.4 goals, constraints, existing components)
- Project context: `.planning/MILESTONES.md` (Phase 20 BullMQ trace propagation, Phase 22 HealthContributor, v1.1 i18n + DataTableCards, v1.2 vitest+jsdom)

---
*Feature research for: Baseworks v1.4 — File Storage & Uploads*
*Researched: 2026-05-05*
