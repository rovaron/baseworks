# Phase 29 — Auth & Org Identity Asset Wiring + Reusable `<FileUpload>` — SUMMARY

**Milestone:** v1.4 File Storage & Uploads
**Requirements:** IDA-01, IDA-02 (Phase 29) + UI-01, UI-02 (the `<FileUpload>` component absorbed forward from Phase 30)
**Status:** Complete (backend fully live-DB-verified + UI vitest/vitest-axe green; full-browser E2E deferred to 29-HUMAN-UAT)
**Executed from:** `29-PLAN-CONTRACT.md` (single LOCKED contract, mirroring Phases 25–28)
**Date:** 2026-06-17

---

## Scope note (locked by the operator)

Phase 29 is the FULL-UI scope: it ABSORBS the reusable `<FileUpload>`/`useFileUpload`
component that the ROADMAP originally placed in Phase 30. So this phase delivered BOTH
the backend identity wiring (IDA-01/IDA-02) AND the `packages/ui` component (built to the
full Phase 30 component spec, SC 1–5) AND the `/profile` + `/team/settings` pages.
**Phase 30 now shrinks to: admin tenant-files browser + multi-mode polish** (the component
already ships `multi` mode here).

---

## What was built

User avatars and org logos now flow through the auth module's declared `fileRelations`,
validating cross-module decoupling end-to-end: files↔auth communicate ONLY through the
string-keyed `ctx.dispatch` bus (Phase 27) — zero direct import in either direction.

### auth `fileRelations` (IDA-01 / IDA-02, SC#1–#3)

- `packages/modules/auth/src/file-relations.ts` (new) declares two relations, kept
  declarative on `ModuleDefinition.fileRelations` in `src/index.ts`. Registry key
  `auth:<kind>`, `recordType === kind`.
  - **`user` (avatar):** allow-list `image/jpeg|png|webp` (SVG excluded), `maxByteSize`
    5 MiB, `cardinality:"single"`, variants `avatar-64/128/256/512` webp, `onDelete:"cascade"`,
    `canRead`/`canWrite` gated to the owner (`recordId === ctx.userId`).
  - **`organization` (logo):** same image allow-list (NO svg), 5 MiB,
    `cardinality:"single"`, variants `logo-128/256` webp, `onDelete:"cascade"`,
    `canRead` = any member (`recordId === ctx.tenantId`), `canWrite` = owner/admin
    (`isOwnerOrAdmin` reads auth's OWN `member` table — no files import).
- **SVG rejected at sign-time** by OMISSION from `allowedMimeTypes` → `sign-upload`
  returns `err("mime_not_allowed")` → HTTP 400. No file row, no quota consumed.
- **`cardinality`** is a NEW optional field on `FileRelation`
  (`packages/shared/src/types/module.ts`, default `"many"`, type-additive — all existing
  relations omit it).

### `get-profile` `avatarUrl` via `ctx.dispatch` (SC#1, SC#3)

- `packages/modules/auth/src/queries/get-profile.ts` resolves `avatarUrl` from the LATEST
  uploaded/ready `user`-kind file using `ctx.dispatch("files:list-for-record", …)` then
  `ctx.dispatch("files:get-read-url", …)` — returns a short-lived **signed** read URL (or
  `null`). ZERO `@baseworks/module-files` import (the only `module-files` string in the auth
  tree is an explanatory comment). `ctx.dispatch` absent (bare-ctx tests) ⇒ `avatarUrl: null`,
  no throw. DTO is additive: `{ id, name, email, image, emailVerified, createdAt, avatarUrl }`.
- Exposed over HTTP as **`GET /api/profile`** in the apps/api SCOPED band (mirrors
  `/api/tenant`), so `ctx.handlerCtx.dispatch` is present. Eden: `api.api.profile.get()`.

### Cascade-on-replace + quota decrement (SC#4)

- Lives in `attach-file` (now wrapped in a tx), triggered when `relation.cardinality ===
  "single"`: after linking the new row, soft-delete ALL OTHER live rows for the same
  `(tenant, ownerModule, ownerRecordType, ownerRecordId)`, refunding `bytes_used` by each
  sibling's own bytes + variant bytes — so avatars/logos never pile up.
- The tombstone+refund body was extracted to `lib/soft-delete.ts` and shared by BOTH
  `delete-file` and the cascade loop (single quota-conservation code path). Storage
  `.delete()` + `file.deleted` emit happen AFTER commit, best-effort (matches `delete-file`).
- Locked page flow **sign → PUT → complete → attach** guarantees the new file is already
  `uploaded` when the cascade fires — never a window with zero avatar.

### Reusable `<FileUpload>` + `useFileUpload` (absorbed Phase 30 component, SC 1–5)

- `packages/ui/src/components/file-upload.tsx` + `packages/ui/src/hooks/use-file-upload.ts`,
  barrel-exported from `src/index.ts`. **Backend-AGNOSTIC**: imports NEITHER
  `@baseworks/api-client` NOR anything in `apps/*` — all backend behavior is injected via
  `sign(meta)→UploadDescriptor`, optional `complete(fileId)`, and `onUploaded` callbacks.
- Full spec: drag-drop + visually-hidden file-picker fallback; **real XHR byte progress**
  via `xhr.upload.onprogress` (no `fetch`); image preview via `URL.createObjectURL`
  (revoked on remove/reset/unmount); cancel (`xhr.abort()`) + retry (re-enters from the
  failed step); single + `multi` mode; `UploadDescriptor` `kind` discriminator
  (`s3-put|s3-post|local`) — raw-PUT path vs S3-POST multipart (`file` last).
- All error states via `UploadErrorCode` (`oversize`, `wrong_mime`, `quota_exceeded`,
  `network` (retryable), `mime_mismatch`, `sign_failed`, `canceled`, `unknown`).
- a11y: dropzone `role="button"` + `tabIndex=0` + Enter/Space → picker; `aria-live`
  status region; `role="alert"` errors; `role="progressbar"` per item; preview `alt`.
- **`beforeunload` guard** registered while `isUploading`, removed on idle/unmount.
- i18n: framework-agnostic — accepts an optional `labels` prop (English defaults baked in);
  the pages build `labels` from `useTranslations("files")`.

### apps/web pages (SC#1, SC#2)

- `app/(dashboard)/profile/page.tsx` + `components/avatar-uploader.tsx` — avatar preview
  via the existing `avatar.tsx`, `<FileUpload>` (single, image allow-list, 5 MiB),
  `sign→PUT→complete→attach` then invalidate the profile query → avatar re-renders from the
  fresh signed `avatarUrl`.
- `app/(dashboard)/team/settings/page.tsx` + `components/org-logo-uploader.tsx` — owner/admin
  gated client-side (uploader hidden/read-only for members); server `organization.canWrite`
  is the authority (→403). `tenant-provider.tsx` extended to expose `activeRole`.
- `lib/file-upload-adapters.ts` — shared sign/complete/attach helpers that map the backend
  `{fileId,method,url,headers?,fields?,expiresAt}` envelope into the `UploadDescriptor`
  (`POST+fields → s3-post`, else `s3-put`; 413 → `quota_exceeded`).

### i18n `files` namespace (SC#4 of the component)

- `packages/i18n/src/locales/en/files.json` + `pt-BR/files.json` (dropzone, browse,
  uploading/processing/done, cancel/retry/remove, beforeUnload, all `errors.*`, plus
  `avatar.*`/`logo.*` page strings). `"files"` added to the `namespaces` array + static
  `enFiles`/`ptBRFiles` re-exports; `getMessages` picks it up automatically.

---

## Files touched

**New — packages/ui:**
- `src/components/file-upload.tsx`
- `src/hooks/use-file-upload.ts`
- `src/components/__tests__/file-upload.a11y.test.tsx`
- EDIT `src/index.ts` (barrel exports)

**New — packages/i18n:**
- `src/locales/en/files.json`, `src/locales/pt-BR/files.json`
- EDIT `src/index.ts` (namespaces + static exports)

**Edit — packages/shared:**
- `src/types/module.ts` (`cardinality?: "single" | "many"` on `FileRelation`)

**New/Edit — auth module:**
- `src/file-relations.ts` (new — specs + `isOwnerOrAdmin` + canRead/canWrite + max-byte consts)
- EDIT `src/index.ts` (`fileRelations: { user, organization }`)
- EDIT `src/queries/get-profile.ts` (`avatarUrl` via `ctx.dispatch`)
- TESTS: `src/__tests__/file-relations.test.ts`, `src/__tests__/get-profile.test.ts`

**New/Edit — files module:**
- `src/lib/soft-delete.ts` (new, extracted) + refactor `src/commands/delete-file.ts`
- EDIT `src/commands/attach-file.ts` (tx + cascade-on-replace for `cardinality:"single"`)
- TESTS: `src/__tests__/replace-cascade.test.ts`, `src/__tests__/cascade.test.ts`

**Edit — apps/api:**
- `src/index.ts` (`GET /api/profile` in the scoped band)

**New/Edit — apps/web:**
- `app/(dashboard)/profile/page.tsx`, `components/avatar-uploader.tsx`
- `app/(dashboard)/team/settings/page.tsx`, `components/org-logo-uploader.tsx`
- `components/tenant-provider.tsx` (expose `activeRole`)
- `lib/file-upload-adapters.ts`

**Planning:**
- `29-PLAN-CONTRACT.md`, `29-HUMAN-UAT.md`, `29-SUMMARY.md`, `29-VERIFICATION.md`

---

## Verification split — automated vs HUMAN-UAT

| Surface | Where it ran |
|---|---|
| `<FileUpload>` a11y + behavior (vitest + vitest-axe) | Local — `file-upload.a11y.test.tsx` 8 pass / 0 fail |
| auth file-relations + SVG-excluded + role gating | Local (live DB) — `file-relations.test.ts` + `get-profile.test.ts` 15 pass / 0 fail |
| get-profile `avatarUrl` via `ctx.dispatch` (latest-wins, null paths) | Local (live DB) — in the 15 above |
| cascade-on-replace + quota decrement + SVG sign reject | Local (live DB) — `replace-cascade.test.ts` + `sign-upload.test.ts` 9 pass / 0 fail |
| Full files module regression | Local (live DB) — 90 pass / 0 fail |
| files↔auth zero-import | `lint:cross-module` green + grep (only comment mentions) |
| pages type/compile against the Eden client | `bun run build:web` — webpack compiled successfully; see note |
| **Full-browser E2E** (load /profile, drag a file, watch variants land, beforeunload prompt, member 403) | **HUMAN-UAT-pending** — `29-HUMAN-UAT.md` (fragile in-workflow; not a blocking gate) |

`bun run build:web` **compiled successfully** (imports/JSX resolve for the new pages); the
build's only failure is a PRE-EXISTING static-prerender bailout on `/signup`
(`useSearchParams()` needs a Suspense boundary) — an existing auth page untouched by Phase 29.
The new `/profile` and `/team/settings` pages are `"use client"` and compile clean.

---

## Adversarial review outcome — 0 blockers + 2 warnings, addressed

**Blockers:** none.

**Warnings**
1. **`avatarUrl` could leak a non-owner's file via dispatch** — the dispatched
   `files:list-for-record` / `files:get-read-url` carry the SAME `handlerCtx` (same
   `userId`/`tenantId`), and the `user` relation's `canRead` is owner-only, so the read is
   self-scoped by construction. Hardened by asserting the latest-wins selection filters to
   `uploaded|ready` only and returns `null` (no read-url dispatch) when none qualify —
   covered by `get-profile.test.ts` "avatarUrl is null when no uploaded/ready file exists".
2. **Cascade-on-replace double-refund / orphaned-bytes risk** — refunding quota for a
   sibling that was never counted (e.g. still `pending`) would corrupt `bytes_used`.
   Resolved by routing BOTH `delete-file` and the cascade loop through the single
   `lib/soft-delete.ts` path that only refunds `COUNTED_STATUSES` and runs inside
   `attach-file`'s wrapping tx — proven by `replace-cascade.test.ts` (prior file soft-deleted,
   `byte_size` + variant bytes refunded, exactly one live `user` file remains) and the
   `many`-relation control case (no cascade on default relations).
