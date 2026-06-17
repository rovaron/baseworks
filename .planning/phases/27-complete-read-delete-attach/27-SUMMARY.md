# Phase 27 — SUMMARY

**Complete-Upload + Signed Read URLs + Delete + Generic Attachments**
Requirements: UPL-02, UPL-04, ATT-01, ATT-02, MOD-03 · Depends on Phase 26 (commit 2e3d90f)
Executed from `27-PLAN-CONTRACT.md` (LOCKED). Status: **Complete — fully live-DB verified (Docker up).**

---

## What was built

Phase 27 closes the synchronous upload loop opened in Phase 26. The files module
now owns the full lifecycle: sign → direct PUT → **server-authoritative complete**
→ signed read → soft-delete, plus the generic attach / list-for-record API any
module can drive without importing `@baseworks/module-files`, plus an
event-driven cascade subscriber.

### 1. complete-upload (UPL-02, SC#1) — `commands/complete-upload.ts`
`POST /api/files/:fileId/complete` (no body). Tenant-scoped load of the `pending`
row, then the server reads the **authoritative** size from object storage and
NEVER trusts the client's claim:

- `getFileStorage().stat({bucket,key})` → `ObjectStat.byteSize` is the source of
  truth. `null` (object never landed) → reject (`object_not_found`, 400).
- `authoritativeSize > relation.maxByteSize` → reject (`file_too_large`, 413).
- **Magic-byte check** via `file-type@22.0.0` (`fileTypeFromBuffer` over the
  first 4 KiB from `getObject`) in `lib/magic-bytes.ts`. Decision table:
  sniffed MIME in `allowedMimeTypes` → accept (`effectiveMime = sniff.mime`,
  overriding any lying declared Content-Type); sniffed MIME not allowed →
  reject (`mime_mismatch`, 400); no signature but every allowed type is in
  `DETECTABLE_MIME` → reject (`mime_unverifiable`, 400); no signature and a
  non-detectable type is allowed (e.g. `text/csv`) → accept the declared MIME.
- **Reject path** is a hard cleanup (no audit value): storage `delete` (best
  effort, idempotent) → DB row delete → `releaseQuota` (pending freed), all
  row-side work inside one tx.
- **Success path** (single tx): `UPDATE files SET byte_size=<authoritative>,
  mime_type=<effective>, status='uploaded'` guarded by `status='pending'`
  (count-once), then `markUploaded()`, then `emit("file.completed")` after
  commit. Status stops at `'uploaded'`; `'ready'` is reserved for Phase 28
  transforms. No `storageKey`/`bucket` in the response.
- Idempotent: a non-`pending` row returns `ok` with its current state, no
  re-stat, no double-count.

### 2. read-url (UPL-04, SC#2) — `queries/get-read-url.ts`
`GET /api/files/:fileId/read-url`. Tenant-scoped load, optional `relation.canRead`
gate (false → `not_found`/404, no existence leak), then
`signRead({ bucket, key, expiresInSec: env.STORAGE_SIGNED_URL_TTL_SEC,
responseContentDisposition })`. `dispositionFor` returns `inline` for `image/*`
and `application/pdf`, else `attachment` with the original filename. The DTO
carries only `{ url, expiresAt }` — the raw `storageKey`/`bucket` never leave the
module.

### 3. delete (UPL-04, SC#4) — `commands/delete-file.ts`
`DELETE /api/files/:fileId`. **Soft-delete** (preserves audit trail):
`SELECT ... FOR UPDATE` inside a tx to capture the PRIOR status (Postgres
`RETURNING` would read the post-update `'deleted'` — R3), then `UPDATE ... SET
deleted_at=now(), status='deleted'`. If the prior status was counted
(`uploaded`/`ready`/`transforming`) → `decrementUsed(tx)`. After commit:
best-effort idempotent `storage.delete`, then `emit("file.deleted", { fileId,
tenantId, ownerModule, ownerRecordType, ownerRecordId, byteSize })`. The DB
tombstone is the authoritative atomic action; a failed object-delete leaves an
orphan the Phase 31 reconciliation job sweeps (the tombstone is never lost).

### 4. attach + list-for-record (ATT-01, ATT-02, SC#3)
- **`ctx.dispatch`** — added `dispatch?(command, input): Promise<Result<unknown>>`
  to `HandlerContext` (`packages/shared/src/types/cqrs.ts`) and wired it in the
  scoped `.derive` of `apps/api/src/index.ts`. The closure self-references the
  SAME `handlerCtx` (so nested dispatch works and dispatched commands get a
  fully-formed ctx). String dispatch through `registry.getCqrs()` is **not** an
  `@baseworks/module-*` import, so the Phase 26 cross-module-import ban and the
  Phase 29 files↔auth ban both stay green. This is the ONLY `apps/api` edit.
- **`files:attach-file`** (`commands/attach-file.ts`): tenant-scoped load,
  consistency check (`row.ownerModule/ownerRecordType` must match input, else
  `relation_mismatch`/400), optional `relation.canWrite` gate (false →
  `forbidden`/403 — the caller proved file ownership via tenant scope but may
  not own the target record), then `UPDATE files SET owner_record_id=...`
  (allowed even while `pending`). The ergonomic `attachFile(ctx, args)` helper
  prefers `ctx.dispatch("files:attach-file", …)` (production bus path) and falls
  back to the direct command call in bare-ctx tests.
- **`files:list-for-record`** (`queries/list-for-record.ts`):
  `GET /api/files/list-for-record?ownerModule&ownerRecordType&recordId`. Optional
  `canRead` gate (false → `not_found`/404, not 403), then a tenant-scoped,
  owner-scoped, non-deleted list over `files_owner_idx`. DTOs carry
  `{ fileId, mimeType, byteSize, status, originalFilename, transforms,
  createdAt }` — no `storageKey`/`bucket`. A foreign-tenant record yields an
  empty list naturally; the explicit 404 is the existence-leak guard.

### 5. cascade-on-delete subscriber (MOD-03, SC#5) — `lib/cascade.ts` + `hooks/on-tenant-created.ts`
`registerFilesHooks(eventBus)` (already invoked after `registry.loadAll()`, so
the relations registry is populated) derives subscriptions from the registry:
for every `FileRelation` whose `onDelete === 'cascade'`, it subscribes to the
canonical deletion event `"<ownerModule>.<recordType>-deleted"` with payload
`{ tenantId, recordId }` (deduped per recordType). On fire, `cascadeSoftDelete`
runs an atomic tx: `SELECT ... FOR UPDATE` to capture rows + prior status,
soft-delete all matching non-deleted rows, `decrementUsed` by the sum of
counted rows' bytes, and `emit("file.deleted")` per row after commit. Physical
objects are left for Phase 31. Auth does **not** emit `auth.user-deleted` yet
(verified: it emits only `tenant.created/deleted`, `invitation.*`, `user.created`,
and has no user-deletion command) — per locked decision #2, auth was NOT
touched; the subscriber is proven by emitting the canonical event in-test. The
auth-side emit is wired in Phase 29; the `{tenantId,recordId}` contract is
pinned here so Phase 29 must conform.

### 6. env + dependency
- `STORAGE_SIGNED_URL_TTL_SEC` added to the `packages/config` Zod server schema
  (`z.coerce.number().int().min(300).max(900).default(600)` — 5–15 min window,
  default 10 min) and `.env.example`.
- `file-type@22.0.0` added to `packages/modules/files/package.json` (it was in
  `bun.lock` as an Elysia peer but not resolvable from the module dir);
  `bun install` ran (resolves R4).

## Quota-conservation approach

Bytes live in two buckets on `tenant_storage_usage`: `bytes_pending` (reserved
at sign-time, not yet confirmed) and `bytes_used` (confirmed on disk). The
transitions are single atomic SQL statements with `GREATEST(...,0)` underflow
guards — never read-modify-write:

| Transition | Helper | Effect |
|---|---|---|
| sign-upload | `reserveQuota` (Phase 26) | conditional `UPDATE` adds reserved bytes to `bytes_pending` only if `used+pending+size ≤ limit` |
| complete (success) | `markUploaded` | `bytes_pending -= reservedSize`, `bytes_used += authoritativeSize` in ONE statement |
| complete (reject) | `releaseQuota` (Phase 26) | `bytes_pending -= reservedSize` |
| delete / cascade (counted rows) | `decrementUsed` | `bytes_used -= byteSize` |

`markUploaded` releases EXACTLY the originally-reserved bytes from pending and
adds the AUTHORITATIVE bytes to used (size verification's whole point). The
`status='pending'` guard on the success `UPDATE` makes the count-once property
hold under concurrency: a second concurrent `/complete` of the same file updates
0 rows and short-circuits. Two concurrent rejects release the reservation
exactly once. Both are asserted by live-DB concurrency tests.

## Files touched

**New (all under `packages/modules/files/src/`, auto-exempt from the
files-access ban via the `packages/modules/files/` path prefix):**
`commands/complete-upload.ts`, `commands/delete-file.ts`, `commands/attach-file.ts`
(also exports the `attachFile` helper), `queries/get-read-url.ts`,
`queries/list-for-record.ts`, `lib/relation-lookup.ts`
(`findRelationByRecordType` + `dispositionFor`), `lib/magic-bytes.ts`
(`verifyMagicBytes` + `DETECTABLE_MIME`), `lib/cascade.ts`
(`cascadeSoftDelete`), and 7 test files (`complete-upload`, `delete-file`,
`read-url`, `attach-and-list`, `cascade`, `magic-bytes`, `route-no-leak`).

**Edited:** `packages/modules/files/src/index.ts` (register 4 commands + 2
queries, `events: [file.signed, file.completed, file.deleted]`, export
`attachFile`), `routes.ts` (6 routes: sign-upload, `/:fileId/complete`,
`/:fileId/read-url`, `/attach`, `/list-for-record`, `DELETE /:fileId`),
`lib/quota.ts` (+`markUploaded`, +`decrementUsed`),
`hooks/on-tenant-created.ts` (generic cascade subscriptions),
`package.json` (+`file-type@22.0.0`),
`packages/shared/src/types/cqrs.ts` (+`dispatch?`),
`apps/api/src/index.ts` (wire `handlerCtx.dispatch`),
`packages/config/src/env.ts` (+`STORAGE_SIGNED_URL_TTL_SEC`), `.env.example`.

## Verification

Fully verified against live Postgres (Docker up) with a temp-rooted
`LocalFileStorage` so `stat`/`getObject`/`delete` exercise the real filesystem:

```
DATABASE_URL=… bun test packages/modules/files  →  69 pass / 0 fail (231 expects)
```

Cross-module-import ban (`scripts/lint-no-cross-module-imports.sh`) and the
direct-files-access ban (`scripts/lint-no-direct-files-access.sh` +
`.biome ban-files-table-access.grit`) both remain green — `ctx.dispatch` is a
string-keyed bus call, not an import, and every new file is under the allow-listed
`packages/modules/files/` prefix. `bun biome check --write` run on all touched
files.

## Adversarial outcome — 1 blocker + 5 warnings, all addressed

- **BLOCKER (R4) — `file-type` not resolvable from the module dir.** It was in
  `bun.lock` as an Elysia peer but absent from `packages/modules/files/node_modules`;
  `import { fileTypeFromBuffer } from "file-type"` failed at runtime.
  **Fixed:** added explicit `"file-type": "22.0.0"` dep + `bun install`; resolution
  asserted before the magic-byte logic was wired. All 12 `magic-bytes.test.ts`
  cases (PNG/JPEG/WEBP/GIF/PDF accept, spoof-reject, lying-MIME override,
  unverifiable-reject, non-detectable fallback) pass.
- **WARNING (R1) — pending→used when authoritative ≠ reserved.** `markUploaded`
  decrements pending by the RESERVED size and increments used by the
  AUTHORITATIVE size, so an under-claiming client could transiently push
  `used+pending` above `limit`. **Bounded:** step 6 rejects
  `authoritative > maxByteSize`, capping per-file overage; sign-time already
  validated the claim. Documented; stricter re-reserve variant deferred to
  Phase 31.
- **WARNING (R2) — cross-tenant existence leak.** Every single-resource path
  keys its first SELECT on `id AND tenant_id`; a foreign id returns 0 rows →
  `not_found` → 404 (never 403/500). list-for-record returns 404 via the
  `canRead` gate. Asserted per endpoint.
- **WARNING (R3) — `RETURNING` reads post-update status.** Delete and cascade
  must know the PRIOR status to decide `wasCounted`; a `RETURNING status` would
  read `'deleted'`. Mandated SELECT-FOR-UPDATE-then-UPDATE inside a tx.
- **WARNING (R5) — recordType→relation assumed 1:1.** `findRelationByRecordType`
  returns the first relation in a module whose `recordType` matches (no `kind`
  column on the row — Phase 24 schema locked). Acceptable for the starter (1:1
  in practice); documented in the lib header.
- **WARNING (R6/R8) — full-object read for a 4 KiB sniff + unemitted cascade
  event.** `getObject` has no ranged read, so the whole object is fetched then
  `subarray(0,4096)` — bounded by `maxByteSize`; a ranged read is a future port
  extension. `auth.user-deleted` has no producer until Phase 29; the subscriber
  is proven by an in-test emit and the canonical `{tenantId,recordId}` payload
  is pinned here. Both documented in the respective file headers.
