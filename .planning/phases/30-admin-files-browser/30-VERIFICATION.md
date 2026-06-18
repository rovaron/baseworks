# Phase 30 — Admin Tenant-Files Browser + Admin Upload — VERIFICATION

**Milestone:** v1.4 · **Requirement:** UI-02 (admin browser + cross-app reuse)
**Date:** 2026-06-18 · **Runners:** `bun test` (Bun 1.3.14, live Postgres + Redis) · `vitest` (apps/admin)

## Test-run evidence (commands + results)

| Command | Result |
|---|---|
| `DATABASE_URL=… REDIS_URL=… bun test packages/modules/files/src/__tests__/admin-files.test.ts` | **8 pass / 0 fail** (40 expects) |
| `DATABASE_URL=… REDIS_URL=… bun test packages/modules/files` (full module regression) | **98 pass / 0 fail** (370 expects, 16 files) |
| `DATABASE_URL=… REDIS_URL=… bun test apps/api/src/__tests__/admin-auth.test.ts` | **14 pass / 0 fail** |
| `cd apps/admin && bun run test` (vitest) | **27 pass / 0 fail** (3 files; `detail.files.test.tsx` = 7 tests) |
| `cd apps/admin && bun run build` (`tsc -b && vite build`) | `tsc -b` surfaces PRE-EXISTING cross-package module-resolution errors (see build note) — admin UI verified via vitest |
| `bun run test` (root, per-root isolation) | green |

---

## Deliverable 1 — Cross-tenant admin files functions (explicit `targetTenantId`)

**Evidence — `admin-files.test.ts` (live DB, 8/8):**
- `(a) sign+complete charge the TARGET tenant's bytes_used; key under target prefix` —
  `adminSignUpload(A,…)`+`adminCompleteUpload(A,…)` move tenant **A**'s `bytes_used`, NOT a
  caller tenant; storage key prefixed `A/files/admin-attachment/…`.
- `(b) list is tenant-isolated — A's file is invisible to B` —
  `adminListFilesForTenant(B)` does not see A's file (cross-tenant isolation).
- `(c) NO admin response carries storage_key / bucket (field + raw-key scan)` — every admin
  function's JSON scanned for both field names and the raw key substring.
- `(d) delete refunds bytes_used incl. variant bytes (softDeleteRow)` — shared
  `lib/soft-delete.ts` conservation path.
- `(e) read-url returns {url,expiresAt} only and bypasses canRead===false` — admin authority
  reads a relation whose public `canRead` is `false`.
- `(f) quota_exceeded on a tenant at limit` — `err("quota_exceeded")` when the target is full.
- `(g) image complete wires the transform enqueue` — `enqueueTransform` invoked (spy) on image
  complete.
- `mime not allowed ⇒ err('mime_not_allowed'); oversize ⇒ err('file_too_large')` — sign-time
  allow-list + `maxByteSize` gates.

The five functions are exported from `packages/modules/files/src/index.ts`
(`adminListFilesForTenant`, `adminSignUpload`, `adminCompleteUpload`, `adminGetReadUrl`,
`adminDeleteFile`); the host imports them directly. **Status:** ✅ MET.

---

## Deliverable 2 — `admin-attachment` fileRelation collected at boot

**Evidence:**
- `packages/modules/files/src/index.ts` declares `fileRelations: { "admin-attachment":
  adminAttachmentRelation }` on the module's `ModuleDefinition` → collected by the existing
  boot-time `collectFileRelations` into `fileRelationsRegistry` keyed
  `(files, admin-attachment)`.
- Proven transitively by `admin-files.test.ts (a)`/`(f)` and the
  `mime_not_allowed`/`file_too_large` test: `adminSignUpload` resolves the relation
  (`fileRelationsRegistry.get("files","admin-attachment")`) and enforces its allow-list
  (`image/jpeg|png|webp` + `application/pdf`, NO svg/gif) + 10 MiB cap — the sign path would
  `err("unknown_relation")` if the boot collection had not registered it.
- `canRead`/`canWrite = false` defends the public `/api/files/*` surface.

**Status:** ✅ MET.

---

## Deliverable 3 — Admin routes behind `requirePlatformAdmin()`, target tenant from `:id`

**Evidence — `admin-auth.test.ts` (14/14):** parametrized gate matrix asserts every new
endpoint —
`GET /tenants/:id/files`, `POST /tenants/:id/files/sign-upload`,
`POST /tenants/:id/files/:fileId/complete`, `GET /tenants/:id/files/:fileId/read-url`,
`DELETE /tenants/:id/files/:fileId` — rejects unauthenticated requests (401) and
non-allowlisted sessions (403), inheriting the single `.use(requirePlatformAdmin())` on
`adminRoutes`. The gate authorizes on the `ADMIN_EMAILS` allowlist only — membership role is
irrelevant, so an org **owner** is denied like any member.

- Target tenant is read from `ctx.params.id` only; the sign-upload body is
  `{ mimeType, byteSize, originalFilename? }` with **no `tenantId` field** (confused-deputy
  closed). `kind` fixed server-side to `admin-attachment`.
- The sign route verifies `organization` existence → 404 `TENANT_NOT_FOUND` before reserving
  quota (no orphan `tenant_storage_usage` row).
- Error→HTTP mapping enforced: `not_found → 404`,
  `quota_exceeded | file_too_large | image_too_large → 413`, else → 400.

**Status:** ✅ MET (gate + derivation). Live authenticated cross-tenant flow → HUMAN-UAT.

---

## Deliverable 4 — apps/admin tenant-detail Files browser (list / view / delete + `<FileUpload multi>`)

**Evidence — `detail.files.test.tsx` (vitest, 7 tests, within admin 27/27):**
- `uploader renders accessibly with an aria-label` — `<FileUpload multi>` mounts with the
  admin adapters + accessible labelling.
- `shows empty state when the tenant has no files` — i18n empty state.
- `renders a row per file with name, type and status + variant count` — table projection +
  status `Badge` + `variantCount`.
- `view action opens the signed read-url in a new tab` — `adminGetReadUrl` →
  `window.open(url, "_blank", …)`.
- `view action is disabled while a file is pending` — guarded action.
- `delete confirm dialog calls adminDeleteFile then closes` — focus-trapped confirm `Dialog`
  → mutation → invalidation.
- `load error renders the i18n load-error message` — query-error path.

Async-variant visibility: the list query's bounded `refetchInterval` (3 s while any row is
`uploaded`/`transforming`, stops at terminal status) surfaces the webp thumbnail +
`variantCount` after the BullMQ worker runs, without a manual reload. i18n: `files` namespace
registered in `apps/admin/src/lib/i18n.ts`; `tenants.detail.files.*` keys added to en + pt-BR
`admin.json`. a11y: the frozen `<FileUpload>` already ships aria-live errors + keyboard
dropzone; new action buttons carry interpolated `aria-label`s and the delete dialog is
labelled.

**Status:** ✅ MET (component + wiring under vitest). Real OS drag-upload + watching variants
land in the browser → HUMAN-UAT.

---

## Build note

`cd apps/admin && bun run build` runs `tsc -b && vite build`. The `tsc -b` step surfaces
PRE-EXISTING repo-wide cross-package resolution errors —
`Cannot find module '@baseworks/module-auth' | '@baseworks/module-files' |
'@baseworks/config' | 'ioredis'` in `apps/api/src/index.ts`, `apps/api/src/routes/admin.ts`
(module-resolution, not a type error in the new route code),
`packages/observability/src/lib/scrub-pii.ts`, etc. This is the same project-reference /
`rootDir` workspace state logged in the STATE decisions at Phase 24 (132 errors), NOT
introduced by Phase 30. The admin UI behaviour is therefore verified through `vitest` (27/27,
the contract §9 named admin-UI gate) rather than the type-build, mirroring how Phase 29
verified apps/web against `build:web`'s pre-existing prerender bailout.

---

## Summary

| Deliverable | Requirement | Automated | HUMAN-UAT |
|---|---|---|---|
| 1. Cross-tenant admin files fns (target-tenant scope, no key leak, refund, quota) | UI-02 | ✅ `admin-files.test.ts` 8/8 + module 98/0 | — |
| 2. `admin-attachment` relation collected at boot | UI-02 | ✅ (relation lookup resolves in sign path) | — |
| 3. Admin routes behind `requirePlatformAdmin()`, tenant from `:id` | UI-02 (security) | ✅ `admin-auth.test.ts` 14/14 | authenticated cross-tenant flow |
| 4. apps/admin Files browser + `<FileUpload multi>` | UI-02 | ✅ `detail.files.test.tsx` 7 (admin 27/27) | real drag-upload, variants land, delete confirm, org-owner 403 |

**All deliverables met by automated evidence.** Browser-E2E items are HUMAN-UAT-pending in
`30-HUMAN-UAT.md` (fragile in-workflow, not a blocking gate per contract §9). No open blockers.
