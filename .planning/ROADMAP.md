# Roadmap: Baseworks

## Milestones

- ✅ **v1.0 MVP** -- Phases 1-5 (shipped 2026-04-08)
- ✅ **v1.1 Polish & Extensibility** -- Phases 6-12 (shipped 2026-04-16)
- ✅ **v1.2 Documentation & Quality** -- Phases 13-16 (shipped 2026-04-21)
- ✅ **v1.3 Observability & Operations** -- Phases 17-23 (shipped 2026-05-05)
- 🚧 **v1.4 File Storage & Uploads** -- Phases 24-31 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-5) -- SHIPPED 2026-04-08</summary>

- [x] Phase 1: Foundation & Core Infrastructure (3/3 plans) -- completed 2026-04-06
- [x] Phase 2: Auth & Multitenancy (3/3 plans) -- completed 2026-04-06
- [x] Phase 3: Billing & Background Jobs (4/4 plans) -- completed 2026-04-07
- [x] Phase 4: Frontend Applications (3/3 plans) -- completed 2026-04-07
- [x] Phase 5: Production Hardening (2/2 plans) -- completed 2026-04-08

Full details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

<details>
<summary>✅ v1.1 Polish & Extensibility (Phases 6-12) -- SHIPPED 2026-04-16</summary>

- [x] Phase 6: Responsive Layouts (3/3 plans) -- completed 2026-04-08
- [x] Phase 7: Accessibility (4/4 plans) -- completed 2026-04-09
- [x] Phase 8: Internationalization (3/3 plans) -- completed 2026-04-09
- [x] Phase 9: Team Invites (5/5 plans) -- completed 2026-04-11
- [x] Phase 10: Payment Abstraction (4/4 plans) -- completed 2026-04-11
- [x] Phase 11: Accessibility Gap Closure (2/2 plans) -- completed 2026-04-14
- [x] Phase 12: i18n Hardcoded String Cleanup (3/3 plans) -- completed 2026-04-14

Full details: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

</details>

<details>
<summary>✅ v1.2 Documentation & Quality (Phases 13-16) -- SHIPPED 2026-04-21</summary>

- [x] Phase 13: JSDoc Annotations (4/4 plans) -- completed 2026-04-16
- [x] Phase 14: Unit Tests (6/6 plans) -- completed 2026-04-17
- [x] Phase 15: Developer Documentation (6/6 plans) -- completed 2026-04-18
- [x] Phase 16: v1.2 Content Drift Fixes (3/3 plans) -- completed 2026-04-19

Full details: [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)

</details>

<details>
<summary>✅ v1.3 Observability & Operations (Phases 17-23) -- SHIPPED 2026-05-05</summary>

- [x] Phase 17: Observability Ports & OTEL Bootstrap (5/5 plans) -- completed 2026-04-22
- [x] Phase 18: Error Tracking Adapters (7/7 plans) -- completed 2026-04-23 (EXT-01 operator gate deferred to 18-HUMAN-UAT.md)
- [x] Phase 19: Context, Logging & HTTP/CQRS Tracing (8/8 plans) -- completed 2026-04-23
- [x] Phase 20: BullMQ Trace Propagation (3/3 plans) -- completed 2026-04-26
- [x] Phase 20.1: Close v1.3 milestone gaps from observability UAT (4/4 plans) (INSERTED) -- completed 2026-04-26
- [~] Phase 21: OTEL Adapters + Grafana Observability Stack -- DEFERRED to v1.4+ (Sentry SaaS covers metrics/dashboards/alerts; observability ports remain in place for fork users to wire OTLP later)
- [x] Phase 22: Admin Ops Tooling (6/6 plans) -- completed 2026-04-27
- [x] Phase 23: Runbooks, Alert Templates & Observability Docs (5/5 plans) -- completed 2026-04-28

Full details: [milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md)

</details>

### 🚧 v1.4 File Storage & Uploads (in progress)

8 phases derived from 25 requirements across 9 categories (FILE/UPL/IMG/QUO/MOD/IDA/ATT/UI/OPS). Architectural keystone: single central `files` table + polymorphic `fileRelations` declared by modules (mirrors v1.3 Phase 22 health-contributor pattern). Adapter matrix: 3 `FileStorage` adapters (Local/S3/S3-compat) + 2 `ImageTransform` adapters (sharp/imagescript) under a new `packages/storage/` workspace.

**Highest-risk phase: Phase 28 (Image Transform Pipeline)** — sharp under Bun + Docker is the one MEDIUM-confidence stack item; phase begins with a research spike on the target Docker base image. `imagescript` is the wired fallback.

#### Phase 24: Foundation — Storage Port + Files Schema + ModuleDefinition Extension

**Goal:** Lay the foundational types, schema, and registry hooks so subsequent phases plug into a stable contract — `packages/storage/` workspace skeleton, `FileStorage` + `ImageTransform` ports, central `files` + `tenant_storage_usage` tables, `ModuleDefinition.fileRelations` field, env additions with crash-on-missing validation.
**Depends on:** none — milestone start (builds on v1.0 module registry + scopedDb wrapper)
**Requirements:** FILE-01, MOD-01
**Success Criteria** (what must be TRUE):
  1. Developer can run `bun run db:migrate` and see migration `0002_v14_file_storage.sql` create `files` + `tenant_storage_usage` tables with tenant-scoped indexes; rollback path documented
  2. Developer can `import { FileStorage, ImageTransform } from "@baseworks/storage"` and TypeScript surfaces fully typed port interfaces (`signUpload`/`signRead`/`stat`/`delete`/`getObject`/`putObject` for FileStorage; `resize`/`metadata` for ImageTransform)
  3. Operator setting `STORAGE_PROVIDER=local|s3|s3-compat` sees the factory return the correct adapter shape; missing adapter-required env (`AWS_ACCESS_KEY_ID`, `S3_ENDPOINT`, etc.) causes `apps/api` boot to crash with a clear error message naming the missing var (mirrors Phase 17 `validateObservabilityEnv` pattern)
  4. Module author can declare `fileRelations: { user: { recordType, allowedMimeTypes, maxByteSize, generateVariants?, onDelete?, canRead?, canWrite? } }` in `ModuleDefinition` and the registry collects all relations at boot into a `fileRelationsRegistry` singleton (analogous to Phase 22 `healthContributors` collection at `apps/api/src/core/registry.ts`)
  5. Biome GritQL rule bans direct `db.select().from(files)` outside `packages/modules/files/`; cross-tenant access requires the scoped wrapper (Pitfall 5 prevention)
**Plans:** 7/7 plans complete
Plans:
- [x] 24-01-PLAN.md — Workspace skeleton + FileStorage/ImageTransform ports
- [x] 24-02-PLAN.md — Drizzle schema + migration 0002_v14_file_storage.sql + barrel re-exports
- [x] 24-03-PLAN.md — ModuleDefinition.fileRelations + FileRelation/ImageVariantSpec types in @baseworks/shared
- [x] 24-04-PLAN.md — Factory + env validator + 5 throwing-NotImplemented adapter scaffolds
- [x] 24-05-PLAN.md — fileRelationsRegistry singleton + collectFileRelations + Zod fail-loud
- [x] 24-06-PLAN.md — apps/api wire-up + .env.example + [BLOCKING] migration apply
- [x] 24-07-PLAN.md — Biome GritQL ban-files-table-access + belt-and-suspenders shell gate
**UI hint:** no

#### Phase 25: Test Infrastructure + Three Storage Adapters (Local + S3 + S3-Compat)

**Goal:** Ship all 3 `FileStorage` adapters proven equivalent by a shared conformance suite, with MinIO-in-CI as the integration harness, sharp fixture set, and per-backend CORS templates so signed-upload phases can build on a verified contract.
**Depends on:** Phase 24
**Requirements:** FILE-02, FILE-03
**Success Criteria** (what must be TRUE):
  1. Operator can run `bun test packages/storage` and see all 3 adapters (Local, S3 via Bun.S3Client, S3-compat with `forcePathStyle`) pass the same conformance suite — mirrors Stripe↔Pagar.me parity from v1.1 Phase 10
  2. CI runs the conformance suite against MinIO-in-a-container (GitHub Actions service container); same suite green on AWS S3 (live integration test gated on credentials env) and on Local (FS adapter)
  3. Operator can copy CORS templates from `docs/integrations/file-storage/cors/{aws-s3,r2,minio,garage}.json` and `bun run validate-cors` asserts no wildcard origins, ETag in `ExposeHeaders`, and required PUT methods present
  4. Developer can sign a PUT upload via the Local adapter and the URL contains an HMAC `?sig=` short-lived token (NOT a guessable file ID); production-mode boot refuses `STORAGE_PROVIDER=local && NODE_ENV=production` with a clear error (Pitfall 14)
  5. Sharp fixture set committed under `packages/storage/__test-fixtures__/` (100×100 baseline, 5000×5000 photo, 50000×50000 decompression bomb, truncated, SVG-with-script) and consumed by both adapter conformance and Phase 28 transform tests
**Plans:** 1/1 complete — executed from `25-PLAN-CONTRACT.md` (LOCKED). Complete (local-verified; S3/MinIO CI-gated). Local FS adapter, HMAC signing, CORS validator + 4 templates, and deterministic fixtures verified locally (`bun test packages/storage` → 83 pass / 21 skip / 0 fail); S3 (AWS) + S3-compat (MinIO) conformance gated behind `describe.skipIf` and run on the MinIO service container in CI (`validate.yml` `ci`, Bun 1.3.x).
**UI hint:** no

#### Phase 26: Files Module Skeleton + Sign-Upload + Per-Tenant Quota

**Goal:** Stand up the `packages/modules/files/` module with the first end-to-end signing flow — operator-configurable quota enforced atomically at sign-time, race-safe under 50 concurrent uploads, with the relations registry fully wired to the boot path.
**Depends on:** Phase 25
**Requirements:** UPL-01, UPL-03, QUO-01, QUO-02, MOD-02
**Success Criteria** (what must be TRUE):
  1. Frontend can `POST /api/files/sign-upload` with `{ ownerModule, kind, mimeType, byteSize }` and receive a signed PUT URL bound to the declared MIME + size constraints; URL TTL ≤ 15 min; `storage_key` is built only by `buildStorageKey()` and contains a mandatory `nanoid(24)` segment
  2. Operator sees `tenant_storage_usage` row created on tenant creation (DB hook) with default `bytes_limit` from `STORAGE_DEFAULT_QUOTA_BYTES` env; sign-upload endpoint denies an upload that would exceed quota with HTTP 413 + `quota_exceeded` error code
  3. 50-concurrent-uploads load test against a tenant at 95% quota proves the `bytes_pending` UPSERT pattern (or `SELECT ... FOR UPDATE`) prevents over-allocation — final `bytes_used + bytes_pending` ≤ `bytes_limit` after all concurrent requests resolve
  4. Files-module relations registry collects every module's `fileRelations` declaration at boot via the registry wiring from Phase 24; sign-upload looks up the relation by `(ownerModule, kind)` and rejects unknown pairs with HTTP 400
  5. Cross-module file logic uses `TypedEventBus` only — no direct imports between `packages/modules/files/` and any other module (verified by Biome import-graph rule); module-author DX is one `fileRelations` object on the descriptor
**Plans:** 1/1 complete — executed from `26-PLAN-CONTRACT.md` (LOCKED). Complete (fully verified against live Postgres — Docker up). `packages/modules/files/` stood up (billing as analog): atomic conditional-UPDATE `reserveQuota`/`releaseQuota`, `buildStorageKey()` with mandatory `nanoid(24)`, `signUpload` command + `/api/files/sign-upload` route (quota_exceeded→413, else→400), tenant.created hook (idempotent `tenant_storage_usage` row), `fileRelationsRegistry` wired to boot, and a cross-module-import ban gate. `DATABASE_URL=… bun test packages/modules/files` → 22 pass / 0 fail; SC#3 50-concurrent race at 95% quota → accepted=25=headroom, rejected=25, final used+pending=limit exactly (zero over-allocation). Adversarial review: 0 blockers.
**UI hint:** no

#### Phase 27: Complete-Upload + Signed Read URLs + Delete + Generic Attachments

**Goal:** Close the synchronous upload loop — server-authoritative size verification on `/complete`, magic-byte MIME check, signed read URLs minted per-request, soft-delete with cascade-via-events, and the generic `attachFile`/`list-files-for-record` API for any module to attach files to its records.
**Depends on:** Phase 26
**Requirements:** UPL-02, UPL-04, ATT-01, ATT-02, MOD-03
**Success Criteria** (what must be TRUE):
  1. Frontend can `POST /api/files/:fileId/complete` after the direct PUT and the server `HEAD`s S3 to read the **authoritative** `byte_size` (never the client's claim); `file-type` magic-byte check on the first 4KB rejects MIME mismatches by deleting the storage object + DB row + decrementing `bytes_pending`
  2. Frontend calling `GET /api/files/:fileId/read-url` receives a short-lived (5–15 min, env-configurable via `STORAGE_SIGNED_URL_TTL_SEC`) signed GET URL; raw `storage_key` NEVER appears in any API response (asserted by integration test scanning all `/api/files/*` JSON responses)
  3. Module author can call `attachFile(ctx, { ownerModule, ownerRecordType, ownerRecordId, fileId })` server-side; `GET /api/files/list-for-record?ownerModule=X&recordId=Y` returns the file list with per-relation `canRead` hooks enforcing access; cross-tenant attempt returns 404 (not 403, to avoid existence leak)
  4. Authorized user can `DELETE /api/files/:fileId` and the storage object + DB row are removed atomically (soft-delete pattern preserves audit trail); `tenant_storage_usage.bytes_used` decrements; `file.deleted` event emitted on TypedEventBus
  5. Cascade-on-delete works via event subscription — deleting a user fires `auth.user-deleted`, the files module subscribes and soft-deletes the user's owned files per the relation's `onDelete: 'cascade'` setting; orphan reconciliation job (Phase 31) sweeps any whose `(ownerModule, ownerRecordId)` no longer resolves
**Plans:** TBD (populated by /gsd:plan-phase 27)
**UI hint:** no

#### Phase 28: Image Transform Pipeline (sharp spike + imagescript fallback)

**Goal:** Ship async image variant generation via BullMQ — sharp as the default `ImageTransform` adapter (with verified Bun+Docker compatibility) and `imagescript` as the wired fallback selectable via env, with decompression-bomb protections enforced before any image hits the transform worker.
**Depends on:** Phase 26 (can branch in parallel with Phase 27 once Phase 25 conformance suite is green; final integration depends on Phase 27 `complete-upload` event)
**Requirements:** IMG-01, IMG-02, IMG-03
**Success Criteria** (what must be TRUE):
  1. **Phase-entry research spike (S-1) is GREEN before any other work begins:** operator runs the smoke test `bun test packages/storage/src/adapters/sharp/__smoke__/bun-docker-spike.test.ts` inside the target Docker image (`oven/bun:1-debian-slim` x64 + arm64) and sharp resizes the baseline fixture without native-binding errors. If RED, the phase pivots to making `imagescript` the default and the spike documents the failure mode in `docs/integrations/file-storage.md` — phase MUST NOT proceed with sharp as default until this gate passes
  2. Operator setting `IMAGE_TRANSFORM_PROVIDER=sharp|imagescript` sees the factory return the selected adapter; both adapters pass a shared conformance suite covering resize + WebP output + EXIF strip + metadata extraction (mirrors Phase 25 storage-adapter parity)
  3. After a `file.uploaded` event for an image with declared `generateVariants`, a BullMQ `image-transform` job runs on the `image-transform` queue; consumer-side trace propagation reuses the Phase 20 wrapper so a single trace spans API → enqueue → transform worker; variant files are written and recorded in `files.transforms` jsonb manifest with deterministic keys
  4. Decompression-bomb prevention is enforced at three layers: (a) `image/*` >20MB rejected at `/complete` before sharp processes it; (b) sharp `limitInputPixels: 50_000_000` + `failOn: "warning"` set on every transform; (c) pre-flight `metadata()` check rejects files >50M pixels — proven by the 50000×50000 fixture from Phase 25 returning HTTP 413 + structured error
  5. EXIF strip verified on every variant (round-trip test reads metadata from a transformed output and asserts no GPS/camera-model fields); transform worker `concurrency: 2` capped to keep memory bounded; failed transforms emit `file.transform-failed` event without crashing the worker
**Plans:** TBD (populated by /gsd:plan-phase 28)
**UI hint:** no

#### Phase 29: Auth & Org Identity Asset Wiring

**Goal:** Wire the first real consumers — user avatars and org logos flow through the auth module's declared `fileRelations`, validating cross-module decoupling end-to-end via the polymorphic association pattern.
**Depends on:** Phase 27 + Phase 28
**Requirements:** IDA-01, IDA-02
**Success Criteria** (what must be TRUE):
  1. Customer-app user can navigate to `/profile`, drop an image into the avatar uploader, and see variants 64/128/256/512 px webp generated within seconds; `get-profile` query resolves `avatarUrl` from the latest `user`-kind file (denormalized accessor)
  2. Owner-role user can navigate to `/team/settings` and upload an org logo; variants 128/256 px webp generated; SVG uploads are **rejected** at sign-time with a clear error (security: XSS via `<script>` in SVG — Pitfall 10); only jpeg/png/webp accepted
  3. Auth module declares `fileRelations: { user, organization }` in its `ModuleDefinition`; the files module discovers them via the boot-time registry collection — there is **zero direct import** from `packages/modules/files/` into `packages/modules/auth/` and vice versa (verified by Biome import-graph rule)
  4. Replacing an avatar deletes the prior file (cascade-on-replace, not pile-up); `tenant_storage_usage.bytes_used` decrements correctly
**Plans:** TBD (populated by /gsd:plan-phase 29)
**UI hint:** yes

#### Phase 30: Reusable Uploader Component in packages/ui

**Goal:** Ship the `<FileUpload>` component + `useFileUpload` hook in `packages/ui` — drag-drop with progress, image preview, full error state coverage, i18n + a11y — and wire it into both the Next.js customer app and the Vite admin app.
**Depends on:** Phase 27 (sign+complete contract stable); benefits from Phase 28 (processing-state UX for variants)
**Requirements:** UI-01, UI-02
**Success Criteria** (what must be TRUE):
  1. Developer can `import { FileUpload, useFileUpload } from "@baseworks/ui"` and the component supports drag-drop + file-picker fallback, XHR upload progress (real bytes-uploaded, not synthetic), image preview via `URL.createObjectURL`, cancel/retry, and single + multi mode (opt-in via `multi` prop); `UploadDescriptor` `kind` discriminator switches between `s3-put`/`s3-post`/`local` flows
  2. Component renders correct error states for each failure mode: oversize (caught client-side before sign), wrong MIME (caught at `/complete`), quota exceeded (HTTP 413 from `/sign-upload`), network error (XHR failure with retry), and server-side magic-byte MIME mismatch (file deleted, user notified)
  3. Customer-app avatar page, customer-app org-logo page, and admin tenant-files browser all consume the same component without duplicating upload logic; admin app sees a tenant-files browser listing files via `list-files-for-record`
  4. Component ships translated en + pt-BR strings via `packages/i18n` (new `files` namespace); vitest-axe a11y test in `packages/ui` suite passes (drag-drop region has correct ARIA, error states announced via `aria-live`, keyboard-navigable picker fallback)
  5. `beforeunload` navigation guard fires while an upload is in-flight (prevents user navigating away mid-PUT and orphaning a pending file)
**Plans:** TBD (populated by /gsd:plan-phase 30)
**UI hint:** yes

#### Phase 31: Cleanup, Reconciliation & Operator Surface

**Goal:** Close the operational loop — quota observability surfaced in `/health/detailed`, scheduled cleanup jobs (pending uploads, orphan files, soft-deleted), nightly reconciliation, runbooks, Sentry alert templates, and integration docs (CORS templates, Docker base-image guidance, CDN/Cache-Control). Mirrors v1.3 Phase 23 closing rhythm.
**Depends on:** Phases 24-30 (everything)
**Requirements:** QUO-03, OPS-01, OPS-02, OPS-03
**Success Criteria** (what must be TRUE):
  1. `/health/detailed` registers a storage `HealthContributor` (Phase 22 worst-of-N rollup pattern) showing top-N tenants by `bytes_used`, % quota used per tenant, and aggregate adapter health (S3 reachable, Local disk-free); contributor responds within 5s cache window even when S3 is slow
  2. Operator can find 4 runbooks under `docs/runbooks/` (storage-quota-exceeded, image-transform-failure, s3-unreachable, orphan-files-detected) using the locked Trigger → Symptoms → Triage → Resolution → Escalation template; CI's `validate-docs.ts` 4th invariant (Phase 23) confirms `runbook_url` cross-link integrity from Sentry alert JSONs
  3. Operator can import 2+ Sentry alert JSON templates from `docs/alerts/sentry/` (storage-quota at 90% + 100%, image-transform-failure-rate); each alert has a `runbook_url` pointing at an existing `docs/runbooks/*.md` file (CI gate enforced)
  4. Operator can read `docs/integrations/file-storage.md` and find: per-backend CORS config templates (AWS S3, R2, MinIO, Garage), bucket lifecycle policy snippets (`AbortIncompleteMultipartUpload` 7d, `tmp/` 1d), CDN/Cache-Control guidance, and Docker base-image pin guidance for sharp (`oven/bun:1-debian-slim`, NOT Alpine)
  5. Scheduled cleanup jobs run on cron: `cleanup:reap-pending-uploads` hourly (DELETEs `pending` files >1h old + decrements `bytes_pending`), `cleanup:reap-orphan-files` daily (sweeps files whose owner record no longer resolves), `cleanup:reap-soft-deleted` weekly (hard-DELETEs storage objects + DB rows past retention), `quota:reconcile-tenant-usage` daily (rebuilds `bytes_used` from `SUM(byte_size)` for drift correction); job runs surfaced in `/health/detailed`
**Plans:** TBD (populated by /gsd:plan-phase 31)
**UI hint:** no

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation & Core Infrastructure | v1.0 | 3/3 | Complete | 2026-04-06 |
| 2. Auth & Multitenancy | v1.0 | 3/3 | Complete | 2026-04-06 |
| 3. Billing & Background Jobs | v1.0 | 4/4 | Complete | 2026-04-07 |
| 4. Frontend Applications | v1.0 | 3/3 | Complete | 2026-04-07 |
| 5. Production Hardening | v1.0 | 2/2 | Complete | 2026-04-08 |
| 6. Responsive Layouts | v1.1 | 3/3 | Complete | 2026-04-08 |
| 7. Accessibility | v1.1 | 4/4 | Complete | 2026-04-09 |
| 8. Internationalization | v1.1 | 3/3 | Complete | 2026-04-09 |
| 9. Team Invites | v1.1 | 5/5 | Complete | 2026-04-11 |
| 10. Payment Abstraction | v1.1 | 4/4 | Complete | 2026-04-11 |
| 11. Accessibility Gap Closure | v1.1 | 2/2 | Complete | 2026-04-14 |
| 12. i18n Hardcoded String Cleanup | v1.1 | 3/3 | Complete | 2026-04-14 |
| 13. JSDoc Annotations | v1.2 | 4/4 | Complete | 2026-04-16 |
| 14. Unit Tests | v1.2 | 6/6 | Complete | 2026-04-17 |
| 15. Developer Documentation | v1.2 | 6/6 | Complete | 2026-04-18 |
| 16. v1.2 Content Drift Fixes | v1.2 | 3/3 | Complete | 2026-04-19 |
| 17. Observability Ports & OTEL Bootstrap | v1.3 | 5/5 | Complete | 2026-04-22 |
| 18. Error Tracking Adapters | v1.3 | 7/7 | Complete | 2026-04-23 |
| 19. Context, Logging & HTTP/CQRS Tracing | v1.3 | 8/8 | Complete | 2026-04-23 |
| 20. BullMQ Trace Propagation | v1.3 | 3/3 | Complete | 2026-04-26 |
| 20.1. Close v1.3 milestone gaps | v1.3 | 4/4 | Complete | 2026-04-26 |
| 21. OTEL Adapters + Grafana Observability Stack | v1.3 | 0/0 | Deferred to v1.4+ | - |
| 22. Admin Ops Tooling | v1.3 | 6/6 | Complete | 2026-04-27 |
| 23. Runbooks, Alert Templates & Observability Docs | v1.3 | 5/5 | Complete | 2026-04-28 |
| 24. Foundation: Storage Port + Files Schema | v1.4 | 7/7 | Complete   | 2026-06-11 |
| 25. Test Infra + Three Storage Adapters | v1.4 | 1/1 | Complete (local-verified; S3/MinIO CI-gated) | 2026-06-16 |
| 26. Files Module + Sign-Upload + Quota | v1.4 | 1/1 | Complete (fully live-DB-verified) | 2026-06-16 |
| 27. Complete-Upload + Read + Delete + Attachments | v1.4 | 0/0 | Not started | - |
| 28. Image Transform Pipeline | v1.4 | 0/0 | Not started | - |
| 29. Auth + Org Identity Asset Wiring | v1.4 | 0/0 | Not started | - |
| 30. UI Uploader Component | v1.4 | 0/0 | Not started | - |
| 31. Cleanup + Operator Surface | v1.4 | 0/0 | Not started | - |
