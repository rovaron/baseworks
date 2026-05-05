# Requirements: Baseworks v1.4 File Storage & Uploads

**Defined:** 2026-05-05
**Core Value:** Clone, configure, and start building a multitenant SaaS in minutes — not weeks.
**Milestone Goal:** Ship a typed `FileStorage` port with S3 + S3-compatible + Local adapters, signed direct uploads, automatic image transforms via sharp (with `imagescript` fallback), per-tenant quota tracking, and a reusable UI uploader component — so fork users inherit ready-to-use file handling for both identity assets (avatars, org logos) and tenant content (documents, photos, videos attached to records).
**Architecture:** Port + adapters (matching `PaymentProvider`, `ErrorTracker`, `Tracer` patterns). Single central `files` table with polymorphic `fileRelations` declared by modules.

## v1.4 Requirements

### FILE — File Storage Core

- [ ] **FILE-01**: Operator can configure storage backend via env (`STORAGE_PROVIDER=local|s3|s3-compat`); factory selects adapter at startup; missing required env crashes at boot with a clear error
- [ ] **FILE-02**: Developer sees a typed `FileStorage` port with `signUpload`/`signRead`/`stat`/`delete`/`getObject`/`putObject`; conformance test suite proves all 3 adapters behave identically (mirrors PaymentProvider Stripe↔Pagar.me parity from v1.1)
- [ ] **FILE-03**: Operator can run all 3 adapters — Local (dev), AWS S3 (cloud), S3-compatible (self-hosted MinIO/Garage/Ceph/R2 via configurable endpoint + path-style)

### UPL — Upload Flow

- [ ] **UPL-01**: Frontend can upload a file via signed direct PUT URL — server signs short-lived URL with size + MIME constraints; browser PUTs directly to storage; CORS config templates shipped per backend
- [ ] **UPL-02**: Server verifies upload completion via S3 `HEAD` (authoritative byteSize, never the client-reported value) and magic-byte MIME check via `file-type`; mismatched checksum or MIME triggers object delete + DB cleanup
- [ ] **UPL-03**: Storage keys are unguessable — `buildStorageKey()` is the only constructor; mandatory nanoid(24) segment; tenant prefix is informational, not authoritative for cross-tenant authorization
- [ ] **UPL-04**: Developer can delete a file via authorized API; tenant-scoped permission verified; storage object + DB row removed atomically; quota decremented

### IMG — Image Transforms

- [ ] **IMG-01**: Operator gets typed `ImageTransform` port with `sharp` adapter (default) and `imagescript` fallback (selectable via `IMAGE_TRANSFORM_PROVIDER` env); subprocess smoke test gates the transform phase (Phase 17-style verification)
- [ ] **IMG-02**: Image uploads with declared variants generate variant files asynchronously via BullMQ `image-transform` queue; transforms recorded in `files.transforms` jsonb; consumer-side trace propagation reuses Phase 20 wrapper
- [ ] **IMG-03**: Decompression-bomb prevention enforced — pre-flight metadata check rejects files exceeding 50M pixels; sharp `limitInputPixels` set; EXIF strip on every transform; `image/*` >20MB rejected before sharp processes

### QUO — Per-Tenant Quota

- [ ] **QUO-01**: Operator sees per-tenant storage usage tracked in `tenant_storage_usage` (atomic increment on upload completion, decrement on delete)
- [ ] **QUO-02**: Sign-upload denies uploads that would exceed quota; race-safe via `bytes_pending` UPSERT pattern (or `SELECT ... FOR UPDATE`); default quota configurable via env (`STORAGE_DEFAULT_QUOTA_BYTES`); 50-concurrent-uploads load-test gate enforces correctness
- [ ] **QUO-03**: `/health/detailed` exposes storage health contributor (top-N tenants by usage, % quota used); Sentry alert templates fire at 90% and 100% quota; nightly reconciliation job rebuilds `bytes_used` from `SUM(byte_size)` for drift correction

### MOD — Module File-Ownership

- [ ] **MOD-01**: Module author declares `fileRelations` in `ModuleDefinition` — `{ recordType, allowedMimeTypes, maxByteSize, generateVariants?, onDelete?, canRead?, canWrite? }`
- [ ] **MOD-02**: Files module collects relations at boot via the registry (mirrors Phase 22 health-contributor pattern); cross-module file logic uses `TypedEventBus`, not direct imports between modules
- [ ] **MOD-03**: Cascade-on-delete via event subscription (e.g., `auth.user-deleted`); orphan reconciliation job sweeps files whose `(ownerModule, ownerRecordId)` no longer resolves; soft-delete pattern preserves audit trail

### IDA — Identity Assets

- [ ] **IDA-01**: User can upload avatar via customer-app profile page; declared via `auth.fileRelations.user`; variants 64/128/256/512 px webp generated on upload; `get-profile` query resolves `avatarUrl` from latest user-file
- [ ] **IDA-02**: Owner role can upload org logo via customer-app team-settings page; declared via `auth.fileRelations.organization`; variants 128/256 px webp; SVG explicitly **rejected** (security: XSS via `<script>` in SVG); raster only (jpeg/png/webp)

### ATT — Generic Tenant Attachments

- [ ] **ATT-01**: Module author can attach uploaded files to any record (e.g., billing PDF on subscription); files retrievable via `list-files-for-record` query; uses the central `files` table — NO per-module file tables
- [ ] **ATT-02**: Read access enforced via per-relation `canRead` hook; signed read URLs minted per-request with short TTL (5–15 min, env-configurable via `STORAGE_SIGNED_URL_TTL_SEC`); raw `storage_key` NEVER exposed in API responses

### UI — Uploader Component

- [ ] **UI-01**: Developer gets `<FileUpload>` component + `useFileUpload` hook in `packages/ui` — drag-drop + file picker fallback, XHR upload progress, image preview via `URL.createObjectURL`, error states (oversize / wrong MIME / quota exceeded / network), cancel/retry, single + multi mode (opt-in via prop)
- [ ] **UI-02**: Component is i18n-ready (en + pt-BR keys shipped via `packages/i18n`) and a11y-tested (vitest-axe in `packages/ui` suite); consumed by Next.js customer app (avatar + logo + attachments) and Vite admin app (tenant file browser)

### OPS — Operator Surface

- [ ] **OPS-01**: Operator gets runbooks under `docs/runbooks/` covering storage-quota-exceeded, image-transform-failure, s3-unreachable, orphan-files-detected scenarios — same Trigger → Symptoms → Triage → Resolution → Escalation template as v1.3 (Phase 23)
- [ ] **OPS-02**: Operator gets Sentry alert JSON templates under `docs/alerts/sentry/` for storage-quota and image-transform-failure scenarios with `runbook_url` cross-links; CI validates link integrity automatically (Phase 23 4th invariant)
- [ ] **OPS-03**: Operator gets `docs/integrations/file-storage.md` with CORS config templates per backend (AWS S3, R2, MinIO, Garage), bucket lifecycle policy snippets (AbortIncompleteMultipartUpload 7d, tmp/ 1d), CDN/Cache-Control guidance, and Docker base-image pin guidance for sharp (`oven/bun:1-debian-slim`, NOT Alpine)

## Future Requirements

Deferred to v1.5+ release. Tracked but not in v1.4 roadmap.

### VIRUS (deferred)

- **VIRUS-future-01**: ClamAV virus-scanning adapter — both the port shape AND adapter deferred entirely; folds into future security-focused milestone

### POST (deferred)

- **POST-future-01**: POST presigned policy upload as default (PUT covers v1.4 needs; POST opt-in deferred — research spike S-2 captured for future)

### MULTIPART (deferred)

- **MULTIPART-future-01**: S3 multipart upload for files >100MB — single-PUT covers all v1.4 use cases (avatars, logos, document attachments)

### AVIF (deferred)

- **AVIF-future-01**: AVIF output format alongside WebP — webp + jpeg fallback covers v1.4

### AUDIT (deferred)

- **AUDIT-future-01**: File-access audit log — folds into future audit-log milestone (cross-cutting feature, not file-storage-specific)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| In-browser image cropping/editing | Frontend feature, not starter-kit core; fork users build per-product |
| Video transcoding | Depth issue, separate milestone (libffmpeg dep, GPU optimization, codec licensing) |
| Bulk CSV/Excel imports | Different problem domain (data import, not file storage) |
| Multi-region replication | Operational concern, fork user configures S3-side |
| Public CDN bucket / hotlinking | Ship signed-private-only; fork user wires CDN themselves |
| WebRTC camera capture | Beyond drag-drop UX scope |
| HEIC → JPEG conversion | Requires `libheif` system dep; not Bun-portable |
| DiceBear/identicon default avatars | Frontend pattern, not infrastructure |
| Resumable uploads (`tus-js-client`) | Multipart resume is v1.5+ scope |
| Per-module file tables | Architecturally rejected — central `files` + polymorphic `fileRelations` |
| Browser-side SHA-256 hashing | Server-authoritative checksum from S3 stat |
| Animated avatars (multi-frame WebP) | Static-only for v1.4 |
| Per-tenant bucket isolation | Prefix-per-tenant default; bucket-per-tenant deferred until fork-user demand |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FILE-01 | TBD | Pending |
| FILE-02 | TBD | Pending |
| FILE-03 | TBD | Pending |
| UPL-01 | TBD | Pending |
| UPL-02 | TBD | Pending |
| UPL-03 | TBD | Pending |
| UPL-04 | TBD | Pending |
| IMG-01 | TBD | Pending |
| IMG-02 | TBD | Pending |
| IMG-03 | TBD | Pending |
| QUO-01 | TBD | Pending |
| QUO-02 | TBD | Pending |
| QUO-03 | TBD | Pending |
| MOD-01 | TBD | Pending |
| MOD-02 | TBD | Pending |
| MOD-03 | TBD | Pending |
| IDA-01 | TBD | Pending |
| IDA-02 | TBD | Pending |
| ATT-01 | TBD | Pending |
| ATT-02 | TBD | Pending |
| UI-01 | TBD | Pending |
| UI-02 | TBD | Pending |
| OPS-01 | TBD | Pending |
| OPS-02 | TBD | Pending |
| OPS-03 | TBD | Pending |

**Coverage:**
- v1.4 requirements: 25 total
- Mapped to phases: 0 (populated by roadmapper)
- Unmapped: 25 (will be 0 after roadmap)

**Phase distribution (proposed by research, finalized by roadmapper):**

Suggested 8-phase decomposition (Phases 24–31) per `.planning/research/SUMMARY.md` §7:

| Phase | Suggested name | Suggested REQ-IDs |
|-------|----------------|-------------------|
| 24 | Foundation: Port + Schema | FILE-01, FILE-02 (port skeleton), MOD-01 (`fileRelations` type) |
| 25 | Adapters + Test Infra | FILE-02 (conformance), FILE-03 |
| 26 | Files Module + Sign-Upload + Quota | UPL-01, UPL-03, QUO-01, QUO-02, MOD-02 |
| 27 | Complete + Read + Delete | UPL-02, UPL-04, ATT-01, ATT-02, MOD-03 |
| 28 | Image Transform Pipeline | IMG-01, IMG-02, IMG-03 |
| 29 | Auth + Org Identity Wiring | IDA-01, IDA-02 |
| 30 | UI Uploader | UI-01, UI-02 |
| 31 | Cleanup + Operator Surface | QUO-03, OPS-01, OPS-02, OPS-03 |

---
*Requirements defined: 2026-05-05*
*Last updated: 2026-05-05 after milestone scope confirmation — traceability awaits roadmap*
