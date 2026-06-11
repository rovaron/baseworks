---
phase: 24-foundation-storage-port-files-schema-moduledefinition-extens
verified: 2026-06-11T00:00:00Z
status: gaps_found
score: 5/5 must-haves verified
overrides_applied: 0
gaps:
  - truth: "files_tenant_bucket_key_uq unique index enforces cross-tenant bucket+key exclusivity"
    status: failed
    reason: "CR-01 (Critical): The unique index is defined on (tenant_id, bucket, storage_key). Because tenant_id is part of the composite key, two DIFFERENT tenants CAN both claim the same (bucket, storage_key) pair — the index only prevents the same tenant from claiming a key twice. The code comment in storage.ts and the T-24-02-01 STRIDE mitigation both claim cross-tenant uniqueness is enforced, but it is not. This is a factually incorrect security invariant baked into the foundation schema."
    artifacts:
      - path: "packages/db/src/schema/storage.ts"
        issue: "uniqueIndex('files_tenant_bucket_key_uq').on(t.tenantId, t.bucket, t.storageKey) — tenant_id in key makes index per-tenant only, not cross-tenant. Comment says 'Cross-tenant uniqueness guarantee' which is false."
      - path: "packages/db/migrations/0002_v14_file_storage.sql"
        issue: "CREATE UNIQUE INDEX 'files_tenant_bucket_key_uq' ON 'files' ('tenant_id', 'bucket', 'storage_key') — same mismatch applied to live DB."
    missing:
      - "Change schema to: uniqueIndex('files_bucket_key_uq').on(t.bucket, t.storageKey)"
      - "Update migration SQL, down migration, and both snapshots (0002 + 0003), or generate a new migration after the schema change"
      - "Fix comment and T-24-02-01 STRIDE mitigation entry to accurately describe per-tenant vs. cross-tenant isolation responsibility"

  - truth: "CHECK constraint (files_status_check) and partial index (files_pending_status_idx WHERE deleted_at IS NULL) are durably expressed in the Drizzle schema, not just in hand-edited SQL"
    status: failed
    reason: "WR-01: Both constructs are hand-edited into 0002_v14_file_storage.sql only. They exist in the live DB (verified) but are absent from the Drizzle table builder and meta snapshots (0002 and 0003). A future drizzle-kit generate/push touching the files indexes will silently recreate files_pending_status_idx without the WHERE clause and emit nothing for files_status_check, causing silent drift."
    artifacts:
      - path: "packages/db/src/schema/storage.ts"
        issue: "index('files_pending_status_idx').on(t.status, t.createdAt) — no .where() clause. No check() constraint. Comment says 'Drizzle 0.45 cannot express these' but pinned drizzle-orm ^0.45 + drizzle-kit 0.31.10 support both check() and index().where(sql`...`)."
      - path: "packages/db/migrations/meta/0002_snapshot.json"
        issue: "Snapshot has no 'where' field on files_pending_status_idx and checkConstraints: {}. Future drizzle-kit diffs will compute against these incorrect snapshots."
    missing:
      - "Add index('files_pending_status_idx').on(t.status, t.createdAt).where(sql`${t.deletedAt} IS NULL`) to the schema builder"
      - "Add check('files_status_check', sql`${t.status} IN ('pending','uploaded','transforming','ready','failed','deleted')`) using drizzle-orm's check() builder"
      - "Regenerate snapshots 0002 and 0003 so drizzle-kit future diffs compute against reality"

  - truth: "packages/storage and packages/shared test suites run under bun run test (CI gate)"
    status: failed
    reason: "WR-03: The root test script is 'bun test apps/api packages/config packages/db packages/modules packages/queue scripts/__tests__ && cd packages/ui && bun run test'. Neither packages/storage nor packages/shared appears. All 90 storage tests and 4 shared module-type tests pass when run directly, but they are invisible to the CI/pre-push gate. A regression in the factory, env validator, fileRelations Zod validation, or port shape would ship green."
    artifacts:
      - path: "package.json"
        issue: "Line 22: 'test' script does not list packages/storage or packages/shared"
    missing:
      - "Add 'packages/storage packages/shared' to the root test script: \"test\": \"bun test apps/api packages/config packages/db packages/modules packages/queue packages/shared packages/storage scripts/__tests__ && cd packages/ui && bun run test\""

  - truth: "tenant_storage_usage.updatedAt auto-bumps on row mutation (consistent with audit-phase pattern for all updatedAt columns)"
    status: failed
    reason: "WR-04: tenant_storage_usage.updatedAt is declared as timestamp('updated_at').defaultNow().notNull() without .$onUpdate(() => new Date()). The files table correctly uses timestampColumns() which includes $onUpdate (added in audit phase 5). Phase 26 quota UPSERTs that mutate bytes_used/bytes_pending will leave updated_at stale unless every call site manually sets the column, repeating the exact pattern the audit campaign fixed."
    artifacts:
      - path: "packages/db/src/schema/storage.ts"
        issue: "Line 89: updatedAt: timestamp('updated_at').defaultNow().notNull() — missing .$onUpdate(() => new Date())"
    missing:
      - "Change to: updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())"
      - "No DDL migration needed — $onUpdate is a Drizzle runtime behavior, not a DDL change"
---

# Phase 24: Foundation Storage Port + Files Schema + ModuleDefinition Extension — Verification Report

**Phase Goal:** Lay the foundational types, schema, and registry hooks so subsequent phases plug into a stable contract — packages/storage/ workspace skeleton, FileStorage + ImageTransform ports, central files + tenant_storage_usage tables, ModuleDefinition.fileRelations field, env additions with crash-on-missing validation.
**Verified:** 2026-06-11T00:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `bun run db:migrate` creates `files` + `tenant_storage_usage` tables with tenant-scoped indexes; rollback path documented | VERIFIED | Both tables exist in live DB (docker exec verified). `files_status_check` CHECK constraint and `files_pending_status_idx` partial index (WHERE deleted_at IS NULL) confirmed in pg_constraint + pg_indexes. Down migration exists at `packages/db/migrations/0002_v14_file_storage.down.sql`. 3 applied migrations in `__drizzle_migrations`. |
| 2 | `import { FileStorage, ImageTransform } from "@baseworks/storage"` surfaces fully typed port interfaces | VERIFIED | `packages/storage/src/ports/file-storage.ts` exports `FileStorage` with all 6 methods (signUpload, signRead, stat, delete, getObject, putObject) + `SignedUpload`, `SignedRead`, `ObjectStat`. `packages/storage/src/ports/image-transform.ts` exports `ImageTransform` with both `resize` AND `metadata`, `ImageMetadata`. `ImageVariantSpec` re-exported from `@baseworks/shared`. Barrel index exports all symbols. 90 tests pass / 0 fail. |
| 3 | STORAGE_PROVIDER=local\|s3\|s3-compat factory returns correct adapter shape; missing adapter-required env crashes apps/api boot naming the missing var | VERIFIED | `packages/storage/src/factory.ts` returns LocalFileStorage/S3FileStorage/S3CompatFileStorage per STORAGE_PROVIDER env. `packages/storage/src/env.ts` `validateStorageEnv()` crashes with named missing var (e.g., `AWS_ACCESS_KEY_ID is required when STORAGE_PROVIDER=s3`). Called in `apps/api/src/index.ts` line 56 (after validateObservabilityEnv, before RingBufferingErrorTracker) and `apps/api/src/worker.ts` line 35 (after validateObservabilityEnv, before installGlobalErrorHandlers). |
| 4 | ModuleDefinition.fileRelations declared by module authors is collected at boot into fileRelationsRegistry singleton | VERIFIED | `packages/shared/src/types/module.ts` declares `FileRelation`, `ImageVariantSpec`, and `fileRelations?: Record<string, FileRelation>` on `ModuleDefinition`. `packages/storage/src/registry.ts` exports `fileRelationsRegistry` singleton with register/get/getAll/reset methods and Zod runtime validation. `apps/api/src/core/registry.ts` imports `fileRelationsRegistry` and calls `fileRelationsRegistry.register(name, kind, relation)` inline in `loadAll()` after the health block (lines 131-141). |
| 5 | Biome GritQL rule bans direct db.select().from(files) outside packages/modules/files/ | VERIFIED | `.biome/plugins/ban-files-table-access.grit` exists with `register_diagnostic` at `severity = "error"` matching `` `$db.select($args).from(files)` ``. Registered in `biome.json` plugins array. `scripts/lint-no-direct-files-access.sh` shell gate with ALLOWLIST. Both `lint:files-access` and `lint:als` wired into root `lint` script. 4 integration tests pass (`scripts/__tests__/files-access-ban.test.ts`). |

**Score:** 5/5 truths verified. All ROADMAP success criteria are met by the implementation.

### Critical Quality Gaps (Not SC Blockers — Must Close Before Phase 26)

The following gaps do not fail a stated success criterion but represent correctness errors in the foundation that will become active security problems once Phase 26 adds upload paths.

| # | Finding | Severity | Root Cause |
|---|---------|----------|-----------|
| CR-01 | Unique index `files_tenant_bucket_key_uq` is on `(tenant_id, bucket, storage_key)` — does not enforce cross-tenant uniqueness despite the comment and T-24-02-01 claiming it does | Critical | Schema comment and threat model entry are factually incorrect; two tenants can claim the same physical object |
| WR-01 | CHECK constraint and partial index WHERE clause are hand-edited into migration SQL but absent from Drizzle schema builder + snapshots | Warning | Future drizzle-kit generate will silently drop both without error |
| WR-03 | `packages/storage` and `packages/shared` not in root `bun run test` script | Warning | CI/pre-push gate never exercises 90 storage tests or 4 shared type tests |
| WR-04 | `tenant_storage_usage.updatedAt` missing `.$onUpdate()` | Warning | Repeats exact pattern fixed by audit phase 5; Phase 26 quota mutations will leave timestamp stale |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/storage/package.json` | @baseworks/storage workspace manifest | VERIFIED | name: "@baseworks/storage", workspace deps: @baseworks/shared, zod |
| `packages/storage/tsconfig.json` | TS config extending repo root | VERIFIED | extends: "../../tsconfig.json", noEmit: true |
| `packages/storage/src/ports/file-storage.ts` | FileStorage port + SignedUpload, SignedRead, ObjectStat | VERIFIED | All 6 interface methods present; no storage_key in result types (T-24-01-01) |
| `packages/storage/src/ports/image-transform.ts` | ImageTransform port (resize + metadata) + ImageMetadata | VERIFIED | Both methods present; re-exports ImageVariantSpec from @baseworks/shared (no redeclaration) |
| `packages/storage/src/adapters/local/file-storage.ts` | LocalFileStorage scaffold (name="local") | VERIFIED | Throws verbatim D-15 message on all 6 methods |
| `packages/storage/src/adapters/s3/file-storage.ts` | S3FileStorage scaffold (name="s3") | VERIFIED | Same D-15 verbatim messages |
| `packages/storage/src/adapters/s3-compat/file-storage.ts` | S3CompatFileStorage scaffold (name="s3-compat") | VERIFIED | Same D-15 verbatim messages |
| `packages/storage/src/adapters/sharp/image-transform.ts` | SharpImageTransform scaffold (name="sharp") | VERIFIED | Throws D-16 parallel-form messages on resize + metadata |
| `packages/storage/src/adapters/imagescript/image-transform.ts` | ImagescriptImageTransform scaffold (name="imagescript") | VERIFIED | Same D-16 parallel-form messages |
| `packages/storage/src/factory.ts` | getFileStorage + getImageTransform + set/reset trios | VERIFIED | D-10 default local, D-12 default sharp; reads process.env directly (no @baseworks/config import) |
| `packages/storage/src/env.ts` | validateStorageEnv() with D-13/D-14 validation | VERIFIED | D-14 production-local crash message exact; named missing vars; no secret echo |
| `packages/storage/src/registry.ts` | fileRelationsRegistry singleton + collectFileRelations | VERIFIED | Zod validation on all register() calls; two-level key `${ownerModule}:${kind}`; reset() for test isolation |
| `packages/shared/src/types/module.ts` | ModuleDefinition.fileRelations + FileRelation + ImageVariantSpec | VERIFIED | fileRelations?: Record<string, FileRelation>; ImageVariantSpec.format = "webp"\|"jpeg"\|"png" (no SVG) |
| `packages/db/src/schema/storage.ts` | files + tenant_storage_usage Drizzle tables | VERIFIED (with CR-01 gap) | All D-01..D-04 columns present; uses primaryKeyColumn/tenantIdColumn/timestampColumns; unique index key has correctness gap (CR-01) |
| `packages/db/migrations/0002_v14_file_storage.sql` | DDL creating both tables + indexes + CHECK + partial index | VERIFIED (with WR-01 caveat) | SQL correct as written and applied; invisible to Drizzle snapshots (WR-01) |
| `apps/api/src/index.ts` | validateStorageEnv() call in boot prelude | VERIFIED | Line 56: after validateObservabilityEnv (54), before RingBufferingErrorTracker (62) |
| `apps/api/src/worker.ts` | validateStorageEnv() call in worker boot prelude | VERIFIED | Line 35: after validateObservabilityEnv (33), before installGlobalErrorHandlers (37) |
| `apps/api/src/core/registry.ts` | fileRelations collection block in loadAll() | VERIFIED | Lines 131-141: if(def.fileRelations) loop calling fileRelationsRegistry.register after health block |
| `.biome/plugins/ban-files-table-access.grit` | GritQL rule banning db.select().from(files) | VERIFIED | severity="error", rule id "no-direct-files-table-access", registered in biome.json |
| `.env.example` | 4 storage env vars documented (STORAGE_PROVIDER, STORAGE_LOCAL_PATH, STORAGE_DEFAULT_QUOTA_BYTES, IMAGE_TRANSFORM_PROVIDER) | VERIFIED | All 4 uncommented; S3/AWS vars commented as placeholders |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/storage/src/index.ts` | `ports/file-storage.ts` | `export type { FileStorage, ...}` | VERIFIED | Line 26-33: all 4 types exported |
| `packages/storage/src/index.ts` | `ports/image-transform.ts` | `export type { ImageTransform, ImageMetadata, ImageVariantSpec }` | VERIFIED | Lines 38-42 |
| `packages/storage/src/ports/image-transform.ts` | `@baseworks/shared` | `export type { ImageVariantSpec } from "@baseworks/shared"` | VERIFIED | Line 31; no redeclaration in storage |
| `packages/storage/src/factory.ts` | adapter scaffolds | process.env.STORAGE_PROVIDER switch | VERIFIED | Lines 37-51: local/s3/s3-compat; no @baseworks/config import |
| `apps/api/src/index.ts` | `@baseworks/storage` | named import + boot call `validateStorageEnv()` | VERIFIED | Import line 20; call line 56 |
| `apps/api/src/worker.ts` | `@baseworks/storage` | named import + boot call `validateStorageEnv()` | VERIFIED | Import line 19; call line 35 |
| `apps/api/src/core/registry.ts` | `@baseworks/storage` (fileRelationsRegistry) | `fileRelationsRegistry.register(name, kind, relation)` in loadAll() | VERIFIED | Import line 2; inline collection block lines 131-141 |
| `biome.json` | `.biome/plugins/ban-files-table-access.grit` | plugins array | VERIFIED | Line 5 of biome.json |
| `package.json scripts.lint` | `scripts/lint-no-direct-files-access.sh` | `bun run lint:files-access` | VERIFIED | lint chain line 16; lint:files-access line 18 |

### Data-Flow Trace (Level 4)

Not applicable for this phase — all artifacts are type declarations, factory singletons, schema definitions, and lint rules. No components render dynamic data from a database query chain in this phase.

### Behavioral Spot-Checks

| Behavior | Result | Status |
|----------|--------|--------|
| `bun test packages/storage` — 90 storage tests | 90 pass / 0 fail | PASS |
| `bun test packages/shared` — 4 module-type tests | 4 pass / 0 fail | PASS |
| `bun test scripts/__tests__/files-access-ban.test.ts` — lint-ban integration | 4 pass / 0 fail | PASS |
| `bash scripts/lint-no-direct-files-access.sh` — shell gate on clean repo | exit 0 | PASS |
| Live DB: `files` + `tenant_storage_usage` tables exist with correct schema | Both tables confirmed with 17 + 5 columns, CHECK constraint, partial index | PASS |
| `validateStorageEnv()` crashes on `STORAGE_PROVIDER=s3` without AWS credentials | Throws `AWS_ACCESS_KEY_ID is required when STORAGE_PROVIDER=s3. Set AWS_ACCESS_KEY_ID in your environment.` | PASS |
| `validateStorageEnv()` crashes on `STORAGE_PROVIDER=local` + `NODE_ENV=production` | Throws exact D-14 message | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| FILE-01 | Plans 24-01, 24-02, 24-04, 24-06, 24-07 | STORAGE_PROVIDER env selects adapter at startup; missing required env crashes at boot | SATISFIED | factory.ts + env.ts + apps/api boot wire-up + GritQL ban all verified |
| MOD-01 | Plans 24-03, 24-05, 24-06 | Module author declares fileRelations in ModuleDefinition; collected at boot | SATISFIED | FileRelation type in @baseworks/shared; fileRelationsRegistry with Zod validation; loadAll() collection block in registry.ts |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `packages/db/src/schema/storage.ts:61` | Comment "Cross-tenant uniqueness guarantee: same bucket+key cannot be claimed by two tenants" is factually incorrect — the index is on (tenant_id, bucket, storage_key) | Blocker | T-24-02-01 threat mitigation is false; latent cross-tenant isolation gap activates in Phase 26 |
| `packages/db/src/schema/storage.ts:89` | `updatedAt: timestamp("updated_at").defaultNow().notNull()` — missing `.$onUpdate(() => new Date())` | Warning | Phase 26 quota mutations leave updated_at stale |
| `packages/storage/src/registry.ts:84-94` | `collectFileRelations()` docstring says "loadAll() calls this immediately after the health block" but loadAll() uses an inline duplicate loop and never imports collectFileRelations | Info | IN-01: doc/code drift; exported function has no production caller (test-only) |
| `package.json:22` | `bun run test` script omits `packages/storage packages/shared` | Warning | CI/pre-push gate never runs 90 storage tests or 4 shared module-type tests |

### Human Verification Required

None — all phase-24 deliverables are programmatically verifiable. The 5 success criteria are fully verified via automated checks.

### Pre-Existing Issues (Not Phase 24 Gaps)

Per the environment notes and `deferred-items.md`, the following pre-existing issues exist and are explicitly NOT caused by this phase:

- **132 repo-wide tsc TS6059 rootDir errors**: Pre-existing `rootDir` + `declaration` mismatch across all workspace imports. Not introduced by Phase 24.
- **9 bun test apps/api failures**: Audit-era auth-export/ioredis/Elysia drift in files untouched by this phase. The registry-health test (one of the 9) fails only in the full suite due to bun:test mock-module ordering pollution; it passes in isolation.
- **`bun run lint` (full chain) exits non-zero due to nested `biome.json` in `.claude/worktrees/`**: Pre-existing stale worktree directories; the Phase 24 lint:files-access and lint:als gates both exit 0 independently.

### Gaps Summary

The 5 ROADMAP success criteria are all met — the foundational types, schema, factory, registry, and lint gate are in place and working. Phase 24 delivers what was promised.

Four gaps require closure before Phase 26 builds on this foundation:

**CR-01 (Critical — must close before Phase 26):** The `files_tenant_bucket_key_uq` unique index includes `tenant_id` in the composite key, which means two different tenants can claim the same physical `(bucket, storage_key)` object. The schema comment and T-24-02-01 threat model both claim this index prevents cross-tenant claiming — this is factually incorrect. The fix is straightforward: drop `tenant_id` from the unique index key. Since the live dev DB has this index applied, a new migration or in-place correction + regenerated snapshot is needed before any upload path (Phase 26+) is added.

**WR-01 (Warning — creates maintenance trap):** The `files_status_check` CHECK constraint and the `WHERE deleted_at IS NULL` partial-index clause exist correctly in the live DB and in the migration SQL, but are absent from both the Drizzle schema builder definition and the migration snapshots. Any future `drizzle-kit generate` touching the `files` table will compute diffs against the snapshot and silently drop or recreate these without the hand-edited clauses. This should be expressed in the schema builder (drizzle-orm `check()` + `index().where(sql\`...\`)`) and the snapshots regenerated.

**WR-03 (Warning — CI blind spot):** The root `bun run test` script does not include `packages/storage` or `packages/shared`. The 90 storage tests (covering factory, env validator, adapter scaffolds, registry, and ports) and 4 shared module-type tests will not execute under the CI gate. Add both paths to the root test script.

**WR-04 (Warning — audit regression):** `tenant_storage_usage.updatedAt` lacks `.$onUpdate(() => new Date())`, exactly the pattern the audit campaign (Phase 5) fixed for the rest of the schema via `timestampColumns()`. Add the `$onUpdate` call — no DDL migration required.

---

_Verified: 2026-06-11T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
