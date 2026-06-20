---
phase: 24-foundation-storage-port-files-schema-moduledefinition-extens
reviewed: 2026-06-11T00:00:00Z
depth: standard
files_reviewed: 41
files_reviewed_list:
  - .biome/plugins/ban-files-table-access.grit
  - .env.example
  - apps/api/package.json
  - apps/api/src/core/registry.ts
  - apps/api/src/index.ts
  - apps/api/src/worker.ts
  - biome.json
  - package.json
  - packages/db/migrations/0002_v14_file_storage.down.sql
  - packages/db/migrations/0002_v14_file_storage.sql
  - packages/db/migrations/meta/0002_snapshot.json
  - packages/db/migrations/meta/_journal.json
  - packages/db/src/index.ts
  - packages/db/src/schema/index.ts
  - packages/db/src/schema/storage.ts
  - packages/shared/src/__tests__/module-types.test.ts
  - packages/shared/src/index.ts
  - packages/shared/src/types/module.ts
  - packages/storage/package.json
  - packages/storage/src/__tests__/adapter-scaffolds.test.ts
  - packages/storage/src/__tests__/env.test.ts
  - packages/storage/src/__tests__/factory.test.ts
  - packages/storage/src/__tests__/ports.test.ts
  - packages/storage/src/__tests__/registry.test.ts
  - packages/storage/src/adapters/imagescript/image-transform.ts
  - packages/storage/src/adapters/local/file-storage.ts
  - packages/storage/src/adapters/s3-compat/file-storage.ts
  - packages/storage/src/adapters/s3/file-storage.ts
  - packages/storage/src/adapters/sharp/image-transform.ts
  - packages/storage/src/env.ts
  - packages/storage/src/factory.ts
  - packages/storage/src/index.ts
  - packages/storage/src/ports/file-storage.ts
  - packages/storage/src/ports/image-transform.ts
  - packages/storage/src/ports/types.ts
  - packages/storage/src/registry.ts
  - packages/storage/tsconfig.json
  - scripts/__tests__/__fixtures__/direct-files-access-violation.ts
  - scripts/__tests__/files-access-ban.test.ts
  - scripts/lint-no-direct-files-access.sh
  - tsconfig.json
findings:
  critical: 1
  warning: 5
  info: 4
status: issues_found
---

# Phase 24: Code Review Report

**Reviewed:** 2026-06-11T00:00:00Z
**Depth:** standard
**Files Reviewed:** 41
**Status:** issues_found

## Summary

Phase 24 lays the file-storage foundation: port interfaces, env-selected factories, throwing scaffolds, the `files`/`tenant_storage_usage` schema + migration, the `ModuleDefinition.fileRelations` extension, and a three-layer ban on direct files-table access. Overall structure is solid: boot-order in `apps/api/src/index.ts` and `worker.ts` is correct (`validateStorageEnv()` runs before module load in both entrypoints), the snapshot `prevId` chain is intact (0000 → 0002 → 0003), the journal `when` ordering is chronologically safe relative to the already-applied 0003 audit migration, error messages never echo secret values, and the scaffold/factory/registry test coverage is thorough.

Key concerns: (1) the unique index that the schema comment claims enforces cross-tenant bucket+key exclusivity actually only enforces *per-tenant* uniqueness — the stated tenant-isolation invariant is not enforced by the database; (2) the hand-edited migration SQL (partial index WHERE clause, status CHECK constraint) is invisible to Drizzle's schema/snapshots and will be silently dropped by future `drizzle-kit generate`/`push`; (3) the files-table-access ban covers only the `select().from(files)` shape — inserts/updates/deletes/relational queries bypass all three layers; (4) none of the new test suites in `packages/storage` and `packages/shared` run under the root `bun run test` script.

## Critical Issues

### CR-01: `files_tenant_bucket_key_uq` does not enforce the cross-tenant bucket+key exclusivity it claims

**File:** `packages/db/src/schema/storage.ts:57-61` (also `packages/db/migrations/0002_v14_file_storage.sql:31`, `packages/db/migrations/meta/0002_snapshot.json:896-922`)
**Issue:** The comment on the unique index states: *"Cross-tenant uniqueness guarantee: same bucket+key cannot be claimed by two tenants. Tenant prefix is informational, not authoritative (UPL-03 / Pitfall 1)."* But the index is defined on `(tenant_id, bucket, storage_key)`:

```ts
uniqueIndex("files_tenant_bucket_key_uq").on(t.tenantId, t.bucket, t.storageKey),
```

Because `tenant_id` is part of the key, two DIFFERENT tenants CAN both claim the same `(bucket, storage_key)` pair — the index only prevents the *same* tenant from claiming a key twice. In S3/local-FS, the physical object is identified by bucket+key alone, so if any future code path lets tenant B register a row with tenant A's storage key (the design explicitly says the tenant prefix in the key is "informational, not authoritative", i.e. the DB index is supposed to be the authority), tenant B's signed upload would overwrite — and tenant B's signed read would expose — tenant A's object. This is exactly the cross-tenant isolation invariant this phase exists to lock down. Latent today (no upload path until Phases 25-26), but fixing it after rows exist requires a data-aware migration, so it must be corrected now.
**Fix:** Make the uniqueness global on the physical object identity; `tenant_id` stays as a column but out of the unique key. Tenant-scoped lookups are already served by `files_owner_idx` (which leads with `tenant_id`).

```ts
// schema/storage.ts
uniqueIndex("files_bucket_key_uq").on(t.bucket, t.storageKey),
```

```sql
-- migration
CREATE UNIQUE INDEX "files_bucket_key_uq" ON "files" ("bucket", "storage_key");
```

Update the migration SQL, the down migration, and both snapshots (0002 + 0003), or regenerate via `drizzle-kit generate` after the schema change. If per-tenant uniqueness was genuinely intended instead, the comment (and the UPL-03/Pitfall-1 traceability claim) must be rewritten — but then key construction in Phase 26 becomes the sole isolation authority, which contradicts D-17's "tenant prefix is informational" stance.

## Warnings

### WR-01: Hand-edited migration SQL (partial index WHERE + CHECK constraint) is invisible to Drizzle — future generate/push will silently drop them

**File:** `packages/db/migrations/0002_v14_file_storage.sql:20,36`; `packages/db/src/schema/storage.ts:49,64-69`; `packages/db/migrations/meta/0002_snapshot.json:956-983`
**Issue:** Two clauses exist only in the hand-edited SQL, not in the Drizzle table builder or the meta snapshots:
- `files_pending_status_idx ... WHERE "deleted_at" IS NULL` — snapshot 0002 (and 0003, verified) has no `where` field on this index.
- `CONSTRAINT "files_status_check" CHECK (...)` — `checkConstraints: {}` in both snapshots.

Consequence: any future `drizzle-kit generate` that touches the `files` indexes will emit a DROP/CREATE that recreates `files_pending_status_idx` *without* the partial WHERE clause (silently bloating the index as tombstones accumulate, defeating D-04), and `drizzle-kit push` (the dev path, `bun run db:push`) will recreate the index without WHERE and knows nothing about `files_status_check`. The code comments claim Drizzle 0.45 cannot express these, but the pinned versions (drizzle-orm ^0.45, drizzle-kit 0.31.10) support both `index(...).on(...).where(sql\`...\`)` and the `check()` constraint builder in pg-core.
**Fix:** Express both in the schema builder and regenerate so the snapshot carries them:

```ts
import { check, sql } from "drizzle-orm"; // check from drizzle-orm/pg-core
...
(t) => [
  ...
  index("files_pending_status_idx")
    .on(t.status, t.createdAt)
    .where(sql`${t.deletedAt} IS NULL`),
  check(
    "files_status_check",
    sql`${t.status} IN ('pending','uploaded','transforming','ready','failed','deleted')`,
  ),
],
```

If a real drizzle-kit limitation blocks this, at minimum hand-edit the `where` and `checkConstraints` fields into snapshots 0002 and 0003 so future diffs are computed against reality.

### WR-02: Files-table-access ban only covers the `select().from(files)` shape — writes and relational queries bypass all three layers

**File:** `.biome/plugins/ban-files-table-access.grit:24`; `scripts/lint-no-direct-files-access.sh:35`
**Issue:** The GritQL rule matches only `$db.select($args).from(files)` and the grep pattern is `\.select\(.*\)\.from\(files\)`. The rule's own comment says *"every files-table touch must go through the files module's CQRS commands/queries"*, but none of these touch the gates:
- `db.insert(files).values(...)` — bypasses quota accounting and the tenant/owner authorization layer.
- `db.update(files).set(...)` / `db.delete(files).where(...)` — bypasses soft-delete + usage-counter discipline.
- `db.query.files.findMany(...)` — the relational query API reads the table with no `.from()` at all.

Additionally, the grep layer (the self-described safety net for files that escape Biome's scope) is single-line only — a formatted chain like `db.select({...})\n  .from(files)` escapes it — and an aliased import (`import { files as f }`) escapes both layers. Minor adjacent nit: the allowlist filter `grep -v "$allowed"` (line 44) is unanchored, so a *violation line whose code content* happens to contain an allowlist string is silently excluded; anchor with `grep -v "^${allowed}"`.
**Fix:** Extend the GritQL plugin with three more patterns (`$db.insert(files)`, `$db.update(files)`, `$db.delete(files)`) and a `db.query.files` pattern, and broaden the shell pattern accordingly, e.g.:

```bash
PATTERN='\.select\(.*\)|\.(insert|update|delete)\(files\)|\bquery\.files\.'
```

(or two separate greps: one for `\.from\(files\)`, one for `\.(insert|update|delete)\(files\)` and `query\.files\.`). If write-path bans are deliberately deferred to Phase 26, document that explicitly in the grit header instead of claiming "every files-table touch".

### WR-03: New test suites in `packages/storage` and `packages/shared` are not run by the root test script

**File:** `package.json:22`
**Issue:** The root script is:

```json
"test": "bun test apps/api packages/config packages/db packages/modules packages/queue scripts/__tests__ && cd packages/ui && bun run test"
```

Neither `packages/storage` nor `packages/shared` is listed, so all six new suites added by this phase — `packages/storage/src/__tests__/{adapter-scaffolds,env,factory,ports,registry}.test.ts` and `packages/shared/src/__tests__/module-types.test.ts` — never execute under `bun run test` (the CI/pre-push gate). Only `scripts/__tests__/files-access-ban.test.ts` runs. A regression in the factory, env validator, or fileRelations Zod validation would ship green.
**Fix:** Add the two paths:

```json
"test": "bun test apps/api packages/config packages/db packages/modules packages/queue packages/shared packages/storage scripts/__tests__ && cd packages/ui && bun run test"
```

### WR-04: `tenant_storage_usage.updated_at` lacks `$onUpdate` — repeats the exact pitfall fixed in the audit campaign

**File:** `packages/db/src/schema/storage.ts:89`
**Issue:** `files` uses `timestampColumns()`, which auto-bumps `updatedAt` via `$onUpdate` (added in audit phase 5 precisely for the `timestamps-updatedat-no-onupdate` pitfall — see `packages/db/src/schema/base.ts:40-48`). But `tenantStorageUsage` hand-rolls its column:

```ts
updatedAt: timestamp("updated_at").defaultNow().notNull(),
```

Phase 26's race-safe quota UPSERTs will mutate `bytes_used`/`bytes_pending` without bumping `updated_at` unless every call site remembers to set it manually — and a stale `updated_at` on the usage counter is exactly the kind of silent drift the audit fix was meant to eliminate.
**Fix:**

```ts
updatedAt: timestamp("updated_at")
  .defaultNow()
  .notNull()
  .$onUpdate(() => new Date()),
```

(No migration needed — `$onUpdate` is a Drizzle runtime behavior, not a DDL change.)

### WR-05: `validateStorageEnv()` does not validate `STORAGE_DEFAULT_QUOTA_BYTES` or the `S3_FORCE_PATH_STYLE` value

**File:** `packages/storage/src/env.ts:33-103`; `.env.example:102-104,117`
**Issue:** Two env-validation gaps relative to the project's crash-at-boot pattern (cf. `BULL_BOARD_READ_ONLY`, which crashes on any value other than `"true"`/`"false"`):
- `STORAGE_DEFAULT_QUOTA_BYTES` is documented in `.env.example` as part of this phase but is never parsed/validated. A typo (`1GB`, `1_073_741_824`, empty string) survives boot and will only surface as silent quota misbehavior in Phase 26 (`Number("1GB")` → `NaN`, and `NaN` comparisons are always false — quota checks could silently always-pass or always-fail depending on direction).
- `S3_FORCE_PATH_STYLE` is only checked for presence (line 77: `if (!process.env[v])`), so `S3_FORCE_PATH_STYLE=yes` or `=0` passes validation but has undefined meaning for the Phase 25 adapter.
**Fix:** In `validateStorageEnv()`, after the provider switch:

```ts
const quota = process.env.STORAGE_DEFAULT_QUOTA_BYTES;
if (quota !== undefined && quota !== "" && (!/^\d+$/.test(quota) || Number(quota) <= 0)) {
  throw new Error("STORAGE_DEFAULT_QUOTA_BYTES must be a positive integer (bytes).");
}
```

and inside the `s3-compat` branch, reject values other than `"true"`/`"false"` for `S3_FORCE_PATH_STYLE` (mirroring the `BULL_BOARD_READ_ONLY` discipline).

## Info

### IN-01: `collectFileRelations` docstring claims `loadAll()` calls it, but `loadAll()` inlines an equivalent loop

**File:** `packages/storage/src/registry.ts:84-94`; `apps/api/src/core/registry.ts:137-141`
**Issue:** The helper's doc says *"Per D-09, `ModuleRegistry.loadAll()` calls this immediately after the existing `def.health` collection block"*, but `loadAll()` duplicates the loop inline and never imports `collectFileRelations` — the exported helper has no production caller (only `registry.test.ts`). Doc/code drift plus mild duplication.
**Fix:** Either replace the inline loop in `apps/api/src/core/registry.ts:137-141` with `collectFileRelations([[name, def]])` (or refactor to call it once after the loop), or update the docstring to say the helper is a test/standalone utility mirroring the inline boot logic.

### IN-02: `fileRelationsRegistry.register()` silently overwrites duplicate `(module, kind)` keys

**File:** `packages/storage/src/registry.ts:54`
**Issue:** `this.byKey.set(...)` is last-write-wins (codified intentionally in `registry.test.ts:38`), in contrast to the loud duplicate-key guards for CQRS commands/queries in `apps/api/src/core/registry.ts:105-124` (the `cqrs-silent-handler-overwrite` discipline). Within a single `loadAll()` collisions are impossible (Object keys are unique, modules are deduped), but a second `ModuleRegistry` instance in the same process re-registers into the shared singleton silently. Consider at least a debug/warn log on overwrite for boot-diagnosability symmetry.
**Fix:** `if (this.byKey.has(key)) logger-or-console.warn(...)` before `set`, or document the last-write-wins choice in the class doc (the test already implies it is deliberate).

### IN-03: Migration journal skips idx 1 — tag numbering gap

**File:** `packages/db/migrations/meta/_journal.json:4-26`
**Issue:** Entries are idx 0 (`0000_red_lester`), idx 2 (`0002_v14_file_storage`), idx 3 (`0003_audit_indexes`) — there is no idx 1 / `0001_*` file. Harmless to the drizzle migrator (it applies by journal order/`when`, both consistent here, verified against the applied 0003), but the gap will confuse anyone auditing the migration sequence and any tooling that assumes contiguous indices.
**Fix:** Add a one-line note to the migration folder README (or the 0002 SQL header) explaining the gap (e.g., a reserved/abandoned 0001 during Phase 24 planning), or renumber before more migrations stack on top.

### IN-04: Red-path tests leave a stray lint-breaking file in `apps/api/src` if the test process is hard-killed

**File:** `scripts/__tests__/files-access-ban.test.ts:33-34,67,86`
**Issue:** Both red-path tests write `apps/api/src/__files_access_red_path_fixture_tmp__.ts` into the real source tree. `afterAll` + `finally` cover normal failures, but a SIGKILL/OOM between `writeFileSync` and cleanup leaves a file that makes every subsequent `bun run lint` fail (both the grit rule and the grep gate fire on it) until manually deleted — a confusing failure mode for the next developer. Test-reliability note only.
**Fix:** Prefer `mkdtemp` under `os.tmpdir()` for the Biome B5 check (Biome can scan an explicit path outside the repo with `--config-path`), or at minimum add the temp filename to `.gitignore` and a comment in the lint script pointing at the cleanup.

---

_Reviewed: 2026-06-11T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
