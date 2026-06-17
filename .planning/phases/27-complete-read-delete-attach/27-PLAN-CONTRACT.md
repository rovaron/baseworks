# Phase 27 — PLAN CONTRACT (LOCKED)

**Complete-Upload + Signed Read URLs + Delete + Generic Attachments**
Requirements: UPL-02, UPL-04, ATT-01, ATT-02, MOD-03 · Depends on Phase 26 (commit 2e3d90f)
Header docs on every touched file cite `Phase 27 / <REQ>`. Result = `{success:true,data}|{success:false,error}`. Never expose `storageKey`/`bucket`/raw key in any response.

This document is the authoritative contract. The 5 ROADMAP Success Criteria + the 6 locked decisions below ARE the spec; the implementer honors them verbatim.

---

## 0. Existing primitives (verified — do not re-derive)

- `files` table (`packages/db/src/schema/storage.ts`): cols `id, tenantId, ownerModule, ownerRecordType, ownerRecordId, storageKey, bucket, mimeType, byteSize(bigint,number), checksum, originalFilename, transforms(jsonb[]), status, uploadedByUserId, deletedAt`. status CHECK ∈ `pending|uploaded|transforming|ready|failed|deleted`. Index `files_owner_idx (tenantId,ownerModule,ownerRecordType,ownerRecordId)`. **No `kind` column** — relation must be recovered from `(ownerModule, ownerRecordType)` (see §1.0).
- `tenant_storage_usage`: PK `tenantId`, `bytesUsed`, `bytesPending`, `bytesLimit(nullable)`, `updatedAt`.
- FileStorage port (`packages/storage/src/ports/file-storage.ts`): `stat({bucket,key})->ObjectStat|null` (`.byteSize` server-authoritative), `getObject({bucket,key})->Uint8Array` (FULL object), `signRead({bucket,key,expiresInSec,responseContentDisposition?})->{url,expiresAt}` (never returns key), `delete({bucket,key})->void` (idempotent). LocalFileStorage `stat` = `fs.stat().size`; `getObject` = full file read.
- `fileRelationsRegistry` (`@baseworks/storage`): `.get(ownerModule,kind)`, `.getAll(): ReadonlyMap<"module:kind", FileRelation>`. `FileRelation = { recordType, allowedMimeTypes[], maxByteSize, generateVariants?, onDelete?:"cascade"|"orphan", canRead?(ctx,recordId):Promise<bool>, canWrite?(ctx,recordId):Promise<bool> }`.
- CQRS: `defineCommand(schema,handler)`, `defineQuery(schema,handler)`, `ok`, `err` from `@baseworks/shared`. `CqrsBus.execute<T>(cmd,input,ctx)` / `.query<T>(name,input,ctx)` → `Result<T>`; unknown key → `err("COMMAND_NOT_FOUND")`/`"QUERY_NOT_FOUND"`.
- `HandlerContext = { tenantId, userId?, db(ScopedDb), headers?, emit(event,data), enqueue? }`. Direct files/raw-SQL access uses `getDb(env.DATABASE_URL)` + `files,tenantStorageUsage` from `@baseworks/db` + `and,eq,sql,inArray` from `drizzle-orm`. The module is allow-listed: `scripts/lint-no-direct-files-access.sh` ALLOWLIST is the path-prefix `packages/modules/files/` — **every new file under that dir is auto-exempt** (no per-file edit needed).
- Routes mount auto via `registry.getModuleRoutes()` in the scoped band; `ctx.handlerCtx` is guaranteed present. Param routes use `ctx.params.fileId`. Error→status map handled per-route.

### §1.0 Relation recovery from a files row (load-bearing helper)
The row stores `ownerModule + ownerRecordType` but NOT `kind`; the registry is keyed by `(ownerModule, kind)`. New helper in `lib/relation-lookup.ts`:

```ts
// findRelationByRecordType(ownerModule, recordType): FileRelation | undefined
//   scans fileRelationsRegistry.getAll(); returns the relation whose key
//   starts with `${ownerModule}:` AND relation.recordType === recordType.
//   First match wins (recordType↔kind is 1:1 in practice — see Risk R5).
```

---

## 1. complete-upload (UPL-02, SC#1)

**Route:** `POST /api/files/:fileId/complete` — no request body. Param `ctx.params.fileId`.
**Command:** `files:complete-upload`, input schema `Type.Object({ fileId: Type.String({minLength:1}) })`.
**File:** `commands/complete-upload.ts`.

### State machine (exact order)
1. **Load** the row tenant-scoped: `SELECT * FROM files WHERE id=fileId AND tenant_id=ctx.tenantId AND deleted_at IS NULL` (via `getDb`). None → `err("not_found")` → **404** (cross-tenant id also lands here → 404, no leak).
2. **Idempotency:** if `row.status !== 'pending'` (already `uploaded`/`ready`/`transforming`) → return `ok({ fileId, status: row.status, byteSize: row.byteSize })` (no double-count, no re-stat).
3. **Resolve relation** via `findRelationByRecordType(row.ownerModule, row.ownerRecordType)`. Missing → `err("unknown_relation")` → 400 (should not happen for a sign-upload row).
4. Capture `reservedSize = row.byteSize` (the size reserved at sign-time), `bucket = row.bucket`, `key = row.storageKey`.
5. **Authoritative stat:** `const st = await getFileStorage().stat({bucket,key})`.
   - `st === null` → object never landed (PUT failed / client raced). **Reject path** (§1.1) → `err("object_not_found")` → **400**.
6. `authoritativeSize = st.byteSize`. If `authoritativeSize > relation.maxByteSize` → **Reject path** → `err("file_too_large")` → **413**.
7. **Magic-byte check** (`file-type`):
   - `const buf = await getFileStorage().getObject({bucket,key});` (full object; slice below).
   - `const sniff = await fileTypeFromBuffer(buf.subarray(0, 4096));` → `{ext,mime}|undefined`.
   - **Decision table** (`DETECTABLE_MIME` = `{image/png,image/jpeg,image/webp,image/gif,application/pdf}` — the set `file-type` reliably signs and that `extFromMime` maps):
     - `sniff` defined & `sniff.mime ∈ relation.allowedMimeTypes` → ACCEPT; `effectiveMime = sniff.mime`.
     - `sniff` defined & `sniff.mime ∉ allowedMimeTypes` → **Reject path** → `err("mime_mismatch")` → **400**.
     - `sniff` undefined & `relation.allowedMimeTypes.every(m => DETECTABLE_MIME.has(m))` → we EXPECTED a signature, got none → **Reject path** → `err("mime_unverifiable")` → **400**.
     - `sniff` undefined & some allowed type is non-detectable (e.g. `text/csv`,`application/json`) → ACCEPT; `effectiveMime = row.mimeType` (keep the client-declared MIME — magic check is not applicable).
8. **Success path** (single transaction `db.transaction(async tx => {...})`):
   - `UPDATE files SET byte_size=${authoritativeSize}, mime_type=${effectiveMime}, status='uploaded', updated_at=now() WHERE id=${fileId} AND tenant_id=${tenantId} AND status='pending'`.
   - `markUploaded(tx, tenantId, reservedSize, authoritativeSize)` (§3).
   - `emit("file.completed", { fileId, tenantId, byteSize: authoritativeSize, mimeType: effectiveMime })` AFTER commit (optional event; not required by SC but cheap and symmetric).
   - Return `ok({ fileId, status: 'uploaded', byteSize: authoritativeSize, mimeType: effectiveMime })`. **No storageKey/bucket.**

> Status is `'uploaded'` (not `'ready'`). `'ready'` is reserved for post-transform (Phase 28). If `relation.generateVariants` exists, Phase 28 flips `uploaded→transforming→ready`; Phase 27 stops at `uploaded`.

### §1.1 Reject path (shared by steps 5/6/7)
A rejected upload never became a real file → **hard** cleanup (no audit value):
```
await getFileStorage().delete({bucket,key}).catch(()=>{});   // idempotent, best-effort
await db.delete(files).where(and(eq(files.tenantId,tenantId), eq(files.id,fileId)));
await releaseQuota(db, tenantId, reservedSize);              // existing helper — release pending
return err(<code>);   // route maps mime_*→400, file_too_large→413, object_not_found→400
```
Order: storage delete → DB row delete → releaseQuota. Wrap row-delete + releaseQuota in a `tx` for atomicity; storage delete outside tx (best-effort, idempotent).

### Route handler (`routes.ts`)
```ts
.post("/:fileId/complete", async (ctx:any) => {
  const r = await completeUpload({ fileId: ctx.params.fileId }, ctx.handlerCtx);
  if (!r.success) { ctx.set.status = mapComplete(r.error); return { error: r.error }; }
  return r.data;
})
// mapComplete: not_found→404; file_too_large→413; mime_mismatch|mime_unverifiable|object_not_found|unknown_relation→400; else 400
```

---

## 2. read-url (UPL-04, SC#2)

**Route:** `GET /api/files/:fileId/read-url`. **Query:** `files:get-read-url`, input `Type.Object({ fileId: Type.String({minLength:1}) })`.
**File:** `queries/get-read-url.ts`.
1. Load row tenant-scoped (id+tenantId, `deleted_at IS NULL`). None → `err("not_found")` → **404** (cross-tenant → 404).
2. Resolve relation via `findRelationByRecordType(ownerModule, ownerRecordType)`. If `relation?.canRead` defined → `await relation.canRead(ctx, row.ownerRecordId)`; `false` → `err("not_found")` → **404** (NOT 403 — no existence leak).
3. `const signed = await getFileStorage().signRead({ bucket: row.bucket, key: row.storageKey, expiresInSec: env.STORAGE_SIGNED_URL_TTL_SEC, responseContentDisposition: dispositionFor(row) });`
   - `dispositionFor`: `inline` for `image/*` & `application/pdf`; else `attachment; filename="..."` from `originalFilename` (optional nicety; omit if unset).
4. Return `ok({ url: signed.url, expiresAt: signed.expiresAt })`. **No storageKey.**

Route maps `not_found`→404, else 400. The Verify phase scans every `/api/files/*` JSON response body for the raw key prefix — the DTO carries only `url`+`expiresAt`.

---

## 3. quota transitions (`lib/quota.ts` — extend)

`markUploaded` — pending→used in ONE atomic statement (called inside the complete-upload tx; accepts the `tx` as the `db` arg):
```ts
export async function markUploaded(db, tenantId, reservedSize, authoritativeSize): Promise<void> {
  await db.execute(sql`
    UPDATE tenant_storage_usage
       SET bytes_pending = GREATEST(bytes_pending - ${reservedSize}, 0),
           bytes_used    = bytes_used + ${authoritativeSize},
           updated_at    = now()
     WHERE tenant_id = ${tenantId}
  `);
}
```
> Releases EXACTLY the originally-reserved bytes from pending; adds the AUTHORITATIVE bytes to used (size verification's whole point). `GREATEST(...,0)` guards pending underflow. See Risk R1 for `authoritative != reserved`.

`decrementUsed` — delete/cascade path (counted rows only):
```ts
export async function decrementUsed(db, tenantId, size): Promise<void> {
  await db.execute(sql`
    UPDATE tenant_storage_usage
       SET bytes_used = GREATEST(bytes_used - ${size}, 0),
           updated_at = now()
     WHERE tenant_id = ${tenantId}
  `);
}
```
`reserveQuota`/`releaseQuota` unchanged.

---

## 4. delete (UPL-04, SC#4)

**Route:** `DELETE /api/files/:fileId`. **Command:** `files:delete-file`, input `Type.Object({ fileId: Type.String({minLength:1}) })`.
**File:** `commands/delete-file.ts`. Soft-delete (preserve audit trail).
1. **Soft-delete + read prior state in ONE statement** (tenant-scoped, idempotent on concurrent delete):
   ```sql
   UPDATE files SET deleted_at=now(), status='deleted', updated_at=now()
   WHERE id=${fileId} AND tenant_id=${tenantId} AND deleted_at IS NULL
   RETURNING bucket, storage_key, byte_size, status  -- status = PRIOR status (RETURNING sees pre-... no: RETURNING returns NEW row)
   ```
   > Postgres `RETURNING` returns the POST-update row, so `status` would read `'deleted'`. To capture the PRIOR status, **SELECT-then-UPDATE inside a tx**: `SELECT bucket, storage_key, byte_size, status ... FOR UPDATE` → capture `wasCounted = priorStatus ∈ {'uploaded','ready','transforming'}` → then the `UPDATE ... SET deleted_at...`. 0 rows from the SELECT → `err("not_found")` → **404** (cross-tenant → 404).
2. If `wasCounted` → `decrementUsed(tx, tenantId, byteSize)`. (A `pending` row's bytes live in `bytes_pending`, not `bytes_used`; deleting one is an edge case left to the Phase 31 cleanup job — Phase 27 only decrements `bytes_used` for counted rows, per locked decision #5.)
3. Commit tx. THEN `await getFileStorage().delete({bucket, key}).catch(track)` (best-effort, idempotent; physical object).
4. `emit("file.deleted", { fileId, tenantId, ownerModule, ownerRecordType, ownerRecordId, byteSize })`.
5. Return `ok({ fileId, deleted: true })`.

**Atomicity statement:** true cross-system (DB+object-store) atomicity is impossible. The authoritative atomic action is the DB soft-delete (single tx: tombstone + usage decrement). The physical `storage.delete` is idempotent best-effort AFTER commit; a failed object-delete leaves an orphan the Phase 31 reconciliation job sweeps — the tombstone is never lost. Route maps `not_found`→404, else 400.

---

## 5. attach + list-for-record (ATT-01, ATT-02, SC#3)

### 5.1 `ctx.dispatch` — cross-module invocation WITHOUT import
**Edit `packages/shared/src/types/cqrs.ts`** — add to `HandlerContext`:
```ts
/** String-keyed CQRS dispatch through the bus (NOT a module import). Lets one
 *  module invoke another's command by name — satisfies the cross-module-import
 *  ban (Phase 26 SC#5) and the files↔auth ban (Phase 29). Optional: absent in
 *  bare test contexts. */
dispatch?: (command: string, input: unknown) => Promise<Result<unknown>>;
```
**Edit `apps/api/src/index.ts`** scoped `.derive` (the `handlerCtx` builder, ~line 290). Build the object, then attach `dispatch` referencing the SAME object (self-reference so dispatched commands get a fully-formed ctx, dispatch included → nested dispatch works):
```ts
.derive({ as: "scoped" }, (ctx:any) => {
  const handlerCtx: HandlerContext = {
    tenantId: ctx.tenantId, userId: ctx.userId, db: scopedDb(db, ctx.tenantId),
    headers: ctx.request.headers,
    emit: (event,data) => registry.getEventBus().emit(event, {...}),
  };
  handlerCtx.dispatch = (command, input) =>
    registry.getCqrs().execute(command, input, handlerCtx);
  return { handlerCtx };
})
```
This is the ONLY apps/api edit. String dispatch through `registry.getCqrs()` is not an `@baseworks/module-*` import, so `scripts/lint-no-cross-module-imports.sh` stays green.

### 5.2 attach — command + ergonomic helper
**Command** `files:attach-file` (`commands/attach-file.ts`), input:
```ts
Type.Object({ fileId: Type.String({minLength:1}), ownerModule: Type.String({minLength:1}),
              ownerRecordType: Type.String({minLength:1}), ownerRecordId: Type.String({minLength:1}) })
```
1. Load row tenant-scoped (id+tenantId, `deleted_at IS NULL`). None → `err("not_found")` → **404** (cross-tenant → 404).
2. Consistency: `row.ownerModule === input.ownerModule && row.ownerRecordType === input.ownerRecordType` else `err("relation_mismatch")` → 400 (the file was minted for a different relation at sign-time).
3. `relation = findRelationByRecordType(ownerModule, ownerRecordType)`. If `relation?.canWrite` defined → `await canWrite(ctx, ownerRecordId)`; `false` → `err("forbidden")` → **403** (write-perm: 403 is correct — caller already proved they own the file via tenant scope; this gates linking to a specific record they may not own).
4. `UPDATE files SET owner_record_id=${ownerRecordId}, updated_at=now() WHERE id AND tenant_id` (allowed even while `pending` — attach may precede or follow complete).
5. Return `ok({ fileId, ownerRecordId })`.

**Ergonomic helper** (`lib/attach-file.ts`), exported from module index for in-module/test use:
```ts
export async function attachFile(ctx, args): Promise<Result<{fileId,ownerRecordId}>> {
  return ctx.dispatch ? ctx.dispatch("files:attach-file", args) as ... : attachFileCommand(args, ctx);
}
```
Prefers `ctx.dispatch` when present (production path); falls back to direct command call (bare-ctx tests). Cross-module callers (auth, Phase 29) use `ctx.dispatch("files:attach-file", {...})` — no helper import.

### 5.3 list-for-record (ATT-01)
**Route:** `GET /api/files/list-for-record?ownerModule=X&ownerRecordType=Y&recordId=Z`. **Query** `files:list-for-record` (`queries/list-for-record.ts`):
```ts
Type.Object({ ownerModule: Type.String({minLength:1}), ownerRecordType: Type.String({minLength:1}),
              recordId: Type.String({minLength:1}) })
```
1. `relation = findRelationByRecordType(ownerModule, ownerRecordType)`. If `relation?.canRead` defined → `await canRead(ctx, recordId)`; `false` → `err("not_found")` → **404** (NOT 403).
2. `SELECT id, mime_type, byte_size, status, original_filename, transforms, created_at FROM files WHERE tenant_id=${tenantId} AND owner_module=${ownerModule} AND owner_record_type=${ownerRecordType} AND owner_record_id=${recordId} AND deleted_at IS NULL ORDER BY created_at` (uses `files_owner_idx`).
3. Map to DTOs: `{ fileId, mimeType, byteSize, status, originalFilename, transforms, createdAt }`. **No storageKey, no bucket.** To obtain a viewable URL the client calls `read-url` per file.
4. Return `ok({ files: [...] })`. Tenant-scoping means a foreign-tenant record yields an empty list naturally; the explicit 404 is the `canRead` gate (existence-leak guard).

Route handler reads `ctx.query`. Maps `not_found`→404, else 400.

---

## 6. cascade-on-delete subscriber (MOD-03, SC#5)

**File:** extend `hooks/on-tenant-created.ts` (or new `hooks/register-hooks.ts` re-exported as `registerFilesHooks`) + `lib/cascade.ts`. `registerFilesHooks` already runs in `apps/api/src/index.ts` AFTER `registry.loadAll()`, so `fileRelationsRegistry` is populated at subscription time.

### Deletion-event contract (canonical, locked)
`<ownerModule>.<recordType>-deleted` with payload `{ tenantId: string, recordId: string }`. Example: deleting a user → `auth.user-deleted` `{ tenantId, recordId: <userId> }`. **Auth does NOT emit this yet** (verified: auth emits `tenant.created/deleted`, `invitation.*`, `user.created` — no user-deleted, no user-deletion command). Per locked decision #2, do **NOT** touch auth. The auth-side emit is wired in Phase 29. Phase 27 proves the subscriber by emitting the event IN-TEST.

### Generic subscriber (derive subscriptions from the registry)
Inside `registerFilesHooks(eventBus)`, after the existing `tenant.created` handler:
```ts
const seen = new Set<string>();
for (const [key, rel] of fileRelationsRegistry.getAll()) {
  if (rel.onDelete !== "cascade") continue;
  const ownerModule = key.slice(0, key.indexOf(":"));
  const eventName = `${ownerModule}.${rel.recordType}-deleted`;
  if (seen.has(eventName)) continue;           // dedupe: two kinds, same recordType
  seen.add(eventName);
  eventBus.on(eventName, async (data:any) => {
    const tenantId = data?.tenantId, recordId = data?.recordId;
    if (!tenantId || !recordId) return;        // malformed event → ignore (resilient)
    try { await cascadeSoftDelete(getDb(env.DATABASE_URL), {
            tenantId, ownerModule, recordType: rel.recordType, recordId, emit: eventBus.emit.bind(eventBus) });
    } catch (e) { getErrorTracker().captureException(e, { tenantId, tags:{ module:"files", hook:eventName }}); }
  });
}
```

### `cascadeSoftDelete` (`lib/cascade.ts`) — atomic tx
```ts
// 1. SELECT id, byte_size, status FROM files
//      WHERE tenant_id AND owner_module AND owner_record_type AND owner_record_id=recordId
//        AND deleted_at IS NULL   FOR UPDATE
//    (capture rows + prior status before tombstoning)
// 2. if rows.length === 0 → return (nothing owned)
// 3. UPDATE files SET deleted_at=now(), status='deleted', updated_at=now()
//      WHERE <same predicate> AND deleted_at IS NULL
// 4. countedBytes = sum(byte_size) over rows whose prior status ∈ {uploaded,ready,transforming}
//    if countedBytes > 0 → decrementUsed(tx, tenantId, countedBytes)
// 5. (after commit) for each row: emit("file.deleted", { fileId, tenantId, ... })
```
**Physical objects are NOT deleted here** — left for the Phase 31 orphan-reconciliation sweep (keeps the subscriber fast and the cascade DB-atomic; the SC#5 test asserts soft-delete + `bytes_used` decrement only). Document this in the file header.

### Test (SC#5)
Register a relation with `onDelete:'cascade'` (recordType `'user'`, ownerModule `'auth'`); insert 2 `uploaded` files for `(auth, user, U1)` + bump `bytes_used`; build an eventBus, call `registerFilesHooks(bus)`, `bus.emit("auth.user-deleted", { tenantId, recordId:'U1' })`; assert both rows `deleted_at` set + `status='deleted'` + `bytes_used` decremented by their sum, and a non-cascade relation's files for `U1` are untouched.

---

## 7. env — STORAGE_SIGNED_URL_TTL_SEC

**`packages/config/src/env.ts`** (add to `serverSchema`, after `STORAGE_DEFAULT_QUOTA_BYTES`):
```ts
// Phase 27 / UPL-04 — signed READ-URL TTL in seconds. 5–15 min window; default 10 min.
STORAGE_SIGNED_URL_TTL_SEC: z.coerce.number().int().min(300).max(900).default(600),
```
**`.env.example`** (Phase 24 storage block):
```
# Phase 27 — Signed read-URL TTL in seconds (5–15 min; default 600 = 10 min).
STORAGE_SIGNED_URL_TTL_SEC=600
```

---

## 8. magic-byte library choice — `file-type` (JUSTIFIED)

**Use `file-type@22.0.0`.** Rationale:
- It is the ROADMAP SC#1 named approach ("`file-type` magic-byte check on the first 4KB").
- Already present in `bun.lock` (v22.0.0, as an Elysia peer) — but **NOT installed into `node_modules`**. The implementer MUST add `"file-type": "22.0.0"` to `packages/modules/files/package.json` dependencies and run `bun install` (verify `import { fileTypeFromBuffer } from "file-type"` resolves from the module dir — it currently does NOT).
- v22 is pure-ESM, zero native deps, Bun-compatible; `fileTypeFromBuffer(Uint8Array)` → `{ext,mime}|undefined`. Covers every type in `extFromMime` (png/jpeg/webp/gif/pdf) via signature.
- An inline sniffer was rejected: it would duplicate signature tables, drift from real-world magic bytes (WebP RIFF, multi-variant JPEG/PNG headers), and contradict the named SC.
- **Limitation handled in §1.7 decision table:** `file-type` returns `undefined` for signature-less types (`text/csv`, `application/json`, `text/plain`). The `DETECTABLE_MIME` guard rejects only when a signature was EXPECTED (all allowed types are detectable) but absent — avoiding false-rejection of legitimate non-magic uploads.

---

## 9. FULL FILE LIST

**New files (all under `packages/modules/files/src/`, auto-exempt from files-access ban):**
| Path | Purpose |
|---|---|
| `commands/complete-upload.ts` | `files:complete-upload` — authoritative stat + magic-byte + pending→used (§1) |
| `commands/delete-file.ts` | `files:delete-file` — soft-delete + bytes_used decrement + file.deleted (§4) |
| `commands/attach-file.ts` | `files:attach-file` — set ownerRecordId, canWrite gate (§5.2) |
| `queries/get-read-url.ts` | `files:get-read-url` — signRead with env TTL, canRead gate (§2) |
| `queries/list-for-record.ts` | `files:list-for-record` — owner-scoped list, canRead→404 (§5.3) |
| `lib/relation-lookup.ts` | `findRelationByRecordType` (§1.0) + `DETECTABLE_MIME` set + `dispositionFor` |
| `lib/cascade.ts` | `cascadeSoftDelete` (§6) |
| `lib/attach-file.ts` | ergonomic `attachFile(ctx,args)` helper (§5.2) |
| `__tests__/complete-upload.test.ts` | integration: local FileStorage, accept/size-reject/mime-reject, pending→used |
| `__tests__/delete-file.test.ts` | soft-delete + decrement + event + 404 |
| `__tests__/read-url.test.ts` | signed url, no-key-in-response, canRead→404 |
| `__tests__/attach-and-list.test.ts` | attach direct + via simulated dispatch; list canRead→404; cross-tenant 404 |
| `__tests__/cascade.test.ts` | emit deletion event → soft-delete + bytes_used decrement (SC#5) |

**Edited files:**
| Path | Edit |
|---|---|
| `packages/modules/files/src/index.ts` | register commands `files:complete-upload`,`files:delete-file`,`files:attach-file`; queries `files:get-read-url`,`files:list-for-record`; `events: ["file.signed","file.completed","file.deleted"]`; export `attachFile` |
| `packages/modules/files/src/routes.ts` | add `POST /:fileId/complete`, `GET /:fileId/read-url`, `DELETE /:fileId`, `GET /list-for-record`; per-route status maps |
| `packages/modules/files/src/lib/quota.ts` | add `markUploaded`, `decrementUsed` |
| `packages/modules/files/src/hooks/on-tenant-created.ts` | add generic cascade subscriptions in `registerFilesHooks` |
| `packages/modules/files/package.json` | add dep `"file-type": "22.0.0"` |
| `packages/shared/src/types/cqrs.ts` | add `dispatch?` to `HandlerContext` |
| `apps/api/src/index.ts` | wire `handlerCtx.dispatch` in the scoped derive |
| `packages/config/src/env.ts` | add `STORAGE_SIGNED_URL_TTL_SEC` |
| `.env.example` | add `STORAGE_SIGNED_URL_TTL_SEC=600` |

Run `bun biome check --write` on every touched file (pre-commit hook enforces). `bun install` after the package.json dep add.

---

## 10. RISKS

- **R1 — pending→used when authoritative ≠ reserved (quota correctness).** `markUploaded` decrements pending by the RESERVED size and increments used by the AUTHORITATIVE size. If a client under-claims (`authoritative > reserved`), `bytes_used` can exceed what was reserved, and `used+pending` can transiently exceed `bytes_limit`. **Bound:** step 6 rejects `authoritative > relation.maxByteSize`, so the per-file overage is ≤ `maxByteSize`; sign-time already validated the claim against both per-file and tenant quota. Accepted. Optional stricter variant (NOT required this phase): re-reserve the `(authoritative - reserved)` delta with a conditional UPDATE inside the tx and reject on 0 rows. Documented for Phase 31 hardening.
- **R2 — cross-tenant existence leak.** Every single-resource path (complete/read-url/delete/attach) keys the initial SELECT on `id AND tenant_id`; a foreign id returns 0 rows → `not_found` → **404**, never 403/500. list-for-record returns 404 via the `canRead` gate. Test each with a foreign tenantId.
- **R3 — RETURNING returns POST-update status.** Delete/cascade must capture PRIOR status to decide `wasCounted`; using `UPDATE ... RETURNING status` would read `'deleted'`. Mandated SELECT-FOR-UPDATE-then-UPDATE inside a tx (§4 step 1, §6 step 1).
- **R4 — `file-type` not installed.** It is in `bun.lock` but absent from `node_modules`; `import` currently fails. Implementer must add the explicit dep + `bun install` and assert resolution before writing the magic-byte logic.
- **R5 — recordType→relation is assumed 1:1.** `findRelationByRecordType` returns the first relation whose `recordType` matches within a module. If two `kind`s in one module share a `recordType` with DIFFERENT `allowedMimeTypes`/`maxByteSize`, complete-upload may validate against the wrong limits. Acceptable for the starter (1:1 in practice); the alternative — adding a `kind` column — is out of scope (Phase 24 schema is locked, no migration this phase). Document in `relation-lookup.ts` header.
- **R6 — getObject reads the FULL object for a 4KB sniff.** The port has no ranged read; LocalFileStorage/S3 `getObject` returns the whole object, then we `subarray(0,4096)`. For large uploads this is wasteful memory I/O. Bounded by `relation.maxByteSize` (operator-configured). A ranged `getObject` is a future port extension; not blocking Phase 27. Note in `complete-upload.ts` header.
- **R7 — DB/storage non-atomicity on delete.** A crash between DB-commit and `storage.delete` orphans the physical object; the tombstone is authoritative and the Phase 31 reconciliation job sweeps orphans. Never the reverse (we tombstone first), so no row ever points at a deleted object.
- **R8 — cascade subscriber depends on an unemitted event.** `auth.user-deleted` has no producer until Phase 29; Phase 27 cannot exercise it end-to-end against a real user deletion. Mitigated by emitting the canonical `{tenantId,recordId}` payload in-test. If Phase 29's emit shape diverges from `{tenantId,recordId}`, the subscriber breaks silently — the canonical contract is pinned HERE (§6) so Phase 29 must conform.
