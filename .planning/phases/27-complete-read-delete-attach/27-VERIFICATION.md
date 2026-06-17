# Phase 27 — VERIFICATION

**Complete-Upload + Signed Read URLs + Delete + Generic Attachments**
Requirements: UPL-02, UPL-04, ATT-01, ATT-02, MOD-03

**Verdict: PASS — all 5 Success Criteria met, fully verified against live Postgres (Docker up).**

## How it was run

```
DATABASE_URL=postgres://baseworks:baseworks@localhost:5432/baseworks \
  bun test packages/modules/files
```

Result: **69 pass / 0 fail · 231 expect() calls · 11 files · ~1.7s.**

Integration tests use a temp-rooted `LocalFileStorage` (`STORAGE_PROVIDER=local`,
`STORAGE_LOCAL_PATH=<tmp>`) so `stat`/`getObject`/`delete` exercise the real
filesystem — the authoritative-size and reject-path cleanup are observed against
actual objects on disk, not mocks.

---

## SC#1 — complete-upload reads authoritative size + magic-byte rejects mismatches

**Requirement:** UPL-02. Server `HEAD`s storage for the authoritative `byte_size`
(never the client's claim); `file-type` magic-byte check on the first 4 KB
rejects MIME mismatches by deleting the storage object + DB row + decrementing
`bytes_pending`.

| Evidence | Location |
|---|---|
| `happy path ⇒ status 'uploaded', AUTHORITATIVE byteSize, pending→used` | `src/__tests__/complete-upload.test.ts` |
| `magic-byte mismatch ⇒ reject: storage object + DB row deleted, pending freed` | `src/__tests__/complete-upload.test.ts` |
| `authoritative size > maxByteSize ⇒ reject (413): object + row deleted` | `src/__tests__/complete-upload.test.ts` |
| `unknown fileId ⇒ err('not_found') (404, no leak)` | `src/__tests__/complete-upload.test.ts` |
| `CONCURRENT /complete of the same pending file ⇒ bytes counted ONCE (SC#3 conservation)` | `src/__tests__/complete-upload.test.ts` |
| `CONCURRENT /complete that BOTH reject ⇒ reservation released ONCE (no over-release)` | `src/__tests__/complete-upload.test.ts` |
| `already 'uploaded' ⇒ idempotent ok, no double-count` | `src/__tests__/complete-upload.test.ts` |
| 12 magic-byte cases (PNG/JPEG/WEBP/GIF/PDF accept; lying-MIME override; spoof reject; PDF-only relation reject; unverifiable reject; non-detectable `text/csv` fallback; mixed allow-list fallback; DETECTABLE_MIME set) | `src/__tests__/magic-bytes.test.ts` |

**Authoritative-size assertion result:** the happy-path test writes an object to
local storage whose real byte length differs from the client's signed claim, then
asserts the completed row's `byteSize` equals `stat().byteSize` (the on-disk
size), and that `bytes_pending` dropped by the reserved size while `bytes_used`
rose by the authoritative size — verified, count-once. Implementation:
`commands/complete-upload.ts` + `lib/magic-bytes.ts` (`file-type@22.0.0`,
`SNIFF_BYTES=4096`). **7+12 = 19 tests pass.**

## SC#2 — short-lived signed read URL; no raw storage_key in any response

**Requirement:** UPL-04. `GET /:fileId/read-url` returns a 5–15 min
env-configurable (`STORAGE_SIGNED_URL_TTL_SEC`) signed GET URL; raw `storage_key`
NEVER appears in any `/api/files/*` JSON response.

| Evidence | Location |
|---|---|
| `happy path ⇒ ok({url,expiresAt}), env TTL, inline disposition, NO key/bucket` | `src/__tests__/read-url.test.ts` |
| `unknown fileId ⇒ err('not_found') (404)` | `src/__tests__/read-url.test.ts` |
| `canRead denial ⇒ err('not_found') → 404, NOT 403 (no existence leak)` | `src/__tests__/read-url.test.ts` |
| 6 route-level no-leak scans across sign-upload, complete, read-url, attach, list-for-record, delete | `src/__tests__/route-no-leak.test.ts` |

**No-leak assertion result:** `route-no-leak.test.ts` serializes each route's JSON
body and asserts the raw `storageKey`/`bucket` substring is absent and no
`storageKey`/`bucket` field is present — across all 6 `/api/files/*` endpoints.
Env TTL asserted to flow from `STORAGE_SIGNED_URL_TTL_SEC` into
`signRead({expiresInSec})`. Implementation: `queries/get-read-url.ts`,
`packages/config/src/env.ts:83`. **3+6 = 9 tests pass.**

## SC#3 — attachFile server-side; list-for-record with canRead; cross-tenant 404

**Requirement:** ATT-01, ATT-02. `attachFile(ctx, {...})` server-side;
`GET /list-for-record` returns the file list with per-relation `canRead`
enforcement; cross-tenant attempt → 404 (not 403).

| Evidence | Location |
|---|---|
| `direct command links the previously-unattached row` | `src/__tests__/attach-and-list.test.ts` |
| `helper prefers ctx.dispatch (the production bus path)` | `src/__tests__/attach-and-list.test.ts` |
| `cross-tenant fileId ⇒ err('not_found') (R2 — no existence leak)` | `src/__tests__/attach-and-list.test.ts` |
| `owner relation mismatch ⇒ err('relation_mismatch')` | `src/__tests__/attach-and-list.test.ts` |
| `relation.canWrite false ⇒ err('forbidden') (403)` | `src/__tests__/attach-and-list.test.ts` |
| `returns only the tenant's non-deleted rows, no storageKey/bucket` | `src/__tests__/attach-and-list.test.ts` |
| `canRead false ⇒ err('not_found') (no existence leak; NOT 403)` | `src/__tests__/attach-and-list.test.ts` |
| `canRead true ⇒ returns the rows` | `src/__tests__/attach-and-list.test.ts` |

**Dispatch assertion result:** `helper prefers ctx.dispatch` builds a ctx with a
`dispatch` stub routing to `files:attach-file` and asserts the helper takes the
bus path (the production cross-module mechanism), while the cross-tenant case
returns `not_found`/404. The `ctx.dispatch` channel is wired in
`apps/api/src/index.ts:305` against `registry.getCqrs()` and typed on
`HandlerContext` (`packages/shared/src/types/cqrs.ts:47`). Implementation:
`commands/attach-file.ts`, `queries/list-for-record.ts`. **8 tests pass.**

## SC#4 — DELETE soft-deletes atomically; bytes_used decrements; file.deleted emitted

**Requirement:** UPL-04. `DELETE /:fileId` removes the object + soft-deletes the
row atomically; `tenant_storage_usage.bytes_used` decrements; `file.deleted`
emitted on the bus.

| Evidence | Location |
|---|---|
| `counted row ⇒ soft-delete + bytes_used decrement + object unlinked + file.deleted` | `src/__tests__/delete-file.test.ts` |
| `pending row ⇒ soft-delete + emit, NO bytes_used decrement` | `src/__tests__/delete-file.test.ts` |
| `unknown fileId ⇒ err('not_found'), no emit` | `src/__tests__/delete-file.test.ts` |

**Decrement assertion result:** the counted-row test inserts an `uploaded` file
with `bytes_used` bumped, calls delete, then asserts `deleted_at` set +
`status='deleted'`, the physical object unlinked from local storage,
`bytes_used` decremented by the row's `byteSize`, and `file.deleted` emitted with
the full owner payload. The `pending`-row case proves a non-counted row is
tombstoned + emitted but does NOT touch `bytes_used` (its bytes live in
`bytes_pending`). PRIOR status captured via SELECT-FOR-UPDATE (R3).
Implementation: `commands/delete-file.ts`, `lib/quota.ts` (`decrementUsed`).
**3 tests pass.**

## SC#5 — cascade-on-delete via event subscription

**Requirement:** MOD-03. Deleting an owner record fires the deletion event; the
files module subscribes and soft-deletes the owner's files per the relation's
`onDelete: 'cascade'` setting.

| Evidence | Location |
|---|---|
| `owner-deletion event ⇒ cascade soft-delete + bytes_used decrement; non-cascade untouched` | `src/__tests__/cascade.test.ts` |
| `deletion event for a record that owns no files ⇒ no-op (no decrement, no emit)` | `src/__tests__/cascade.test.ts` |

**Cascade assertion result:** the test registers a `recordType:'user'`,
`ownerModule:'auth'`, `onDelete:'cascade'` relation; inserts 2 `uploaded` files
for `(auth, user, U1)` and bumps `bytes_used`; builds an event bus, runs
`registerFilesHooks(bus)`, then `bus.emit("auth.user-deleted", { tenantId,
recordId:'U1' })`. It asserts both rows get `deleted_at` + `status='deleted'`,
`bytes_used` decremented by their summed `byteSize`, and that a non-cascade
relation's files for the same record are UNTOUCHED. The no-op case proves a
deletion event for a record owning no files makes no decrement and emits nothing.
Per locked decision #2, auth was NOT modified — it emits no `auth.user-deleted`
yet (verified); the subscriber is proven by the in-test emit and the canonical
`{tenantId,recordId}` payload is pinned for Phase 29. Implementation:
`lib/cascade.ts` (`cascadeSoftDelete`), `hooks/on-tenant-created.ts`
(`registerFilesHooks` derives subscriptions from `fileRelationsRegistry`).
**2 tests pass.**

---

## Cross-cutting gates

- **No-leak (storage_key/bucket):** asserted on all 6 routes
  (`route-no-leak.test.ts`).
- **Cross-module-import ban** (`scripts/lint-no-cross-module-imports.sh`):
  green — `ctx.dispatch` is a string-keyed bus call, not an
  `@baseworks/module-*` import.
- **Direct-files-access ban** (`scripts/lint-no-direct-files-access.sh` +
  `.biome ban-files-table-access.grit`): green — every new file is under the
  allow-listed `packages/modules/files/` prefix.
- **Formatting:** `bun biome check --write` run on all touched files.

## Deferred (non-blocking, documented in headers / risks)

- R1: stricter re-reserve of `(authoritative − reserved)` delta → Phase 31.
- R5: `kind` column to remove the recordType→relation 1:1 assumption → out of
  scope (Phase 24 schema locked).
- R6: ranged `getObject` to avoid full-object read for the 4 KiB sniff → future
  port extension.
- R7/R8: physical-object orphan reconciliation + the auth-side
  `auth.user-deleted` emit → Phase 31 / Phase 29 respectively.
