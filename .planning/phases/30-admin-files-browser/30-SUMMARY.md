# Phase 30 — Admin Tenant-Files Browser + Admin Upload — SUMMARY

**Milestone:** v1.4 File Storage & Uploads
**Requirement:** UI-02 (admin browser + cross-app reuse)
**Status:** Complete (backend fully live-DB-verified + admin UI vitest green; full-browser E2E deferred to 30-HUMAN-UAT)
**Executed from:** `30-PLAN-CONTRACT.md` (single LOCKED contract, mirroring Phases 25–29)
**Date:** 2026-06-18

---

## Scope note (operator-locked, FULL)

Phase 30 delivers the ADMIN surface of the files module. The reusable
`<FileUpload>`/`useFileUpload` component shipped in Phase 29 and is FROZEN — Phase 30
CONSUMES it (in `multi` mode) and does NOT modify it. What Phase 30 adds:

1. Cross-tenant admin FILES operations for a PLATFORM admin acting on ANY tenant.
2. A generic `admin-attachment` `fileRelation`.
3. The `apps/admin` tenant-detail **Files** browser (list / view / delete + multi-upload).

---

## What was built

### 1. Cross-tenant admin files functions (files module)

`packages/modules/files/src/commands/admin-files.ts` (new) — five **plain async functions**
(NOT `defineCommand`/`defineQuery`, so there is no `ctx.tenantId` injection) that take an
**explicit `targetTenantId`** and trust it. Authorization is enforced at the gated admin
ROUTE (§2), never inside these functions — a platform admin has cross-tenant authority by
definition, so they DELIBERATELY bypass the per-relation `canRead`/`canWrite` hooks. All
return the repo `Result` shape; NONE return `storage_key`/`bucket`.

- **`adminListFilesForTenant(targetTenantId, { limit?, offset? })`** — tenant-WIDE list
  (every live file in the tenant: avatars, logos, admin-attachments), explicit column
  projection (NO `storage_key`/`bucket`), `ORDER BY created_at DESC`, `limit` default 50
  (cap 100), plus a `COUNT(*)` → `total`. Returns `AdminFileDto[]` with a convenience
  `variantCount` derived from the `transforms` jsonb manifest.
- **`adminSignUpload(targetTenantId, { mimeType, byteSize, originalFilename? })`** — looks up
  the `(files, admin-attachment)` relation; MIME allow-list + `maxByteSize` checks;
  `reserveQuota` charges the **TARGET** tenant; `buildStorageKey` puts the key under the
  TARGET tenant prefix; INSERTs a `pending` row with `owner_record_type="tenant"`,
  `owner_record_id=targetTenantId` (file auto-attached to the tenant record — no separate
  attach step); signs the upload with a ≤ 15 min TTL; full rollback (releaseQuota + delete
  pending row) on any storage failure, never echoing the raw DB error.
- **`adminCompleteUpload(targetTenantId, fileId)`** — server-authoritative finalize scoped to
  the target tenant: `stat()` authoritative size, magic-byte verify, per-relation cap, the
  layer-(a) image > 20 MB cap, `markUploaded` (pending→used), hard cleanup on reject. On
  success it calls the extracted `enqueueTransform({ fileId, tenantId: targetTenantId })` (§3)
  so image variants generate for the admin path too.
- **`adminGetReadUrl(targetTenantId, fileId)`** — tenant-scoped raw load (0 rows ⇒
  `not_found`), short-lived signed GET via `signRead` with `responseContentDisposition` from
  `dispositionFor`. Returns `{ url, expiresAt }` only. Bypasses `canRead` (admin authority).
- **`adminDeleteFile(targetTenantId, fileId)`** — tenant-scoped SOFT delete inside a tx
  (`SELECT … FOR UPDATE` → `softDeleteRow`), refunding own + variant bytes through the SAME
  `lib/soft-delete.ts` path as `delete-file`; best-effort `storage.delete` after commit.

Reuse map (no logic duplicated): `reserveQuota`/`releaseQuota`/`markUploaded`/`decrementUsed`
(quota), `buildStorageKey`/`resolveBucket` (key), `stat`+`verifyMagicBytes`+the image-20 MB
predicate (finalize), `softDeleteRow` (single conservation code path), `dispositionFor`
(content disposition). All five are exported from `packages/modules/files/src/index.ts`; the
host (apps/api) imports them directly — module↔module import ban untouched.

### 2. `admin-attachment` fileRelation (collected at boot)

Declared on the files module's OWN `ModuleDefinition`
(`packages/modules/files/src/index.ts`, new `fileRelations` field, `adminAttachmentRelation`),
so the existing boot-time `collectFileRelations` walk collects it into `fileRelationsRegistry`
keyed `(ownerModule="files", kind="admin-attachment")` — the SAME mechanism that collects
auth's `user`/`organization` relations. No apps/api boot change. Spec:

- `recordType: "tenant"`; allow-list `image/jpeg | image/png | image/webp | application/pdf`
  (images + pdf, **NO svg**, **NO gif**); `maxByteSize` 10 MiB; `generateVariants`
  `[{ name: "thumb-256", width: 256, format: "webp" }]`; `cardinality: "many"` (admin
  attachments pile up); `onDelete: "orphan"` (Phase 31 reconciles).
- `canRead`/`canWrite` = `false` — **defense-in-depth**: even though the relation is globally
  registered, a non-admin who signs an `admin-attachment` file in their OWN tenant via the
  public `/api/files/*` routes can never READ it back or ATTACH it. The admin functions bypass
  hooks, so admin is unaffected. SVG/GIF excluded keeps the transform source on the proven
  sharp raster path and closes the librsvg SSRF surface; PDF is allowed but won't match the
  image MIME gate → no transform (correct).

### 3. Transform-enqueue extraction (shared by public + admin paths)

`packages/modules/files/src/hooks/on-tenant-created.ts` — the gated enqueue body
(`createQueue("image-transform").add(…)`, the GATE-1 raster-MIME, GATE-2 `generateVariants`,
the no-Redis silent skip, the try/catch + ErrorTracker — all unchanged) was extracted into a
single exported `enqueueTransform({ fileId, tenantId })`. The `file.completed` subscriber now
delegates to it (behaviour identical — `enqueue-on-completed.test.ts` still green), and
`adminCompleteUpload` calls it directly. No registry-event-bus plumbing into `admin.ts`, no
duplicated enqueue logic — this satisfies the GOAL "uploads (images) transform into variants
and appear in the list" for the admin path.

### 4. Admin routes (apps/api)

`apps/api/src/routes/admin.ts` — five routes added to the existing `adminRoutes` plugin, which
already does `.use(requirePlatformAdmin())` ONCE at the top, so every files route inherits the
platform-admin gate. `:id` is the TARGET tenant in every route:

```
GET    /api/admin/tenants/:id/files                    → adminListFilesForTenant(:id, {limit,offset})
POST   /api/admin/tenants/:id/files/sign-upload        → verify tenant exists → adminSignUpload(:id, body)
POST   /api/admin/tenants/:id/files/:fileId/complete   → adminCompleteUpload(:id, :fileId)
GET    /api/admin/tenants/:id/files/:fileId/read-url   → adminGetReadUrl(:id, :fileId)
DELETE /api/admin/tenants/:id/files/:fileId            → adminDeleteFile(:id, :fileId)
```

The sign-upload TypeBox body is `{ mimeType, byteSize, originalFilename? }` — there is **NO
`tenantId` field to trust**; `kind` is fixed server-side to `admin-attachment`. The sign route
verifies `organization` existence (→ 404 `TENANT_NOT_FOUND`) before reserving quota, so a
non-existent target never creates an orphan `tenant_storage_usage` row. Error→HTTP mapping:
`not_found → 404`, `quota_exceeded | file_too_large | image_too_large → 413`, else → 400.

### 5. apps/admin Files browser (tenant detail)

- `apps/admin/src/lib/file-upload-adapters.ts` (new) — `makeAdminSign(tenantId)` /
  `makeAdminComplete(tenantId)` (point `<FileUpload>` at the admin endpoints, map the envelope
  `method==="POST" && fields → s3-post` else `s3-put` into `UploadDescriptor`, 413 →
  `quota_exceeded`), `buildFileUploadLabels(t)` from the Phase-29 `files` namespace, plus
  `ADMIN_ACCEPT` + `ADMIN_MAX_BYTES` (10 MiB) client-side pre-checks (server re-enforces).
- `apps/admin/src/routes/tenants/detail.tsx` (edit) — a full-width **Files** `Card`:
  - **Upload zone:** `<FileUpload multi maxFiles={10} accept complete sign onUploaded … />`
    wired to the admin adapters; the frozen component already handles drag-drop + picker
    fallback, real XHR progress, preview, cancel/retry, `beforeunload`, and a11y.
  - **List:** React Query (`["admin","tenants",id,"files"]`) → table with name
    (`originalFilename ?? fileId`), type, size (formatted), status `Badge` (+ variant count
    when ready), created (`formatDistanceToNow`), actions. Bounded `refetchInterval` (3 s
    while any row is `uploaded`/`transforming`, stops at terminal status) so async webp
    thumbnails surface without a manual reload.
  - **View:** `adminGetReadUrl` → `window.open(url, "_blank", "noopener,noreferrer")`;
    disabled while `status === "pending"`.
  - **Delete:** shadcn confirm `Dialog` (focus-trapped, labelled) → `adminDeleteFile` mutation
    → toast + query invalidation.
  - a11y: action buttons carry interpolated `aria-label`s; dialog uses
    `DialogTitle`/`DialogDescription`.
- `apps/admin/src/lib/i18n.ts` (edit) — registers the existing `files` namespace (en + pt-BR)
  so `useTranslation("files")` resolves the `<FileUpload>` labels.
- `packages/i18n/src/locales/{en,pt-BR}/admin.json` (edit) — `tenants.detail.files.*` keys
  (title/empty/upload, column headers, view/delete/variants, status.*, deleteDialog.*,
  toast.*) in both locales.

---

## Authorization model (cross-tenant admin write — the security keystone)

- **Mount-level gate:** all five routes sit on `adminRoutes`, behind a single
  `.use(requirePlatformAdmin())`. `requirePlatformAdmin()` (auth/middleware.ts) resolves the
  better-auth session → no session ⇒ 401; authorizes ONLY when
  `session.user.email.toLowerCase()` ∈ `getAdminEmails()` (`ADMIN_EMAILS` allowlist) ⇒ else
  403. It does **NOT** consult `activeOrganizationId` or membership role — a per-organization
  **owner** is NEVER conflated with a platform operator. An org owner of tenant X gets 403 just
  like any member.
- **Target tenant from the gated path ONLY:** every route derives `targetTenantId` from
  `ctx.params.id`. The request body carries NO `tenantId` field, closing the confused-deputy
  hole (admin cannot be tricked into acting on tenant B while the URL says A).
- **Public surface stays caller-scoped:** the original `/api/files/*` routes call the
  unchanged ctx-tenant-scoped commands (`ctx.tenantId` from the caller's own session) and can
  never address another tenant; the `admin-attachment` relation's `canRead`/`canWrite=false`
  deny it on that public surface.
- **Quota** is charged to `targetTenantId` (the path tenant), never the admin's own tenant.
- `storage_key`/`bucket` NEVER appear in any response; `buildStorageKey` (no path traversal)
  is the only key constructor.

---

## Files touched

**New**
- `packages/modules/files/src/commands/admin-files.ts` — 5 cross-tenant fns + `AdminFileDto`.
- `packages/modules/files/src/__tests__/admin-files.test.ts` — bun:test, live DB.
- `apps/admin/src/lib/file-upload-adapters.ts` — admin sign/complete adapters + labels.
- `apps/admin/src/routes/tenants/detail.files.test.tsx` — vitest (jobs.test.tsx pattern).

**Edited**
- `packages/modules/files/src/index.ts` — `fileRelations: { "admin-attachment" }` +
  `adminAttachmentRelation`; export the 5 admin fns + `enqueueTransform`.
- `packages/modules/files/src/hooks/on-tenant-created.ts` — extract + export
  `enqueueTransform`; subscriber delegates to it.
- `packages/modules/files/src/hooks/__tests__/enqueue-on-completed.test.ts` — track the
  extracted helper.
- `apps/api/src/routes/admin.ts` — 5 files routes behind the existing `requirePlatformAdmin()`.
- `apps/api/src/__tests__/admin-auth.test.ts` — extend the gate matrix to the new endpoints.
- `apps/admin/src/routes/tenants/detail.tsx` — the Files card.
- `apps/admin/src/lib/i18n.ts` — register the `files` namespace.
- `packages/i18n/src/locales/en/admin.json` + `…/pt-BR/admin.json` — `tenants.detail.files.*`.

**Planning**
- `30-PLAN-CONTRACT.md`, `30-HUMAN-UAT.md`, `30-SUMMARY.md`, `30-VERIFICATION.md`.

`bun biome check --write` applied to every touched file.

---

## Verification split — automated vs HUMAN-UAT

| Surface | Where it ran |
|---|---|
| Cross-tenant admin fns: target-tenant charge, key prefix, isolation, no-key-leak, refund, read-url, quota, enqueue | Local (live DB) — `admin-files.test.ts` 8 pass / 0 fail (40 expects) |
| Full files module regression (incl. extracted `enqueueTransform`) | Local (live DB) — 98 pass / 0 fail (370 expects) |
| Admin-route platform-admin gate (401/403 across all 5 new endpoints) | Local — `admin-auth.test.ts` 14 pass / 0 fail |
| Admin Files browser (list rows, status + variant count, view → read-url + window.open, delete dialog + invalidate, empty/error, accessible uploader) | Local — `detail.files.test.tsx` 7 pass (admin suite 27/27) |
| `admin-attachment` relation collected at boot | covered by `admin-files.test.ts` sign-path (relation lookup resolves) |
| **Full-browser E2E** (real drag-upload as admin, watch webp thumbnail land, delete confirm, org-owner 403) | **HUMAN-UAT-pending** — `30-HUMAN-UAT.md` |

The admin `tsc -b && vite build` surfaces the PRE-EXISTING repo-wide tsc project-reference /
`rootDir` state (`Cannot find module '@baseworks/module-auth' | '@baseworks/module-files' |
'@baseworks/config' | 'ioredis'`) — the same class of cross-package resolution errors logged
in the STATE decisions for Phase 24, affecting `apps/api/src/index.ts`,
`packages/observability/src/lib/scrub-pii.ts`, etc., NOT Phase 30 source. The admin UI is
verified through `vitest` (27/27, the contract's named admin-UI gate). `bun run test` (root,
per-root isolation) stays green.

---

## Adversarial review outcome — 0 blockers + 3 warnings, addressed

**Blockers:** none.

**Warnings**
1. **Globally-registered `admin-attachment` is publicly signable (R2).** A non-admin could
   `POST /api/files/sign-upload {ownerModule:"files",kind:"admin-attachment"}` in their OWN
   tenant (cannot target another — `ctx.tenantId` is theirs). Blast radius: one orphan pending
   file in their own tenant/quota. Hardened by `canRead`/`canWrite = false` (public read +
   attach denied) and Phase 31 orphan sweep; documented + accepted for the starter.
2. **storage_key/bucket leak risk on the new list/read DTOs (R4).** Resolved by explicit
   column projection (no `SELECT *`) and a verification test that scans every admin response
   (field names + raw substring) for `storage_key`/`bucket` —
   `admin-files.test.ts (c)` green.
3. **Async-variant visibility / unbounded polling (R7).** Variants appear only after the
   BullMQ worker runs (needs Redis). Resolved with a bounded `refetchInterval` that STOPS once
   every row reaches a terminal status (`ready`/`deleted`); with no worker the file still lists
   as `uploaded` (no crash). Documented.

Plus the R1 cross-tenant-authz invariant verified head-on by `admin-auth.test.ts` (no-session
→ 401, non-allowlisted session incl. org owner → 403 across all 5 endpoints) and the
target-tenant charge/isolation by `admin-files.test.ts` (a)/(b)/(f).
