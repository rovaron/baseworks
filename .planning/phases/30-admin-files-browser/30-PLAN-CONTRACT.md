# Phase 30 — Admin Tenant-Files Browser + Admin Upload — LOCKED PLAN CONTRACT

Milestone: v1.4 File Storage & Uploads. Requirement: **UI-02** (admin browser + cross-app reuse).
Scope (operator-locked, FULL): cross-tenant admin FILES ops for a PLATFORM admin acting on ANY tenant,
a generic `admin-attachment` fileRelation, and the apps/admin tenant-detail **Files** browser that
lists/views/deletes a tenant's files AND uploads via `<FileUpload multi>` (shipped Phase 29).

The `<FileUpload>`/`useFileUpload` component is FROZEN (Phase 29, `packages/ui`). Phase 30 consumes it; it
does NOT modify it.

---

## 0. Invariants (carried from Phases 24–29 — do NOT break)

- `storage_key` / `bucket` NEVER appear in any API response. `buildStorageKey()` is the ONLY key constructor.
- Direct `files` / `tenant_storage_usage` table access is ALLOW-LISTED only inside `packages/modules/files/`.
  Reads use raw `db.execute(sql\`…\`)` (the `db.select().from(files)` builder is banned repo-wide by the
  GritQL/grep gate); writes use `db.update/db.delete(files)` builders. Every statement carries an explicit
  `tenant_id` predicate.
- Quota conservation: `reserveQuota` (pending) → `markUploaded` (pending→used) → `softDeleteRow`/`decrementUsed`
  (refund). Reuse these primitives unchanged — admin paths only swap the tenant argument.
- Cross-module import ban stays green: apps/api (host) MAY import `@baseworks/module-files` directly
  (registry.ts/index.ts already do); module↔module imports remain forbidden.
- `bun run test` stays green; per-root isolation + `mock.module` is process-global (see §10).

---

## 1. Cross-tenant admin files functions (files module)

New file: `packages/modules/files/src/commands/admin-files.ts`. These are **plain async functions** that take
an **explicit `targetTenantId`** (NOT a `HandlerContext.tenantId`). They are NOT `defineCommand`/`defineQuery`
(no ctx tenant injection) — that is the whole point: the caller (the gated admin route) supplies the target
tenant from the path, the function trusts it. Authorization lives at the route (§2), NOT in these functions.
They reuse `lib/quota`, `lib/build-storage-key`, `lib/soft-delete`, `lib/relation-lookup`, and the extracted
`enqueueTransform` (§3). They DELIBERATELY bypass per-relation `canRead`/`canWrite` hooks — a platform admin
has cross-tenant authority by definition.

All return the repo `Result` shape (`ok()/err()` from `@baseworks/shared`). NONE return `storage_key`/`bucket`.

```ts
// Header doc: "Phase 30 / UI-02 — cross-tenant admin files operations. Caller MUST be platform-admin-gated
//             (apps/api admin route). targetTenantId is the gated :id path param, never a client body field."

const ADMIN_OWNER_MODULE = "files";
const ADMIN_KIND = "admin-attachment";
const ADMIN_RECORD_TYPE = "tenant";          // = files.owner_record_type for admin uploads
const ADMIN_SIGN_TTL_SEC = 900;              // ≤ 15 min ceiling (mirror sign-upload)

export type AdminFileDto = {
  fileId: string;
  ownerModule: string;
  ownerRecordType: string;
  ownerRecordId: string;
  mimeType: string;
  byteSize: number;
  status: string;                            // pending|uploaded|transforming|ready|deleted
  originalFilename: string | null;
  transforms: unknown;                       // jsonb manifest (variant count derivable client-side)
  variantCount: number;                      // convenience: (transforms ?? []).length
  createdAt: Date;
  uploadedByUserId: string | null;
};

// LIST — tenant-WIDE (NOT owner-record-scoped). Shows EVERY live file in the tenant (avatars, logos,
// admin-attachments) so the operator sees the full surface. NO storage_key/bucket in the projection.
export async function adminListFilesForTenant(
  targetTenantId: string,
  opts?: { limit?: number; offset?: number },
): Promise<Result<{ files: AdminFileDto[]; total: number }>>;
//   raw SQL:  SELECT id, owner_module, owner_record_type, owner_record_id, mime_type, byte_size, status,
//                    original_filename, transforms, created_at, uploaded_by_user_id
//               FROM files WHERE tenant_id = ${targetTenantId} AND deleted_at IS NULL
//              ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
//   + a COUNT(*) for the same predicate → total. limit default 50 (cap 100), offset default 0.

// SIGN — charges the TARGET tenant quota; key + row under the TARGET tenant; owner_record_id = targetTenantId
// (the file is auto-attached to the tenant record itself → no separate attach step for admin uploads).
export async function adminSignUpload(
  targetTenantId: string,
  input: { mimeType: string; byteSize: number; originalFilename?: string },
): Promise<Result<{ fileId: string; method: string; url: string;
                    headers?: Record<string,string>; fields?: Record<string,string>; expiresAt: string }>>;
//   1. relation = fileRelationsRegistry.get(ADMIN_OWNER_MODULE, ADMIN_KIND)  (§4)  → !relation ⇒ err("unknown_relation")
//   2. !relation.allowedMimeTypes.includes(mimeType)  ⇒ err("mime_not_allowed")
//   3. byteSize > relation.maxByteSize                ⇒ err("file_too_large")
//   4. reserveQuota(db, targetTenantId, byteSize, env.STORAGE_DEFAULT_QUOTA_BYTES) → false ⇒ err("quota_exceeded")
//   5. buildStorageKey({ tenantId: targetTenantId, ownerModule: ADMIN_OWNER_MODULE, kind: ADMIN_KIND, mimeType })
//   6. INSERT pending files row: tenant_id=targetTenantId, owner_module=files, owner_record_type=tenant,
//      owner_record_id=targetTenantId, original_filename=originalFilename ?? null, uploaded_by_user_id=null
//      (admin context has no per-tenant userId; route MAY pass the admin id — see §2 note).
//   7. getFileStorage().signUpload(... expiresInSec: ADMIN_SIGN_TTL_SEC). Same rollback try/catch as
//      sign-upload.ts (releaseQuota + delete pending row on any failure; NEVER echo the raw DB error).

// COMPLETE — server-authoritative finalize for the TARGET tenant. Identical logic to complete-upload.ts but
// tenant-scoped to targetTenantId; on success it calls enqueueTransform (§3) so image variants generate.
export async function adminCompleteUpload(
  targetTenantId: string, fileId: string,
): Promise<Result<{ fileId: string; status: string; byteSize: number; mimeType: string }>>;
//   reuses: stat() authoritative size, verifyMagicBytes, per-relation maxByteSize cap, image>20MB layer-(a)
//   cap, markUploaded (pending→used), reject() hard-cleanup. AFTER success: await enqueueTransform({fileId,
//   tenantId: targetTenantId}). (We do NOT thread the registry event bus into admin.ts — §3.)

// READ URL — short-lived signed GET for ANY file in the target tenant. Bypasses canRead (admin authority).
export async function adminGetReadUrl(
  targetTenantId: string, fileId: string,
): Promise<Result<{ url: string; expiresAt: string }>>;
//   raw load tenant-scoped (tenant_id = targetTenantId, deleted_at IS NULL) → 0 rows ⇒ err("not_found");
//   getFileStorage().signRead(..., expiresInSec: env.STORAGE_SIGNED_URL_TTL_SEC, responseContentDisposition:
//   dispositionFor({mimeType, originalFilename})). Returns { url, expiresAt } only.

// DELETE — tenant-scoped SOFT delete for ANY file in the target tenant. Reuses softDeleteRow (shared refund).
export async function adminDeleteFile(
  targetTenantId: string, fileId: string,
): Promise<Result<{ fileId: string; deleted: true }>>;
//   db.transaction: SELECT … FOR UPDATE (raw, tenant_id=targetTenantId, deleted_at IS NULL) → null ⇒
//   err("not_found"); else softDeleteRow(tx, targetTenantId, prior). AFTER commit: best-effort
//   storage.delete(captured) + (optional) emit file.deleted. Matches delete-file.ts R7 ordering.
```

Reuse map (no logic duplicated):
- quota: `reserveQuota` / `releaseQuota` / `markUploaded` / `decrementUsed` (via `softDeleteRow`).
- key: `buildStorageKey` + `resolveBucket`.
- finalize: `stat` + `verifyMagicBytes` + the layer-(a) image>20MB cap (copied predicate, same constant).
- soft-delete: `softDeleteRow` (single conservation code path; refunds own + variant bytes).
- relation recovery: `findRelationByRecordType` / `dispositionFor`.

Exported from `packages/modules/files/src/index.ts` (host imports). The default `ModuleDefinition` export is
unchanged except for the new `fileRelations` (§4).

---

## 2. AUTHZ model — platform-admin only, target tenant from the gated path ONLY

Routes added in `apps/api/src/routes/admin.ts`, which is the `Elysia({ prefix: "/api/admin" })` plugin that
already does `.use(requirePlatformAdmin())` ONCE at the top. Every route on that plugin — including the new
files routes — therefore inherits the platform-admin gate. `requirePlatformAdmin()` (auth/middleware.ts):

1. resolves the better-auth session from request headers → no session ⇒ `UnauthorizedError` (401);
2. authorizes ONLY when `session.user.email.toLowerCase()` ∈ `getAdminEmails()` (the `ADMIN_EMAILS` env
   allowlist) ⇒ else `ForbiddenError` (403).
   It does NOT consult `activeOrganizationId` or membership role — a per-organization **owner** is NEVER
   conflated with a platform operator (the documented authz-admin-owner-role-escalation guard).

**Target tenant derivation:** every admin files route takes the tenant from the gated `:id` path param
(`ctx.params.id`) and passes it as `targetTenantId`. The request **body NEVER carries a tenantId** — the
sign-upload body is `{ mimeType, byteSize, originalFilename? }` only; there is no `tenantId` field to trust.
This closes the confused-deputy hole: an admin cannot be tricked into acting on tenant B while the URL says A.

**Why a regular user / org-owner cannot reach this:**
- The mount point `/api/admin/*` sits behind `requirePlatformAdmin()`. A non-allowlisted session → 403; no
  session → 401. Membership role is irrelevant, so an org **owner** of tenant X gets 403 just like any member.
- The cross-tenant functions live in the files module but are reachable ONLY through these gated routes — the
  PUBLIC tenant-scoped `/api/files/*` routes call the ORIGINAL ctx-tenant-scoped commands (unchanged), which
  read `ctx.tenantId` from the caller's own session/tenant middleware and can NEVER address another tenant.
- The `admin-attachment` relation, even though globally registered, is defended on the public surface by
  `canRead`/`canWrite` returning `false` (§4) — a regular user cannot read or attach it via `/api/files/*`.
- Quota is charged to `targetTenantId` (the path tenant), never the admin's own tenant.

Route error→HTTP mapping (per route, matching files/routes.ts conventions):
`not_found → 404`, `quota_exceeded | file_too_large | image_too_large → 413`, every other code → 400.
NEVER expose `storage_key`/`bucket`.

Note: `adminSignUpload` route SHOULD first verify the target tenant exists (`SELECT id FROM organization
WHERE id = :id`) → 404 `TENANT_NOT_FOUND` before reserving quota, to avoid creating an orphan
`tenant_storage_usage` row for a non-existent tenant (reserveQuota upserts the row). list/read/delete
naturally degrade (empty list / 404) so the check is mandatory only on sign.

---

## 3. Transform-enqueue wiring for admin uploads

The PUBLIC path enqueues image transforms via the `file.completed` subscriber in
`hooks/on-tenant-created.ts` (`registerFilesHooks`), which reads the row, gates on raster-image MIME +
`relation.generateVariants`, and `createQueue("image-transform").add("files:transform-image", {fileId,
tenantId})`. `admin.ts` (host route plugin) does NOT hold the registry event bus, so admin-complete cannot
emit `file.completed` onto it.

**Decision:** EXTRACT the gated enqueue body into a single exported helper and call it from BOTH paths.
- New export `enqueueTransform({ fileId, tenantId })` in `hooks/on-tenant-created.ts` (keeps the lazy dynamic
  `createQueue` import + the GATE-1 raster-MIME-or-row-MIME + GATE-2 `generateVariants` checks + the no-Redis
  silent skip + try/catch + ErrorTracker, all unchanged).
- The `file.completed` subscriber body becomes `await enqueueTransform({ fileId, tenantId })` (behaviour
  identical — verified by the existing `enqueue-on-completed.test.ts`).
- `adminCompleteUpload` calls `enqueueTransform({ fileId, tenantId: targetTenantId })` after a successful
  finalize. No registry-bus plumbing into `admin.ts`; no duplicated enqueue logic.

This satisfies the GOAL "uploads (images) transform into variants and appear in the list" for the admin path.

---

## 4. `admin-attachment` fileRelation — declaration + spec

**Where:** declared on the files module's OWN `ModuleDefinition` (`packages/modules/files/src/index.ts`),
in a new `fileRelations` field. The files module currently declares none; adding it here means the existing
boot-time `collectFileRelations` walk (registry, runs at `loadAll()`) collects it into `fileRelationsRegistry`
keyed `(ownerModule="files", kind="admin-attachment")` — the SAME mechanism that collects auth's user/org
relations. No apps/api boot change needed. This is the cleanest home: the relation is owned by the module
whose admin functions consume it.

**Spec:**
```ts
fileRelations: {
  "admin-attachment": {
    recordType: "tenant",
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"], // images + pdf, NO svg, NO gif
    maxByteSize: 10 * 1024 * 1024,                       // 10 MiB (operator attachments may exceed avatars)
    generateVariants: [{ name: "thumb-256", width: 256, format: "webp" }], // raster images → 1 webp thumbnail
    cardinality: "many",                                  // admin attachments pile up (NOT latest-wins)
    onDelete: "orphan",                                   // owner record is the tenant; Phase 31 reconciles
    canRead: async () => false,   // defense-in-depth: the PUBLIC /api/files read path is denied for this
    canWrite: async () => false,  // relation; the admin functions BYPASS hooks, so admin is unaffected.
  },
}
```
- SVG excluded (XSS / librsvg SSRF — the enqueue subscriber GATE-1 also drops `image/svg+xml`); GIF excluded
  to keep the transform source set on the proven sharp raster path (a non-listed image MIME is rejected at
  sign-time anyway). PDF is allowed but won't match the image MIME gate → no transform (correct).
- `canRead`/`canWrite` = `false` means a non-admin who somehow signs an `admin-attachment` file in their OWN
  tenant via the public `/api/files/sign-upload` (registry is global) can never READ it back or ATTACH it via
  the public routes; the orphan pending row in their own tenant (own quota) is swept by Phase 31. Admin
  functions never call attach and bypass canRead, so they are unaffected. (Risk R2.)

---

## 5. Admin routes (apps/api/src/routes/admin.ts)

Add to the existing `adminRoutes` plugin (already `.use(requirePlatformAdmin())`). Import the 5 functions from
`@baseworks/module-files`. `:id` is the TARGET tenant in every route.

```
GET    /api/admin/tenants/:id/files                       → adminListFilesForTenant(:id, {limit,offset})
POST   /api/admin/tenants/:id/files/sign-upload           → verify tenant exists → adminSignUpload(:id, body)
                                                             body: { mimeType, byteSize, originalFilename? }   ⟵ NO tenantId
POST   /api/admin/tenants/:id/files/:fileId/complete      → adminCompleteUpload(:id, :fileId)
GET    /api/admin/tenants/:id/files/:fileId/read-url      → adminGetReadUrl(:id, :fileId)
DELETE /api/admin/tenants/:id/files/:fileId               → adminDeleteFile(:id, :fileId)
```
- TypeBox `body` schema on sign-upload: `t.Object({ mimeType: t.String({minLength:1}),
  byteSize: t.Integer({minimum:1}), originalFilename: t.Optional(t.String()) })`. `kind` is fixed server-side
  to `admin-attachment` — NOT client-supplied.
- list query: `t.Object({ limit: t.Optional(t.Numeric()), offset: t.Optional(t.Numeric()) })`.
- Each handler unwraps the `Result`: on `!success`, set the mapped status and return `{ error: r.error }`;
  on success return `r.data`. Mirror the existing admin.ts `(ctx:any)` handler style.

---

## 6. apps/admin Files browser (tenant-detail)

**New adapter file** `apps/admin/src/lib/file-upload-adapters.ts` (mirror of `apps/web/lib/file-upload-adapters.ts`,
pointed at the admin endpoints, parameterized by `tenantId`):
- `makeAdminSign(tenantId)` → `POST /api/admin/tenants/:id/files/sign-upload` → map the envelope
  (`method==="POST" && fields` → `s3-post`, else `s3-put`) into `UploadDescriptor`; throw `{ status }` on error
  so the hook maps 413→quota_exceeded, non-413→sign_failed.
- `makeAdminComplete(tenantId)` → `POST /api/admin/tenants/:id/files/:fileId/complete`.
- `buildFileUploadLabels(t)` → from `useTranslation("files")` (the existing Phase-29 `files` namespace).
- `ADMIN_ACCEPT = ["image/jpeg","image/png","image/webp","application/pdf"]`, `ADMIN_MAX_BYTES = 10*1024*1024`
  (mirror of the relation cap — client-side pre-check only; server re-enforces).
Eden access uses the codebase's loose `(api.api.admin.tenants as any)({ id }).files…` style (detail.tsx already
casts to `any`).

**`apps/admin/src/routes/tenants/detail.tsx` (EDIT):** add a full-width **Files** `Card` below the existing
two-column grid:
- **Upload zone:** `<FileUpload multi maxFiles={10} accept={ADMIN_ACCEPT} maxByteSize={ADMIN_MAX_BYTES}
  sign={makeAdminSign(id)} complete={makeAdminComplete(id)} onUploaded={() => qc.invalidateQueries({queryKey:
  ["admin","tenants",id,"files"]})} labels={buildFileUploadLabels(tFiles)} />`. The component already handles
  drag-drop + picker fallback, real XHR progress, preview, cancel/retry, beforeunload, and a11y (aria-live
  errors, keyboard dropzone) — no new a11y wiring beyond correct labels.
- **List:** `useQuery({ queryKey: ["admin","tenants",id,"files"], queryFn: adminList })` →
  `DataTable`/`Table` with columns: name (`originalFilename ?? fileId`), type (`mimeType`), size
  (formatted KiB/MiB), status (`Badge` mapped via i18n `status.*`, + `variantCount` shown when ready),
  created (`formatDistanceToNow`), actions. Empty/loading via the existing `DataTable` states or `Skeleton`.
- **View action:** on click → `adminGetReadUrl(id, fileId)` then `window.open(url, "_blank",
  "noopener,noreferrer")` (signed URL → inline image/pdf or attachment per `dispositionFor`). Disable while
  status === "pending".
- **Delete action:** opens a confirm `Dialog` (reuse the shadcn `Dialog` already imported) → on confirm
  `useMutation(adminDelete)` → `onSuccess` toast + `invalidateQueries(["admin","tenants",id,"files"])`.
- **Invalidation / variants appear:** `onUploaded` invalidates the list (the just-completed file shows
  immediately as `uploaded`). To surface async transform variants, the list query sets
  `refetchInterval: (q) => q.state.data?.files.some(f => f.status==="uploaded" || f.status==="transforming")
  ? 3000 : false` — bounded polling that stops once every row is terminal (`ready`/`deleted`/`pending`-only),
  so the webp thumbnail + `variantCount` appear without a manual reload.
- a11y: action buttons carry `aria-label` (`t("...view", {name})` / `t("...delete", {name})`); the delete
  Dialog uses the shadcn `DialogTitle`/`DialogDescription` (focus-trapped, labelled) already used on the page.

---

## 7. i18n keys (admin namespace + files namespace)

**`apps/admin/src/lib/i18n.ts` (EDIT):** add the existing `files` namespace to both locales' `resources`
(`import { enFiles, ptBRFiles } from "@baseworks/i18n"`; add `files: enFiles` / `files: ptBRFiles`) so
`useTranslation("files")` resolves the `<FileUpload>` labels (en + pt-BR ship in Phase 29).

**`packages/i18n/src/locales/{en,pt-BR}/admin.json` (EDIT):** add under `tenants.detail.files`:
```
tenants.detail.files.title            "Files" / "Arquivos"
tenants.detail.files.empty            "No files for this tenant." / "Nenhum arquivo para este inquilino."
tenants.detail.files.uploadTitle      "Upload files" / "Enviar arquivos"
tenants.detail.files.uploadHint       "JPEG, PNG, WebP or PDF, up to 10 MB each." / "JPEG, PNG, WebP ou PDF, até 10 MB cada."
tenants.detail.files.columns.name     "Name" / "Nome"
tenants.detail.files.columns.type     "Type" / "Tipo"
tenants.detail.files.columns.size     "Size" / "Tamanho"
tenants.detail.files.columns.status   "Status" / "Status"
tenants.detail.files.columns.created  "Created" / "Criado"
tenants.detail.files.columns.actions  "Actions" / "Ações"
tenants.detail.files.view             "View {name}" / "Ver {name}"
tenants.detail.files.delete           "Delete {name}" / "Excluir {name}"
tenants.detail.files.variants         "{count} variants" / "{count} variantes"
tenants.detail.files.status.pending      "Pending" / "Pendente"
tenants.detail.files.status.uploaded     "Uploaded" / "Enviado"
tenants.detail.files.status.transforming "Processing" / "Processando"
tenants.detail.files.status.ready        "Ready" / "Pronto"
tenants.detail.files.deleteDialog.title       "Delete file" / "Excluir arquivo"
tenants.detail.files.deleteDialog.description  "Delete {name}? This cannot be undone." / "Excluir {name}? Esta ação não pode ser desfeita."
tenants.detail.files.toast.uploaded     "File uploaded." / "Arquivo enviado."
tenants.detail.files.toast.deleted      "File deleted." / "Arquivo excluído."
tenants.detail.files.toast.deleteFailed "Could not delete the file." / "Não foi possível excluir o arquivo."
tenants.detail.files.toast.loadError    "Could not load files." / "Não foi possível carregar os arquivos."
```
(The `{` / `}` interpolation matches the admin i18n `prefix:"{"` / `suffix:"}"` config.)

---

## 8. Full file list

**New**
- `packages/modules/files/src/commands/admin-files.ts` — the 5 cross-tenant admin functions + `AdminFileDto`.
- `packages/modules/files/src/commands/__tests__/admin-files.test.ts` — bun:test, LIVE DB (§9 / §10).
- `apps/admin/src/lib/file-upload-adapters.ts` — admin sign/complete adapters + labels + accept/max.
- `apps/admin/src/routes/tenants/detail.files.test.tsx` — vitest (jobs.test.tsx pattern; §9).

**Edited**
- `packages/modules/files/src/index.ts` — add `fileRelations: { "admin-attachment": … }`; export the 5 admin
  functions + (if surfaced) `enqueueTransform`.
- `packages/modules/files/src/hooks/on-tenant-created.ts` — extract + export `enqueueTransform({fileId,
  tenantId})`; the `file.completed` subscriber calls it.
- `apps/api/src/routes/admin.ts` — add the 5 files routes (behind the existing `requirePlatformAdmin()`).
- `apps/admin/src/routes/tenants/detail.tsx` — add the Files card (upload zone + list + view/delete).
- `apps/admin/src/lib/i18n.ts` — register the `files` namespace (en + pt-BR).
- `packages/i18n/src/locales/en/admin.json` + `…/pt-BR/admin.json` — `tenants.detail.files.*` keys.

`bun biome check --write` on every touched file.

---

## 9. Verification

- Backend (live DB, Docker up): `DATABASE_URL=… bun test packages/modules/files`.
  Assert: (a) `adminSignUpload(A,…)`+`adminCompleteUpload(A,…)` charge tenant **A**'s `bytes_used`, NOT a
  caller tenant; key prefix is `A/files/admin-attachment/…`. (b) `adminListFilesForTenant(A)` returns A's
  files and `adminListFilesForTenant(B)` does NOT see A's file (cross-tenant isolation). (c) NO response from
  any admin function contains the `storage_key` / `bucket` substring (scan JSON). (d) `adminDeleteFile`
  refunds `bytes_used` (incl. variant bytes via softDeleteRow). (e) `adminGetReadUrl` returns `{url,expiresAt}`
  only and works on a file whose relation `canRead===false` (admin bypass). (f) quota_exceeded → err on a
  tenant at limit. (g) `enqueueTransform` called on image complete (spy).
- Admin UI: `cd apps/admin && bun run test` (vitest) — list renders rows from a mocked query, status Badge +
  variant count, view calls read-url + window.open, delete opens dialog + invalidates; `<FileUpload>` mounts
  with the admin adapters. `cd apps/admin && bun run build` (tsc -b && vite build) clean.
- `bun run test` (root) stays green.

---

## 10. Risks

- **R1 — Cross-tenant authz (CRITICAL).** Every admin files route MUST inherit `requirePlatformAdmin()` and
  read the tenant from `:id` ONLY. Mitigation: routes live on the already-gated `adminRoutes` plugin; the
  sign-upload body has NO `tenantId` field; functions take `targetTenantId` explicitly. Adversarial test:
  no-session → 401, non-allowlisted session (incl. an org owner) → 403, body-injected tenantId is ignored.
- **R2 — Global `admin-attachment` relation is publicly signable.** A non-admin could `POST /api/files/
  sign-upload {ownerModule:"files",kind:"admin-attachment"}` in their OWN tenant (cannot target another —
  `ctx.tenantId` is theirs). Blast radius: an orphan pending file in their own tenant/quota. Mitigation:
  relation `canRead`/`canWrite` = `false` (public read+attach denied); Phase 31 sweeps the orphan. Documented,
  accepted for the starter.
- **R3 — Quota charged to the wrong tenant.** Mitigation: `reserveQuota`/`markUploaded`/`softDeleteRow` are
  ALWAYS called with `targetTenantId`; key built with `tenantId: targetTenantId`; live-DB test (f)/(a)/(d)
  assert the TARGET row moves and no other row is touched.
- **R4 — storage_key/bucket leak.** New list/read DTOs must project ONLY display fields. Mitigation: explicit
  column lists (no `SELECT *`); verification scan (c).
- **R5 — Transform enqueue regression.** Extracting `enqueueTransform` must not change the public subscriber's
  behaviour. Mitigation: subscriber delegates to the helper unchanged; existing `enqueue-on-completed.test.ts`
  must stay green; admin path adds a direct call.
- **R6 — mock-isolation discipline (new bun:test).** The new `admin-files.test.ts` runs against the LIVE DB and
  should AVOID `mock.module()` on shared modules where possible. If it MUST stub a shared module
  (`@baseworks/config`, `@baseworks/db`, `@baseworks/storage`, `@baseworks/queue`), it MUST spread the REAL
  module (`import * as real …; () => ({ ...real, … })`) so the surface stays COMPLETE (process-global mocks
  leak across the root run). Prefer the live-DB pattern of the existing files suites (no shared-module mock) +
  a local `createQueue`/`getFileStorage` spy only.
- **R7 — Async variant visibility.** Variants appear only after the BullMQ worker runs (needs Redis). The list
  uses bounded `refetchInterval` (stops at terminal status) so variants surface without manual reload; with no
  worker the file still lists as `uploaded` (no crash). Documented.
- **R8 — Non-existent target tenant.** `adminSignUpload` could create an orphan `tenant_storage_usage` row.
  Mitigation: sign-upload route verifies `organization` existence → 404 before reserving.
- **R9 — Eden type looseness.** New admin endpoints accessed via `as any` (codebase precedent in detail.tsx);
  acceptable, but keep the adapter return types explicit so the UI stays typed at the seam.
