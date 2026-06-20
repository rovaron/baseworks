# Phase 29 — Auth & Org Identity Asset Wiring + `<FileUpload>` — VERIFICATION

**Milestone:** v1.4 · **Requirements:** IDA-01, IDA-02 (+ absorbed UI-01, UI-02)
**Date:** 2026-06-17 · **Runners:** `bun test` (Bun 1.3.14, live Postgres + Redis) · `vitest` (packages/ui)

## Test-run evidence (commands + results)

| Command | Result |
|---|---|
| `cd packages/ui && bunx vitest run src/components/__tests__/file-upload.a11y.test.tsx` | **8 pass / 0 fail** |
| `cd packages/ui && bun run test` (full UI suite) | **28 pass / 1 fail** — the 1 fail is `data-table-cards.test.tsx` (Phase 22 admin component), PRE-EXISTING, unrelated to Phase 29; `file-upload.a11y.test.tsx` is among the 9 passing files |
| `bun test packages/modules/auth/.../get-profile.test.ts .../file-relations.test.ts` | **15 pass / 0 fail** (52 expects) |
| `bun test packages/modules/files/.../replace-cascade.test.ts .../sign-upload.test.ts` | **9 pass / 0 fail** (45 expects) |
| `bun test packages/modules/files` (full module regression) | **90 pass / 0 fail** (330 expects) |
| `bun run lint:cross-module` | green (no files↔auth import) |
| `bun run build:web` | webpack **compiled successfully**; build fails only at static prerender on the PRE-EXISTING `/signup` page (useSearchParams Suspense) — see note below |

---

## SC#1 — Avatar upload → variants 64/128/256/512 webp + `get-profile` resolves `avatarUrl` from the latest user-kind file

**Evidence:**
- Relation declaration (`packages/modules/auth/src/file-relations.ts` + `src/index.ts`):
  `user` relation declares `generateVariants` `avatar-64/128/256/512` webp,
  `cardinality:"single"`, 5 MiB cap. Asserted by
  `file-relations.test.ts` → `"collectFileRelations registers auth:user / auth:organization with frozen spec"`
  and `"the real auth ModuleDefinition wires the user + organization relations"`.
  (Variant GENERATION itself is the Phase 28 pipeline, already verified — `file.completed`
  → `image-transform` queue → `files.transforms`.)
- `avatarUrl` via `ctx.dispatch` (`queries/get-profile.ts`), `get-profile.test.ts`:
  - `"resolves the signed URL of the LATEST uploaded/ready file (latest-wins)"`
  - `"avatarUrl is null when no uploaded/ready file exists (no read-url call)"`
  - `"avatarUrl is null when the list dispatch fails"`
  - `"returns user profile when found"` / `"… not authenticated"` / `"… not found in db"`
- HTTP surface: `GET /api/profile` in the apps/api scoped band → Eden `api.api.profile.get()`.
- **avatarUrl is always a signed, expiring read URL** (`files:get-read-url`) — never a raw
  `storage_key`/`bucket`.

**Status:** ✅ MET (backend + denormalized accessor). Browser drag→preview→variants-land is
**HUMAN-UAT-pending** (29-HUMAN-UAT §1).

---

## SC#2 — Org logo upload, owner-gated, variants 128/256 webp, SVG rejected at sign-time, only jpeg/png/webp

**Evidence:**
- `organization` relation: variants `logo-128/256` webp, image allow-list with **SVG
  excluded**, owner/admin write. `file-relations.test.ts`:
  - `"organization relation: any member reads (recordId === tenantId)"`
  - `"organization.canWrite gates on owner/admin role + recordId === tenantId"`
  - `"owner → true; admin → true"`, `"plain member → false; non-member → false"`,
    `"missing userId/tenantId → false (no throw)"`
  - `"SVG excluded from both allow-lists (D-6)"`
- SVG rejected at sign-time:
  - `replace-cascade.test.ts` → `"image/svg+xml ⇒ err('mime_not_allowed')"`
  - `sign-upload.test.ts` → `"disallowed MIME ⇒ err('mime_not_allowed')"` (→ route HTTP 400;
    no file row, no quota).
- Server is the write authority via `organization.canWrite` (`isOwnerOrAdmin`, reads auth's
  own `member` table); client gate is UX-only.

**Status:** ✅ MET (relation + SVG reject + role gating). Owner-vs-member browser flow + 403
on forced attach is **HUMAN-UAT-pending** (29-HUMAN-UAT §2).

---

## SC#3 — auth declares `fileRelations: { user, organization }`; zero direct files↔auth import

**Evidence:**
- `ModuleDefinition.fileRelations` wired in `packages/modules/auth/src/index.ts`; discovered
  by the boot-time registry collection — `file-relations.test.ts`
  `"collectFileRelations registers auth:user / auth:organization with frozen spec"`.
- `bun run lint:cross-module` (Biome import-graph rule via
  `scripts/lint-no-cross-module-imports.sh`) — **green**.
- grep: the only `@baseworks/module-files` occurrences in `packages/modules/auth/src` are
  EXPLANATORY COMMENTS (`file-relations.ts:15`, `get-profile.ts:93`) — zero import statement.
- `get-profile` resolves the avatar purely via `ctx.dispatch("files:list-for-record")` +
  `ctx.dispatch("files:get-read-url")`.

**Status:** ✅ MET.

---

## SC#4 — Replacing an avatar deletes the prior file (cascade-on-replace, no pile-up); `bytes_used` decrements

**Evidence:**
- `cardinality:"single"` cascade in `attach-file` (tx-wrapped), sharing
  `lib/soft-delete.ts` with `delete-file`. `replace-cascade.test.ts`:
  - `"replacing an avatar soft-deletes the prior file + refunds byte_size + variant bytes"`
    — prior file → `status='deleted'` + `deleted_at` set, exactly one live `user` file
    remains, `bytes_used` decremented by the prior file's own bytes + variant bytes.
  - `"default (many) relation leaves prior files untouched on attach"` — control case: no
    cascade on non-single relations (backward-compatible default).
- `cascade.test.ts` (Phase 27 onDelete cascade) continues to pass in the full-module run.

**Status:** ✅ MET.

---

## Component SC (absorbed Phase 30, SC 1–5)

**Evidence — `file-upload.a11y.test.tsx` (8 pass / 0 fail, vitest + vitest-axe):**
- `"has no critical/serious violations in the default state"` (axe) — SC#4 a11y.
- `"renders a client-side oversize error with role=alert and stays axe-clean"` — SC#2 error
  state + `aria-live` announce.
- `"exposes a keyboard-focusable dropzone (role=button) and a file input"` — SC#1 drag-drop
  region + picker fallback; SC#4 keyboard-navigable.
- `"opens the hidden picker on Enter/Space from the dropzone"` — SC#1/#4 keyboard.
- `"rejects a wrong MIME type before signing"` — SC#2 client-side `wrong_mime`.
- `"reports real byte progress via xhr.upload.onprogress"` — SC#1 **real** (not synthetic)
  XHR byte progress.
- `"cancels an in-flight upload via xhr.abort()"` + `"honors cancel while still signing …"`
  — SC#1 cancel.
- Component source (`file-upload.tsx` / `use-file-upload.ts`) provides, by inspection:
  `UploadDescriptor` `kind` discriminator (`s3-put|s3-post|local`, SC#1); `multi` mode (SC#1);
  `URL.createObjectURL` preview revoked on remove/unmount (SC#1); full `UploadErrorCode` set
  incl. `quota_exceeded`/`network`(retry)/`mime_mismatch` (SC#2); i18n `labels` prop fed by
  the `files` namespace (SC#4); `beforeunload` guard while `isUploading` (SC#5).

**Status:** ✅ MET for automated coverage. Live drag-from-OS, real network-failure retry, and
the actual browser `beforeunload` confirmation prompt are **HUMAN-UAT-pending**
(29-HUMAN-UAT §5).

---

## Build note

`bun run build:web` reports `✓ Compiled successfully` — TypeScript/imports/JSX resolve for the
new `/profile` and `/team/settings` pages (both `"use client"`). The build then fails at the
**static prerender** stage on `/(auth)/signup/page` with
`useSearchParams() should be wrapped in a suspense boundary` — a PRE-EXISTING issue on an
existing auth page, NOT introduced by Phase 29 and NOT on any Phase 29 route. The Phase 29
pages compile clean.

---

## Summary

| SC | Requirement | Automated | HUMAN-UAT |
|----|-------------|-----------|-----------|
| 1 | IDA-01 avatar variants + `avatarUrl` denormalized accessor | ✅ MET (backend) | drag→variants-land (§1) |
| 2 | IDA-02 org logo owner-gated + SVG sign-reject | ✅ MET (relation + reject + roles) | owner/member browser + 403 (§2) |
| 3 | zero files↔auth import (Biome rule) | ✅ MET | — |
| 4 | cascade-on-replace + `bytes_used` decrement | ✅ MET | quota walk-through (§3) |
| C1–C5 | `<FileUpload>` component (absorbed Phase 30) | ✅ MET (vitest-axe 8/8) | live drag/network/beforeunload (§5) |

**All success criteria met by automated evidence.** Browser-E2E items are HUMAN-UAT-pending in
`29-HUMAN-UAT.md` (fragile in-workflow, not a blocking gate per the plan contract §8/§9). No
open blockers.
