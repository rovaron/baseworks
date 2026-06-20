# Phase 26 — Files Module Skeleton + Sign-Upload + Per-Tenant Quota — LOCKED CONTRACT

**Status:** LOCKED. Implementers MUST NOT diverge from the signatures, SQL, file
list, error→HTTP mappings, or wiring edits below. Deviations require a contract
amendment, not an ad-hoc implementation choice.

**Requirements:** UPL-01, UPL-03, QUO-01, QUO-02, MOD-02
**Depends on:** Phase 25 (FileStorage adapters live), Phase 24 (fileRelations registry + DB schema)
**Module analog:** `packages/modules/billing/` — copy its structure verbatim.

Header doc-comment convention on every new file: cite `Phase 26 / <REQ>` and the
relevant decision id. `bun:test` `describe()/test()`. Run
`bun biome check --write <files>` before commit (pre-commit hook enforces it).

---

## §0. Authoritative facts (verified against the repo)

- `tenant_storage_usage` (packages/db/src/schema/storage.ts:104): PK `tenant_id`,
  `bytes_used bigint NOT NULL DEFAULT 0`, `bytes_pending bigint NOT NULL DEFAULT 0`,
  `bytes_limit bigint NULL` (NULL ⇒ "use env default", D-11), `updated_at` auto-bump.
- `files` (storage.ts:44): `id` PK, `tenant_id`, `owner_module`, `owner_record_type`,
  `owner_record_id` (all NOT NULL text), `storage_key`, `bucket`, `mime_type`,
  `byte_size bigint`, `status text NOT NULL DEFAULT 'pending'` (CHECK in
  ('pending','uploaded','transforming','ready','failed','deleted')),
  `uploaded_by_user_id text NULL`. Unique index `files_bucket_key_uq` on
  `(bucket, storage_key)`. **CR-01: `tenant_id` is NOT in the storage key.**
- `getDb(connStr=process.env.DATABASE_URL)` → raw drizzle instance (packages/db/src/connection.ts:57).
  Exports `files`, `tenantStorageUsage` from `@baseworks/db`.
- `getFileStorage().signUpload({ bucket, key, mimeType, maxByteSize, expiresInSec })`
  → `SignedUpload { method, url, fields?, headers?, expiresAt }`. **NEVER returns storage_key.**
- `fileRelationsRegistry.get(ownerModule, kind)` → `FileRelation | undefined`
  (`{ recordType, allowedMimeTypes, maxByteSize, generateVariants?, onDelete?, canRead?, canWrite? }`).
  Populated at boot by `apps/api/src/core/registry.ts` `loadAll()` (registry.ts:137-141).
- `STORAGE_DEFAULT_QUOTA_BYTES` is in `.env.example` (=1073741824) but NOT YET in the
  Zod schema. **Must be added to `packages/config/src/env.ts` `serverSchema`.**
- nanoid 5.1.9 is in the workspace via `@baseworks/module-auth`; the files module
  declares its own `nanoid` dependency.
- The files module is ALLOW-LISTED for direct `files`-table access by both
  `.biome/plugins/ban-files-table-access.grit` and `scripts/lint-no-direct-files-access.sh`
  (allowlist entry `packages/modules/files/`). Direct `db.insert(files)` / `db.execute(sql...)`
  is permitted HERE ONLY, and every statement MUST carry an explicit `tenant_id` predicate.
- `getModuleRoutes()` (registry.ts:171) auto-mounts every non-auth/non-billing module's
  `routes` plugin, and it is `.use()`'d at apps/api/src/index.ts:330 — AFTER `tenantMiddleware`
  and the `handlerCtx` derive (index.ts:284-304). **Therefore `filesRoutes` needs NO explicit
  mount in index.ts; adding `"files"` to the modules list is sufficient, and `ctx.handlerCtx`
  is guaranteed present in the files routes.**

---

## §1. RACE-SAFE QUOTA (QUO-01, QUO-02) — the core of the phase

### 1.1 Canonical location
`packages/modules/files/src/lib/quota.ts`. Exports `reserveQuota` and `releaseQuota`.
Operates on the RAW drizzle instance (`getDb`), NOT `ctx.db` (the scoped wrapper has
no `.execute()` / raw SQL).

### 1.2 `reserveQuota` — the single atomic conditional UPDATE

```ts
import { getDb, tenantStorageUsage } from "@baseworks/db";
import { sql } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;

/**
 * Atomically reserve `size` bytes of pending quota for `tenantId`.
 * Returns true if reserved, false if the reservation would exceed the limit
 * (caller maps false → HTTP 413 quota_exceeded).
 *
 * `defaultLimit` is env.STORAGE_DEFAULT_QUOTA_BYTES and is used only when the
 * row's bytes_limit is NULL (D-11 per-tenant-override-or-env-default).
 */
export async function reserveQuota(
  db: Db,
  tenantId: string,
  size: number,
  defaultLimit: number,
): Promise<boolean> {
  // Belt-and-suspenders: guarantee a row exists even for legacy/pre-hook tenants,
  // so a 0-row UPDATE result unambiguously means "quota exceeded", never "no row".
  // Idempotent; harmless when the tenant.created hook already inserted the row.
  await db
    .insert(tenantStorageUsage)
    .values({ tenantId, bytesUsed: 0, bytesPending: 0, bytesLimit: defaultLimit })
    .onConflictDoNothing({ target: tenantStorageUsage.tenantId });

  const rows = await db.execute(sql`
    UPDATE tenant_storage_usage
       SET bytes_pending = bytes_pending + ${size},
           updated_at    = now()
     WHERE tenant_id = ${tenantId}
       AND bytes_used + bytes_pending + ${size}
           <= COALESCE(bytes_limit, ${defaultLimit})
    RETURNING bytes_used, bytes_pending, bytes_limit
  `);

  // drizzle-orm/postgres-js: db.execute returns the rows array directly.
  return rows.length > 0;
}
```

**0 rows ⇒ HTTP 413 + `quota_exceeded`.** Because the idempotent INSERT guarantees the
row exists, a 0-row UPDATE can ONLY mean the WHERE predicate failed (limit would be
exceeded) — never a missing row.

### 1.3 Why this is race-safe (the load-bearing argument for SC#3)

Postgres READ COMMITTED isolation: when two concurrent transactions issue an `UPDATE`
that matches the SAME row (`tenant_id` is the PK ⇒ exactly one row), the second
`UPDATE` **blocks on the row-level write lock** held by the first until that first
transaction commits or rolls back. When it unblocks, Postgres performs an
**EvalPlanQual recheck**: it re-reads the latest committed version of the locked row
and re-evaluates the `WHERE` predicate against the post-commit `bytes_pending`.

Therefore every concurrent reservation evaluates `bytes_used + bytes_pending + size
<= limit` against the cumulative effect of all prior committed winners. Two requests
whose combined sizes would exceed the limit can never both pass: whichever acquires
the lock second sees the first's increment already applied. This is the canonical
atomic-counter pattern — **no `SELECT ... FOR UPDATE` is needed**, because the
conditional `UPDATE` itself takes the row lock and does the recheck in one statement.
No application-level read-modify-write, no TOCTOU window.

Invariant proven by SC#3: after 50 concurrent sign-upload requests against a tenant
at 95% quota resolve, `bytes_used + bytes_pending <= bytes_limit` holds exactly; the
number of HTTP-200 responses equals `floor(remaining_quota / per_upload_size)`, and the
rest are HTTP 413.

### 1.4 `releaseQuota` — compensation on post-reserve failure

```ts
/**
 * Release a previously reserved `size` of pending quota. Called when sign-upload
 * fails AFTER reserveQuota succeeded (files INSERT throws, signUpload throws) so a
 * failed request never leaks pending bytes. GREATEST guards against underflow.
 */
export async function releaseQuota(db: Db, tenantId: string, size: number): Promise<void> {
  await db.execute(sql`
    UPDATE tenant_storage_usage
       SET bytes_pending = GREATEST(bytes_pending - ${size}, 0),
           updated_at    = now()
     WHERE tenant_id = ${tenantId}
  `);
}
```

> Note: `bytes_pending → bytes_used` settlement on successful upload completion is
> **Phase 27** (`/complete`). Phase 26 only reserves at sign-time and releases on the
> failure path. Stale `pending` rows from clients that sign but never PUT are swept by
> the Phase 31 reaper (`files_pending_status_idx`).

---

## §2. `buildStorageKey()` (UPL-03, CR-01)

### 2.1 Canonical location
`packages/modules/files/src/lib/build-storage-key.ts`. This is the ONLY place a
storage key is constructed. `storage_key` MUST NEVER appear in any API response.

### 2.2 Exact key structure (mandatory nanoid(24) segment)

```ts
import { nanoid } from "nanoid";

/** Map a MIME type to a file extension; "" when unknown (never throws). */
function extFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "application/pdf": ".pdf",
  };
  return map[mimeType] ?? "";
}

/**
 * Build a collision-resistant storage key. Structure:
 *   {tenantId}/{ownerModule}/{kind}/{nanoid(24)}{ext}
 *
 * - The tenant prefix is INFORMATIONAL only (CR-01): tenant READ isolation comes
 *   from ScopedDb + the files-access ban, NOT from the key. Never parse the key
 *   to authorize.
 * - Collision resistance comes from the mandatory nanoid(24) segment (the unique
 *   index files_bucket_key_uq is the hard backstop).
 */
export function buildStorageKey(args: {
  tenantId: string;
  ownerModule: string;
  kind: string;
  mimeType: string;
}): string {
  const id = nanoid(24); // MANDATORY — 24-char url-safe id
  return `${args.tenantId}/${args.ownerModule}/${args.kind}/${id}${extFromMime(args.mimeType)}`;
}

/**
 * Resolve the bucket for the files module. Single logical bucket; S3_BUCKET when
 * provider=s3/s3-compat, else the literal "files" (local adapter directory).
 */
export function resolveBucket(): string {
  return process.env.S3_BUCKET ?? "files";
}
```

A test asserts the key contains a 24-char id segment and that no `/api/files/*`
response body contains the substring of any `storage_key`.

---

## §3. Sign-upload flow end-to-end (UPL-01, MOD-02)

### 3.1 Command: `packages/modules/files/src/commands/sign-upload.ts`

```ts
import { env } from "@baseworks/config";
import { getDb, files } from "@baseworks/db";
import { defineCommand, err, ok } from "@baseworks/shared";
import { fileRelationsRegistry, getFileStorage } from "@baseworks/storage";
import { Type } from "@sinclair/typebox";
import { buildStorageKey, resolveBucket } from "../lib/build-storage-key";
import { releaseQuota, reserveQuota } from "../lib/quota";

const SignUploadInput = Type.Object({
  ownerModule: Type.String({ minLength: 1 }),
  kind: Type.String({ minLength: 1 }),
  mimeType: Type.String({ minLength: 1 }),
  byteSize: Type.Integer({ minimum: 1 }),
});

const SIGN_TTL_SEC = 900; // ≤ 15 min (UPL-01)

export const signUpload = defineCommand(SignUploadInput, async (input, ctx) => {
  // 1. Relation lookup — unknown (ownerModule, kind) ⇒ 400
  const relation = fileRelationsRegistry.get(input.ownerModule, input.kind);
  if (!relation) return err("unknown_relation");

  // 2. MIME allow-list (per-relation) ⇒ 400
  if (!relation.allowedMimeTypes.includes(input.mimeType)) return err("mime_not_allowed");

  // 3. Per-relation max size ⇒ 400 (distinct from quota's 413)
  if (input.byteSize > relation.maxByteSize) return err("file_too_large");

  const db = getDb(env.DATABASE_URL);

  // 4. Atomic quota reservation ⇒ 413 on 0 rows
  const reserved = await reserveQuota(
    db, ctx.tenantId, input.byteSize, env.STORAGE_DEFAULT_QUOTA_BYTES,
  );
  if (!reserved) return err("quota_exceeded");

  // Everything past reserveQuota must release on failure to avoid leaking pending bytes.
  try {
    const bucket = resolveBucket();
    const key = buildStorageKey({
      tenantId: ctx.tenantId,
      ownerModule: input.ownerModule,
      kind: input.kind,
      mimeType: input.mimeType,
    });

    // 5. Insert pending files row (direct files-table access — module is allow-listed;
    //    explicit tenant_id via ctx.tenantId). ownerRecordId is "" (unattached) —
    //    Phase 27 attachFile links it to a real record.
    const [row] = await db
      .insert(files)
      .values({
        tenantId: ctx.tenantId,
        ownerModule: input.ownerModule,
        ownerRecordType: relation.recordType,
        ownerRecordId: "",
        storageKey: key,
        bucket,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        status: "pending",
        uploadedByUserId: ctx.userId ?? null,
      })
      .returning({ id: files.id });

    // 6. Sign (TTL ≤ 15 min). signUpload NEVER returns storage_key.
    const signed = await getFileStorage().signUpload({
      bucket,
      key,
      mimeType: input.mimeType,
      maxByteSize: input.byteSize,
      expiresInSec: SIGN_TTL_SEC,
    });

    // 7. Response — fileId + signed PUT envelope. NO storageKey, NO bucket/key.
    return ok({
      fileId: row.id,
      method: signed.method,
      url: signed.url,
      headers: signed.headers,
      fields: signed.fields,
      expiresAt: signed.expiresAt,
    });
  } catch (error) {
    await releaseQuota(db, ctx.tenantId, input.byteSize);
    const message = error instanceof Error ? error.message : "sign_upload_failed";
    return err(message || "sign_upload_failed");
  }
});
```

### 3.2 Error → HTTP status mapping (enforced in routes.ts)

| Result error code     | HTTP | Cause                                            |
|-----------------------|------|--------------------------------------------------|
| `unknown_relation`    | 400  | `(ownerModule, kind)` not registered (MOD-02)    |
| `mime_not_allowed`    | 400  | MIME not in relation.allowedMimeTypes            |
| `file_too_large`      | 400  | byteSize > relation.maxByteSize                  |
| `quota_exceeded`      | 413  | reserveQuota returned 0 rows (QUO-02)            |
| any other (catch)     | 400  | unexpected (signing/insert failure)              |

### 3.3 Routes: `packages/modules/files/src/routes.ts`

```ts
import { Elysia, t } from "elysia";
import { signUpload } from "./commands/sign-upload";

export const filesRoutes = new Elysia({ prefix: "/api/files" }).post(
  "/sign-upload",
  async (ctx: any) => {
    const r = await signUpload(ctx.body, ctx.handlerCtx);
    if (!r.success) {
      ctx.set.status = r.error === "quota_exceeded" ? 413 : 400;
      return { error: r.error };
    }
    return r.data;
  },
  {
    body: t.Object({
      ownerModule: t.String({ minLength: 1 }),
      kind: t.String({ minLength: 1 }),
      mimeType: t.String({ minLength: 1 }),
      byteSize: t.Integer({ minimum: 1 }),
    }),
  },
);
```

`ctx.handlerCtx` is the pre-built `HandlerContext` from the tenant-band derive
(index.ts:286-304). `filesRoutes` auto-mounts via `getModuleRoutes()` in the scoped
band — no explicit `.use()` in apps/api.

---

## §4. tenant.created hook (QUO-01)

### 4.1 `packages/modules/files/src/hooks/on-tenant-created.ts`

```ts
import { env } from "@baseworks/config";
import { getDb, tenantStorageUsage } from "@baseworks/db";
import { getErrorTracker } from "@baseworks/observability";

interface TenantCreatedEvent { tenantId: string; name?: string; }

/**
 * Create the tenant_storage_usage row when a tenant is created (QUO-01).
 * Idempotent ON CONFLICT DO NOTHING; resilient — failure here MUST NOT crash
 * tenant creation (emit is fire-and-forget). Mirrors billing hook resilience.
 */
export function registerFilesHooks(eventBus: {
  on: (event: string, handler: (data: any) => Promise<void>) => void;
}): void {
  eventBus.on("tenant.created", async (data: unknown) => {
    const { tenantId } = data as TenantCreatedEvent;
    try {
      const db = getDb(env.DATABASE_URL);
      await db
        .insert(tenantStorageUsage)
        .values({
          tenantId,
          bytesUsed: 0,
          bytesPending: 0,
          bytesLimit: env.STORAGE_DEFAULT_QUOTA_BYTES, // explicit so the row is observable (SC#2)
        })
        .onConflictDoNothing({ target: tenantStorageUsage.tenantId });
    } catch (err) {
      getErrorTracker().captureException(err, {
        tenantId,
        tags: { module: "files", hook: "tenant.created" },
      });
    }
  });
}
```

The hook sets `bytes_limit` explicitly to the env default so the row is observable
with a concrete limit (SC#2). `reserveQuota`'s `COALESCE(bytes_limit, :default)` is the
belt-and-suspenders for legacy/NULL-limit rows (D-11 per-tenant override = set the
column directly).

### 4.2 Wiring in apps/api
`registerFilesHooks(registry.getEventBus())` is called in `apps/api/src/index.ts`
immediately after `registerExampleHooks(...)` (index.ts:88), importing
`registerFilesHooks` from `@baseworks/module-files` (re-exported from the module index).

---

## §5. Cross-module-import ban (SC#5 / MOD-02)

### 5.1 Script: `scripts/lint-no-cross-module-imports.sh`
Mirrors `scripts/lint-no-direct-files-access.sh` (same `set -euo pipefail` + grep
shape + exit codes). Bans any `from "@baseworks/module-…"` import inside
`packages/modules/*/src`. A module may import ONLY infra packages
(`@baseworks/shared`, `@baseworks/db`, `@baseworks/storage`, `@baseworks/config`,
`@baseworks/observability`, `@baseworks/queue`, `@baseworks/i18n`) — those do NOT
match the `@baseworks/module-` prefix so they pass automatically. The sanctioned
cross-module channel is `TypedEventBus` (`ctx.emit(...)` / `eventBus.on(...)`).

```bash
#!/usr/bin/env bash
# scripts/lint-no-cross-module-imports.sh (Phase 26 / SC#5 / MOD-02)
#
# Bans direct module→module imports. Cross-module file logic MUST go through
# TypedEventBus (ctx.emit / eventBus.on), never a package import. Infra packages
# (shared/db/storage/config/observability/queue/i18n) do not match the banned
# `@baseworks/module-` prefix and are therefore allowed.
set -euo pipefail

# from "@baseworks/module-..." or from '@baseworks/module-...'
PATTERN='from[[:space:]]+["'\'']@baseworks/module-'

MATCHES=$(grep -rnE "$PATTERN" packages/modules/*/src --include="*.ts" --include="*.tsx" 2>/dev/null || true)
if [ -z "$MATCHES" ]; then
  exit 0
fi

echo "ERROR: Cross-module import is banned (Phase 26 / SC#5). Use TypedEventBus (ctx.emit / eventBus.on). Matches:"
echo "$MATCHES"
exit 1
```

> Note: apps/api (the composition root) is permitted to import any module — the ban
> scopes to `packages/modules/*/src` only, exactly as written.

### 5.2 Wire into root lint + lint-staged (package.json)
- Add script: `"lint:cross-module": "bash scripts/lint-no-cross-module-imports.sh"`.
- Extend root `"lint"`: `biome check . && bun run lint:als && bun run lint:files-access && bun run lint:cross-module`.
- Append to the lint-staged `*.{ts,tsx}` array: `"bash scripts/lint-no-cross-module-imports.sh"`.

---

## §6. Full file list + wiring edits

### 6.1 New files under `packages/modules/files/`
| Path | Purpose |
|------|---------|
| `package.json` | name `@baseworks/module-files`, private, type module, main/types `./src/index.ts`. deps: `@baseworks/config`, `@baseworks/db`, `@baseworks/observability`, `@baseworks/shared`, `@baseworks/storage` (all `workspace:*`), `@sinclair/typebox` `0.34.49`, `drizzle-orm` `^0.45.0`, `elysia` `^1.4.0`, `nanoid` `^5.1.9`. |
| `tsconfig.json` | `{ "extends": "../../../tsconfig.json", "compilerOptions": { "noEmit": true }, "include": ["src/**/*.ts"] }` (copy billing). |
| `src/index.ts` | `export default { name: "files", routes: filesRoutes, commands: { "files:sign-upload": signUpload }, events: ["file.signed"] } satisfies ModuleDefinition;` plus `export { registerFilesHooks } from "./hooks/on-tenant-created";`. |
| `src/lib/quota.ts` | `reserveQuota` / `releaseQuota` (§1). |
| `src/lib/build-storage-key.ts` | `buildStorageKey` + `resolveBucket` (§2). |
| `src/commands/sign-upload.ts` | `signUpload` command (§3.1). |
| `src/routes.ts` | `filesRoutes` Elysia plugin (§3.3). |
| `src/hooks/on-tenant-created.ts` | `registerFilesHooks` (§4.1). |
| `src/__tests__/quota.test.ts` | LIVE-DB 50-concurrent race test (SC#3) + reserve/release unit behavior. |
| `src/__tests__/build-storage-key.test.ts` | asserts mandatory nanoid(24) segment + no tenant-auth-from-key. |
| `src/__tests__/sign-upload.test.ts` | LIVE-DB flow: unknown_relation→400, mime/size→400, quota→413, success returns NO storageKey. Registers a test relation into `fileRelationsRegistry`; stubs `getFileStorage().signUpload` via `setFileStorage`. |
| `src/__tests__/on-tenant-created.test.ts` | hook idempotency (ON CONFLICT DO NOTHING) + resilience (mock getErrorTracker, mirror billing test). |

### 6.2 Edits to existing files
| File | Edit |
|------|------|
| `packages/config/src/env.ts` | Add to `serverSchema`: `STORAGE_DEFAULT_QUOTA_BYTES: z.coerce.number().int().positive().default(1073741824),`. |
| `apps/api/src/core/registry.ts` | Add to `moduleImportMap`: `files: () => import("@baseworks/module-files"),`. |
| `apps/api/src/index.ts` | (a) import `{ registerFilesHooks } from "@baseworks/module-files"`; (b) add `"files"` to `new ModuleRegistry({ ..., modules: ["auth", "billing", "example", "files"] })`; (c) call `registerFilesHooks(registry.getEventBus())` after the example-hooks call (index.ts:88). No explicit route mount — `getModuleRoutes()` handles it. |
| `apps/api/package.json` | Add dependency `"@baseworks/module-files": "workspace:*"`. |
| `package.json` (root) | Add `lint:cross-module` script; extend `lint`; append script to `lint-staged` array (§5.2). |

---

## §7. Risks + verification plan

### 7.1 Risks
- **R1 — Quota race correctness (highest).** The whole phase rests on the §1.3
  EvalPlanQual recheck argument. If an implementer rewrites `reserveQuota` as a
  SELECT-then-UPDATE (read-modify-write), over-allocation returns under load. MITIGATION:
  the SQL is LOCKED as a single conditional UPDATE; SC#3 (50-concurrent live-DB test)
  is the gate. Reviewer must reject any read-then-write variant.
- **R2 — `db.execute` return shape.** drizzle-orm/postgres-js `db.execute(sql)` returns
  the rows array directly (length check works). If the driver wrapper changes to return
  `{ rows }`, the `rows.length` check silently breaks (always truthy ⇒ never 413).
  MITIGATION: the 413-path assertion in `quota.test.ts` catches this against the live DB.
- **R3 — Pending-byte leak.** Any code path that reserves but then fails without calling
  `releaseQuota` permanently inflates `bytes_pending`. MITIGATION: the single try/catch
  wrapping everything after `reserveQuota` (§3.1); a test asserts `bytes_pending` is
  unchanged after a forced signUpload failure.
- **R4 — storage_key leakage.** A future field added to the `ok({...})` response could
  expose the key. MITIGATION: a test scans the JSON response for the storage_key
  substring; `SignedUpload` type already excludes it.
- **R5 — `ownerRecordId = ""` placeholder.** Unattached pending rows accumulate if a
  client signs but never completes. ACCEPTED for Phase 26; swept by Phase 31 reaper via
  `files_pending_status_idx`. Settlement (`pending→used`) is Phase 27.
- **R6 — bucket resolution drift.** `resolveBucket()` reads `S3_BUCKET` directly from
  `process.env` (not the typed env) to avoid a config dependency on S3-only vars; default
  `"files"`. Keep this the single source of the bucket string.

### 7.2 Verification plan (Docker is UP; DB is live — Phase 26 is fully local-verifiable)
1. **SC#1** — integration test: POST `/api/files/sign-upload` returns method/url/expiresAt;
   assert `expiresAt - now ≤ 900s`; assert response JSON contains no `storage_key`; assert
   the inserted `files.storage_key` matches `…/{24-char}…`.
2. **SC#2** — `on-tenant-created.test.ts`: emit `tenant.created`, assert one
   `tenant_storage_usage` row with `bytes_limit = STORAGE_DEFAULT_QUOTA_BYTES`; re-emit,
   assert still one row (ON CONFLICT DO NOTHING). Sign-upload past quota ⇒ 413 +
   `{ error: "quota_exceeded" }`.
3. **SC#3 (the load test, LIVE DB — NOT mocked)** — seed a tenant row with
   `bytes_used + bytes_pending` at 95% of `bytes_limit`. Fire 50 concurrent
   `reserveQuota(db, tenant, perSize, default)` calls via `Promise.all`. Assert:
   (a) `count(true) === floor(remaining / perSize)`; (b) final
   `bytes_used + bytes_pending <= bytes_limit` (NO over-allocation); (c) the rest return
   false (⇒ 413). Patterns: `packages/db/src/__tests__/scoped-db.test.ts` for live-DB setup
   against `DATABASE_URL=postgres://baseworks:baseworks@localhost:5432/baseworks`.
4. **SC#4** — registry test: a module declaring `fileRelations` is collected at boot;
   `fileRelationsRegistry.get(known)` resolves and `get(unknown)` ⇒ sign-upload 400
   `unknown_relation`.
5. **SC#5** — `bash scripts/lint-no-cross-module-imports.sh` exits 0 on the clean tree;
   add a temp `from "@baseworks/module-billing"` inside `packages/modules/files/src` and
   confirm it exits 1; remove it. Run full `bun run lint`.
6. **Gates** — `bun test packages/modules/files`, `bun run lint`, `bun biome check --write`
   on all new files, and a typecheck (`bunx tsc -p packages/modules/files/tsconfig.json`).
