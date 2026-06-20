# Phase 29 — Auth & Org Identity Asset Wiring + Reusable `<FileUpload>` (ABSORBED Phase 30 component)

**Status:** LOCKED
**Milestone:** v1.4 File Storage & Uploads
**Requirements:** IDA-01, IDA-02 (Phase 29) + UI-01, UI-02 (absorbed Phase 30 component, SC 1–5)
**Depends on:** Phase 27 (sign/complete/read/attach + `ctx.dispatch`), Phase 28 (variants)
**Authoritative sources read:** ROADMAP Phase 29 (SC 1–4) + Phase 30 (SC 1–5); `packages/shared/src/types/{module,cqrs}.ts`; files module `commands/{sign-upload,complete-upload,attach-file,delete-file}.ts`, `queries/{get-read-url,list-for-record}.ts`, `routes.ts`, `lib/relation-lookup.ts`; auth `index.ts`, `queries/{get-profile,list-members}.ts`, `routes.ts`, `middleware.ts`; `apps/api/src/index.ts` scoped band; `apps/web/lib/api.ts`, `app/(dashboard)/dashboard/settings/page.tsx`, `components/tenant-provider.tsx`; `packages/api-client/src/treaty.ts`; `packages/i18n/src/index.ts`; `packages/ui` (index/avatar/dialog.a11y.test/package.json/vitest.config); `packages/storage/src/ports/file-storage.ts`.

> SCOPE NOTE: Phase 29 absorbs the reusable `<FileUpload>`/`useFileUpload` component that the ROADMAP placed in Phase 30. This contract is the KEYSTONE Phase 30 also consumes — the component API below is frozen. Phase 30 shrinks to: admin tenant-files browser + multi-mode polish (the component already ships multi mode here).

---

## 0. Locked decisions (TL;DR)

| # | Decision |
|---|----------|
| D-1 | `<FileUpload>` is backend-AGNOSTIC: it takes injected async `sign(meta)→UploadDescriptor` + optional `complete(fileId)` + `onUploaded` callbacks. `packages/ui` imports NEITHER `@baseworks/api-client` NOR anything from `apps/*`. |
| D-2 | `UploadDescriptor` is a discriminated union on `kind: "s3-put" | "s3-post" | "local"`. The PAGE-level `sign` adapter maps the backend `{fileId,method,url,headers?,fields?,expiresAt}` envelope into the descriptor. `s3-put`/`local` share the raw-PUT XHR path; `s3-post` uses multipart `FormData` (fields first, `file` last). |
| D-3 | Real byte progress via `XMLHttpRequest` + `xhr.upload.onprogress`. NO `fetch` (no upload-progress events). Cancel = `xhr.abort()`. |
| D-4 | i18n: `packages/ui` stays framework-agnostic — the component accepts an optional `labels` prop (typed `FileUploadLabels`) with baked-in English defaults. `packages/i18n` owns the new `files` namespace (en + pt-BR); the apps/web pages build `labels` from `useTranslations("files")` and pass it in. The a11y test renders with defaults. |
| D-5 | auth declares `fileRelations: { user, organization }` keyed by `kind` (`user`/`organization`); registry key is `auth:user` / `auth:organization`; `recordType` equals the kind. ZERO files↔auth import (lint:cross-module + grep gate). |
| D-6 | SVG is rejected by OMISSION from `allowedMimeTypes` (`image/jpeg`,`image/png`,`image/webp` only). Rejected at sign-time → `mime_not_allowed` → HTTP 400. (Defense in depth: `ImageVariantSpec.format` excludes svg; magic-bytes can't verify svg; `dispositionFor` forces attachment.) |
| D-7 | `get-profile` resolves `avatarUrl` via `ctx.dispatch("files:list-for-record", …)` then `ctx.dispatch("files:get-read-url", …)`. NO `@baseworks/module-files` import. `ctx.dispatch` absent (tests) → `avatarUrl: null`. |
| D-8 | `get-profile` is exposed over HTTP as **`GET /api/profile`** added to the apps/api SCOPED band (mirrors the existing `/api/tenant` DELETE), so `ctx.handlerCtx.dispatch` is present. Eden type: `api.api.profile.get()`. |
| D-9 | Cascade-on-replace lives in **`attach-file`**, gated by a new `FileRelation.cardinality?: "single" | "many"` (default `"many"`). For `single`, after linking the new row, soft-delete ALL OTHER live rows for the same `(tenant, ownerModule, ownerRecordType, ownerRecordId)`, refunding `bytes_used` (+ variant bytes) exactly like `delete-file`. Locked page flow: **sign → PUT → complete → attach** (new file is `uploaded` BEFORE the prior is removed → never a window with zero avatar). |
| D-10 | Routes: avatar at `app/(dashboard)/profile/page.tsx` (URL `/profile`); org logo at `app/(dashboard)/team/settings/page.tsx` (URL `/team/settings`), owner/admin-gated client-side + enforced server-side by `organization.canWrite`. Existing `/dashboard/settings` is left untouched. |

---

## 1. `<FileUpload>` / `useFileUpload` — FROZEN component API (keystone)

### 1.1 `UploadDescriptor` (public, exported from `@baseworks/ui`)

```ts
export type UploadDescriptor =
  | { kind: "s3-put"; fileId: string; url: string; headers?: Record<string, string>; expiresAt: string }
  | { kind: "s3-post"; fileId: string; url: string; fields: Record<string, string>; expiresAt: string }
  | { kind: "local";  fileId: string; url: string; headers?: Record<string, string>; expiresAt: string };
```

- `s3-put` / `local`: XHR `PUT` of the raw `File` body; apply `headers` (e.g. `Content-Type`). Identical transport — `local` exists as a forward-compat discriminant so the page can label dev/local-adapter flows distinctly.
- `s3-post`: XHR `POST` of `FormData`; append every `fields[k]` first, then `file` LAST (S3 POST policy requires `file` last). Do NOT set `Content-Type` (browser sets multipart boundary).
- `expiresAt`: ISO 8601; component MAY warn if expired before upload starts but always attempts.

### 1.2 `FileUploadLabels` (i18n injection, all optional → English defaults)

```ts
export interface FileUploadLabels {
  dropzone: string;            // "Drag an image here, or click to choose"
  browse: string;              // "Choose file"
  uploading: string;          // "Uploading… {percent}%"   (interpolated by component)
  processing: string;         // "Processing…"  (post-complete, variants pending)
  done: string;               // "Uploaded"
  cancel: string;             // "Cancel"
  retry: string;              // "Retry"
  remove: string;             // "Remove"
  errors: Record<UploadErrorCode, string>;
  beforeUnload: string;       // returnValue text for the navigation guard
}
```

### 1.3 `UploadErrorCode` + mapping to failure modes (SC#2)

```ts
export type UploadErrorCode =
  | "oversize"        // client-side: file.size > maxByteSize (BEFORE sign)
  | "wrong_mime"      // client-side: file.type ∉ accept (BEFORE sign)
  | "quota_exceeded"  // sign() rejects with status 413 (from /sign-upload)
  | "network"         // XHR error/timeout/abort-due-to-network — RETRYABLE
  | "mime_mismatch"   // complete() rejects (server magic-byte mismatch; file deleted server-side)
  | "sign_failed"     // /sign-upload non-413 failure (400/5xx)
  | "canceled"        // user pressed Cancel (xhr.abort())
  | "unknown";
```

`sign`/`complete` are injected; the page adapter throws a tagged error the hook maps to a code. Contract for adapters: throw `Object.assign(new Error(msg), { code: UploadErrorCode })`, OR throw with `{ status: number }` and the hook infers (`413→quota_exceeded`, else `sign_failed` for sign / `mime_mismatch` for complete). `retry` is offered for `network`, `sign_failed`, `quota_exceeded`; `mime_mismatch`/`wrong_mime`/`oversize` are terminal (re-pick required).

### 1.4 `FileUploadProps`

```ts
export interface FileUploadProps {
  sign: (meta: { file: File; name: string; mimeType: string; byteSize: number }) => Promise<UploadDescriptor>;
  complete?: (fileId: string) => Promise<unknown>;   // server-authoritative finalize (POST /:fileId/complete)
  onUploaded?: (result: { fileId: string; file: File }) => void | Promise<void>; // after complete OK (page attaches + refetches)
  accept?: string[];          // MIME allow-list mirrored client-side (default: any)
  maxByteSize?: number;       // client-side oversize pre-check (mirror of relation cap)
  multi?: boolean;            // false (default) = single; true = multi
  maxFiles?: number;          // cap when multi (default 10)
  preview?: boolean;          // image preview via URL.createObjectURL (default true)
  disabled?: boolean;
  labels?: Partial<FileUploadLabels>;
  className?: string;
  "aria-label"?: string;      // dropzone label override
}
```

### 1.5 `useFileUpload` return shape

```ts
export interface UploadItem {
  id: string;            // client uuid (crypto.randomUUID) for the row
  file: File;
  name: string;
  previewUrl?: string;   // object URL (images only); revoked on remove/unmount
  status: "idle" | "signing" | "uploading" | "completing" | "done" | "error" | "canceled";
  progress: number;      // 0–100, real bytes (xhr.upload loaded/total)
  fileId?: string;       // set after sign()
  error?: UploadErrorCode;
}
export interface UseFileUpload {
  items: UploadItem[];
  isUploading: boolean;                 // any item in signing|uploading|completing — drives beforeunload
  addFiles: (files: FileList | File[]) => void;
  retry: (id: string) => void;
  cancel: (id: string) => void;         // xhr.abort()
  remove: (id: string) => void;         // revokes previewUrl
  reset: () => void;
}
export function useFileUpload(opts: Omit<FileUploadProps, "className" | "labels" | "aria-label">): UseFileUpload;
```

State machine per item: `idle → signing → uploading → completing → done` (or `→ error` at any step; `→ canceled` via cancel). `retry` re-enters from the failed step (re-sign if no `fileId`, else re-PUT).

### 1.6 `beforeunload` guard (SC#5)
`useEffect` in the hook: while `isUploading`, register `window.addEventListener("beforeunload", h)` where `h` calls `e.preventDefault(); e.returnValue = labels.beforeUnload`. Remove the listener when idle and on unmount. Object URLs revoked on `remove`/`reset`/unmount.

### 1.7 a11y / ARIA plan (SC#4, vitest-axe)
- Dropzone: `role="button"`, `tabIndex={0}`, `aria-label` (prop or `labels.dropzone`), `aria-disabled` when disabled; `onKeyDown` Enter/Space → opens the hidden picker; `onDragOver/onDragLeave/onDrop` toggle a visual `data-dragging` state.
- Picker fallback: visually-hidden `<input type="file">` with `accept={accept.join(",")}` and `multiple={multi}`, programmatically clicked by the dropzone; also reachable by keyboard via an associated `<label>`/button.
- Status region: `aria-live="polite"` for status/progress text (`uploading {percent}%`, `processing`, `done`); error text in `role="alert"` / `aria-live="assertive"`.
- Per-item progress: `role="progressbar"` with `aria-valuenow/aria-valuemin={0}/aria-valuemax={100}` and `aria-label`.
- Image previews carry `alt` (filename).
- **Test** (`file-upload.a11y.test.tsx`, mirrors `dialog.a11y.test.tsx`): render default state and an injected error state; assert `axe(container)` has zero `critical`/`serious` violations; assert the file input is present + the dropzone is keyboard-focusable.

---

## 2. auth `fileRelations` — FROZEN specs (SC#1, SC#2, SC#3)

Added to `ModuleDefinition.fileRelations` in `packages/modules/auth/src/index.ts`. Registry key = `auth:<kind>`; `recordType` = `<kind>`.

### 2.1 `user` (avatar)
```ts
user: {
  recordType: "user",
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],  // SVG excluded (D-6)
  maxByteSize: AVATAR_MAX_BYTES,        // const = 5 * 1024 * 1024 (5 MiB)
  cardinality: "single",                // NEW field (D-9) → cascade-on-replace
  generateVariants: [
    { name: "avatar-64",  width: 64,  format: "webp", quality: 82 },
    { name: "avatar-128", width: 128, format: "webp", quality: 82 },
    { name: "avatar-256", width: 256, format: "webp", quality: 82 },
    { name: "avatar-512", width: 512, format: "webp", quality: 82 },
  ],
  onDelete: "cascade",
  canRead:  async (ctx, recordId) => recordId === ctx.userId,   // owner only
  canWrite: async (ctx, recordId) => recordId === ctx.userId,   // owner only
}
```

### 2.2 `organization` (logo)
```ts
organization: {
  recordType: "organization",
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],  // SVG excluded (D-6)
  maxByteSize: LOGO_MAX_BYTES,          // const = 5 * 1024 * 1024 (5 MiB)
  cardinality: "single",                // cascade-on-replace
  generateVariants: [
    { name: "logo-128", width: 128, format: "webp", quality: 85 },
    { name: "logo-256", width: 256, format: "webp", quality: 85 },
  ],
  onDelete: "cascade",
  // member of the active tenant may READ; owner/admin may WRITE.
  canRead:  async (ctx, recordId) => recordId === ctx.tenantId,
  canWrite: async (ctx, recordId) => recordId === ctx.tenantId && (await isOwnerOrAdmin(ctx)),
}
```

`isOwnerOrAdmin(ctx)`: tenant-scoped role check using `member` table (`packages/db` auth schema has `member.role`) — `SELECT role FROM member WHERE organization_id = ctx.tenantId AND user_id = ctx.userId` → role ∈ {`owner`,`admin`}. Implemented INSIDE auth (no files import; allowed to read its own tables). Hook bodies live in a small `packages/modules/auth/src/file-relations.ts` to keep `index.ts` declarative.

> `cardinality` is a NEW optional field on `FileRelation` in `packages/shared/src/types/module.ts` (default `"many"`; documented "Phase 29 / IDA-01"). Adding it is backward-compatible (all existing relations omit it → many).

### 2.3 SVG rejection proof (SC#2)
`sign-upload` step 2 (`relation.allowedMimeTypes.includes("image/svg+xml")` → false) returns `err("mime_not_allowed")` → route maps to HTTP 400. Backend bun:test asserts a sign for `organization` with `mimeType:"image/svg+xml"` → `{success:false,error:"mime_not_allowed"}`.

---

## 3. `get-profile` `avatarUrl` via `ctx.dispatch` — FROZEN (SC#1, SC#3)

`packages/modules/auth/src/queries/get-profile.ts` — after loading the user row, resolve avatar WITHOUT importing files:

```ts
let avatarUrl: string | null = null;
if (ctx.dispatch) {
  const listed = await ctx.dispatch("files:list-for-record", {
    ownerModule: "auth", ownerRecordType: "user", recordId: ctx.userId,
  });
  if (listed.success) {
    const files = (listed.data as { files: Array<{ fileId: string; status: string; createdAt: string|Date }> }).files;
    // "latest wins" — pick most recent uploaded/ready file. list-for-record is ORDER BY created_at ASC.
    const usable = files.filter(f => f.status === "uploaded" || f.status === "ready");
    const latest = usable[usable.length - 1];
    if (latest) {
      const read = await ctx.dispatch("files:get-read-url", { fileId: latest.fileId });
      if (read.success) avatarUrl = (read.data as { url: string }).url;
    }
  }
}
return ok({ ...userFields, avatarUrl });
```

- Return DTO becomes `{ id, name, email, image, emailVerified, createdAt, avatarUrl }`. (`image` = better-auth's stored OAuth image; `avatarUrl` = signed URL of the uploaded avatar, the Phase 29 surface.)
- `ctx.dispatch` undefined (bare-ctx tests) ⇒ `avatarUrl: null` (no throw).
- `canRead` on the `user` relation (recordId === ctx.userId) passes because the dispatched read carries the same `handlerCtx` (same `userId`). No 404 for the owner.
- ZERO `@baseworks/module-files` import — verified by `lint:cross-module`.

### 3.1 HTTP exposure (D-8)
Add to `apps/api/src/index.ts` scoped band (after the `handlerCtx` derive, mirroring `/api/tenant`):
```ts
.group("/api", g => g.get("/profile", async (ctx:any) => {
  const r = await registry.getCqrs().execute("auth:get-profile", {}, ctx.handlerCtx);
  if (!r.success) { ctx.set.status = 401; return { error: r.error }; }
  return r.data;
}))
```
Eden type: `api.api.profile.get()` → `{ ...profile, avatarUrl }`.

---

## 4. Cascade-on-replace + quota — FROZEN (SC#4)

**Location:** `attach-file` command, after step 4 links the new row. **Trigger:** `relation.cardinality === "single"`.

```ts
if (relation?.cardinality === "single") {
  // soft-delete every OTHER live row for this owner tuple, refunding quota.
  const siblings = await tx.execute(sql`
    SELECT id, bucket, storage_key, byte_size, status, transforms FROM files
     WHERE tenant_id = ${ctx.tenantId} AND owner_module = ${input.ownerModule}
       AND owner_record_type = ${input.ownerRecordType} AND owner_record_id = ${input.ownerRecordId}
       AND id <> ${input.fileId} AND deleted_at IS NULL FOR UPDATE`);
  for (const s of siblings) {
    await tx.update(files).set({ deletedAt: new Date(), status: "deleted" })
      .where(and(eq(files.id, s.id), eq(files.tenantId, ctx.tenantId), isNull(files.deletedAt)));
    if (COUNTED_STATUSES.has(s.status))
      await decrementUsed(tx, ctx.tenantId, Number(s.byte_size) + sumTransformBytes(s.transforms));
    // collect (bucket,key) for best-effort storage delete + file.deleted emit AFTER commit
  }
}
```

- Reuses `COUNTED_STATUSES`, `decrementUsed`, `sumTransformBytes` from `delete-file`/`lib/quota`. **Refactor:** extract the tombstone+refund body of `delete-file` into `lib/soft-delete.ts` (`softDeleteRow(tx, tenantId, row)` returning captured coords) and call it from BOTH `delete-file` and the cascade loop — DRY, single quota-conservation code path.
- Whole cascade runs inside `attach-file`'s wrapping transaction (attach gets wrapped in a tx for this). Storage `.delete()` + `ctx.emit("file.deleted", …)` for each sibling AFTER commit (best-effort, matching `delete-file` R7).
- Quota: each counted sibling decrements `bytes_used` by its own bytes + variant bytes → no pile-up, `bytes_used` decrements correctly (SC#4).
- Page flow (D-9) guarantees the NEW file is already `uploaded` when attach fires, so the prior avatar is only removed once the replacement is durable.

---

## 5. Pages, routes, wiring — FROZEN (SC#1, SC#2)

### 5.1 `/profile` — avatar (`apps/web/app/(dashboard)/profile/page.tsx`)
- Server component shell → client `components/avatar-uploader.tsx` ("use client").
- Reads profile via React Query `api.api.profile.get()` → shows `<Avatar><AvatarImage src={avatarUrl} /><AvatarFallback>…</AvatarFallback></Avatar>` (existing `avatar.tsx`).
- `<FileUpload>` (single, `accept=["image/jpeg","image/png","image/webp"]`, `maxByteSize=5MiB`, `labels` from `useTranslations("files")`):
  - `sign`: `POST api.api.files["sign-upload"].post({ ownerModule:"auth", kind:"user", mimeType, byteSize })` → map to descriptor (`method==="POST"&&fields ? s3-post : s3-put`; 413 → throw quota_exceeded).
  - `complete`: `api.api.files({ fileId }).complete.post()` (maps mime_mismatch).
  - `onUploaded`: `api.api.files.attach.post({ fileId, ownerModule:"auth", ownerRecordType:"user", ownerRecordId:<userId> })` then `queryClient.invalidateQueries(["profile"])` → avatar re-renders with the fresh signed `avatarUrl`.

### 5.2 `/team/settings` — org logo (`apps/web/app/(dashboard)/team/settings/page.tsx`)
- Owner/admin gate client-side (hide uploader for members; render read-only logo). Server enforces via `organization.canWrite` (isOwnerOrAdmin) → attach returns `forbidden` → 403 surfaced.
- Active tenant id from `useTenant().activeTenant.id` (= `ownerRecordId`).
- `<FileUpload>` single, `kind:"organization"`, variants 128/256; `onUploaded` attaches with `ownerRecordType:"organization", ownerRecordId:<tenantId>` then invalidates the logo query (`api.api.files["list-for-record"].get({ ownerModule:"auth", ownerRecordType:"organization", recordId:<tenantId> })` → newest → `files({fileId})["read-url"].get()`).

### 5.3 Role source for the org page
`useTenant()` currently has no role. EITHER (a) add `role` to the active-tenant shape from `auth.useActiveMember()` / list-members, OR (b) the page calls a small membership query. Locked: extend `tenant-provider.tsx` to expose `activeRole` from better-auth `auth.useActiveMember()` (client SDK) — minimal, no new server route. Server `canWrite` remains the authority.

---

## 6. i18n `files` namespace — FROZEN (SC#4)

`packages/i18n`: add `"files"` to `namespaces`; create `src/locales/en/files.json` + `src/locales/pt-BR/files.json`; add static re-exports `enFiles`/`ptBRFiles` (matches existing pattern lines 8–21). `getMessages` picks it up automatically (it maps over `namespaces`).

Keys (both locales):
```
dropzone, browse, uploading ("Uploading… {percent}%"/"Enviando… {percent}%"),
processing, done, cancel, retry, remove, beforeUnload,
errors.oversize, errors.wrong_mime, errors.quota_exceeded, errors.network,
errors.mime_mismatch, errors.sign_failed, errors.canceled, errors.unknown,
avatar.title, avatar.description, avatar.current,
logo.title, logo.description, logo.ownerOnly
```

---

## 7. Full file list

**Create — packages/ui:**
- `packages/ui/src/components/file-upload.tsx` — `<FileUpload>` + exported `UploadDescriptor`, `UploadErrorCode`, `FileUploadLabels`, `FileUploadProps`.
- `packages/ui/src/hooks/use-file-upload.ts` — `useFileUpload` + `UploadItem`/`UseFileUpload` (XHR transport, beforeunload, object-URL lifecycle).
- `packages/ui/src/components/__tests__/file-upload.a11y.test.tsx` — vitest-axe.
- EDIT `packages/ui/src/index.ts` — barrel: `export * from "./components/file-upload"; export * from "./hooks/use-file-upload";`.

**Create — packages/i18n:**
- `src/locales/en/files.json`, `src/locales/pt-BR/files.json`. EDIT `src/index.ts` (namespaces + static exports).

**Edit — packages/shared:**
- `src/types/module.ts` — add `cardinality?: "single" | "many"` to `FileRelation`.

**Edit — auth module:**
- `src/index.ts` — add `fileRelations: { user, organization }`.
- `src/file-relations.ts` (new) — relation specs + `isOwnerOrAdmin` + canRead/canWrite hooks + `AVATAR_MAX_BYTES`/`LOGO_MAX_BYTES`.
- `src/queries/get-profile.ts` — add `avatarUrl` via `ctx.dispatch`.

**Edit — files module:**
- `src/commands/attach-file.ts` — wrap in tx + cascade-on-replace for `cardinality:"single"`.
- `src/lib/soft-delete.ts` (new, extracted) + refactor `src/commands/delete-file.ts` to use it.

**Edit — apps/api:**
- `src/index.ts` — `GET /api/profile` in the scoped band.

**Create/Edit — apps/web:**
- `app/(dashboard)/profile/page.tsx` + `components/avatar-uploader.tsx`.
- `app/(dashboard)/team/settings/page.tsx` + `components/org-logo-uploader.tsx`.
- `components/tenant-provider.tsx` — expose `activeRole`.
- Optional shared `lib/file-upload-adapters.ts` (sign/complete/attach helpers reused by both pages).

**Create — planning:**
- `.planning/phases/29-identity-assets-fileupload/29-PLAN-CONTRACT.md` (this file).
- `.planning/phases/29-identity-assets-fileupload/29-HUMAN-UAT.md`.

---

## 8. Verification

- `cd packages/ui && bun run test` — vitest incl. `file-upload.a11y.test.tsx` (zero critical/serious).
- `bun test packages/modules` — bun:test (live DB): SVG-rejected-at-sign, get-profile avatarUrl via dispatch, cascade-on-replace decrements `bytes_used`, no files↔auth import.
- `bun run lint` (incl. `lint:cross-module`, `lint:files-access`) green.
- `bun run build:web` — type-checks both pages against the Eden client (`api.api.profile`, `api.api.files.*`).
- `bun biome check --write` on every touched `.ts/.tsx`.
- Full-browser E2E is NOT a blocking gate (see §9 + 29-HUMAN-UAT.md). Attempt chrome-devtools smoke ONLY if the full stack (api+worker+web+pg+redis) comes up cleanly.

---

## 9. Risks

| ID | Risk | Mitigation |
|----|------|-----------|
| R-1 | Backend-agnostic boundary broken (ui importing api-client/apps) | No `@baseworks/api-client`/`apps/*` import in `packages/ui`; all backend behavior injected via `sign`/`complete`/`onUploaded`; a11y test imports nothing backend. |
| R-2 | files↔auth coupling regress | get-profile + auth relations use `ctx.dispatch`/own tables only; `lint:cross-module` gate; backend test greps for the banned import. |
| R-3 | Browser-E2E gap (drag→variants) fragile in workflow | Authored `29-HUMAN-UAT.md` with exact manual steps; chrome-devtools smoke best-effort only; not a blocking criterion. |
| R-4 | Org-logo write by non-owner | Server `organization.canWrite` = isOwnerOrAdmin (member.role) is the authority (→403); client gate is UX only. |
| R-5 | Cascade-on-replace deletes prior avatar before new one is durable | Locked flow sign→PUT→complete→attach: cascade runs at attach when new row is already `uploaded`; cascade + refund inside one tx (quota conservation, SC#4). |
| R-6 | `kind` discriminator vs backend envelope | Backend `SignedUpload` has `method`+optional `fields`/`headers` but no `kind`; the PAGE adapter derives `kind` (POST+fields→s3-post, else s3-put). Component never calls the backend directly. |
| R-7 | `get-profile` DTO change breaks existing consumers | Field is ADDITIVE (`avatarUrl`); existing `image` retained; no current web consumer of get-profile (route is new). |
| R-8 | `cardinality` field on FileRelation breaks existing relations | Optional, defaults to `"many"`; all existing relations omit it; type-additive. |
