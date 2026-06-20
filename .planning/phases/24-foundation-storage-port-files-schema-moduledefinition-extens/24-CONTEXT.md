# Phase 24: Foundation — Storage Port + Files Schema + ModuleDefinition Extension - Context

**Gathered:** 2026-05-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Lay the foundational types, schema, and registry hooks so subsequent v1.4 phases plug into a stable contract. Phase 24 ships:

- `packages/storage/` workspace skeleton with `FileStorage` and `ImageTransform` ports.
- Drizzle migration `0002_v14_file_storage.sql` creating central `files` + `tenant_storage_usage` tables.
- `ModuleDefinition.fileRelations` field with `fileRelationsRegistry` collection at boot (mirrors Phase 22 health-contributor pattern).
- Env additions (`STORAGE_PROVIDER`, `IMAGE_TRANSFORM_PROVIDER`, `STORAGE_DEFAULT_QUOTA_BYTES`, adapter-specific vars) with crash-on-missing validation (mirrors Phase 17 `validateObservabilityEnv`).
- Throwing-NotImplemented adapter scaffolds for all three storage providers and both image providers — real adapter bodies arrive in Phases 25 and 28.
- Biome GritQL rule banning direct `db.select().from(files)` outside `packages/modules/files/`.

Real adapter implementations, sign-upload flow, quota enforcement, image transforms, identity wiring, UI uploader, and operator surface all live in Phases 25–31.

</domain>

<decisions>
## Implementation Decisions

### Migration: `0002_v14_file_storage.sql` column scope

- **D-01:** `files.status` is a TEXT-with-CHECK enum declaring the **full lifecycle in Phase 24**: `'pending' | 'uploaded' | 'transforming' | 'ready' | 'failed' | 'deleted'`. Phases 26–28 transition into states; Phase 24 declares all of them up front to avoid mid-flight enum migrations.
- **D-02:** `tenant_storage_usage.bytes_pending bigint NOT NULL DEFAULT 0` ships in Phase 24 even though the consumer is Phase 26's race-safe quota UPSERT pattern. One unused column for ~1 phase is cheaper than a Phase 26 migration that lands alongside the quota logic.
- **D-03:** `files.transforms jsonb NOT NULL DEFAULT '{}'::jsonb` ships in Phase 24 (consumed Phase 28). Manifest shape is finalized during Phase 28's sharp spike; the column is nullable-flexibility via jsonb default.
- **D-04:** `files.deleted_at timestamp NULL` ships in Phase 24 (consumed Phase 27's soft-delete). Indexed via partial-index `WHERE deleted_at IS NULL` for live-row queries.
- **D-05:** Migration ships with a Drizzle `down()` migration alongside the up. Treated as a developer escape hatch in pre-prod, not a production rollback strategy. Production rollback guidance is documented in Phase 31's `docs/integrations/file-storage.md`.

### `fileRelationsRegistry` ownership and wiring

- **D-06:** Registry singleton, `FileRelation` type, and `collectFileRelations(modules)` collector live in `packages/storage/`. Storage package owns the contract surface; the files module (Phase 26) consumes the registry — it does not own it. This keeps the registry testable in `packages/storage/__tests__/` from day 1 without depending on `apps/api/`.
- **D-07:** `FileRelation` is validated with a Zod schema at collection time. Registry throws on invalid shape with the offending module name + relation key, fails boot loud. Matches existing CQRS/better-auth validation patterns.
- **D-08:** Registry is keyed by `(ownerModule, kind)` where `kind` is the relation key in the `fileRelations: Record<string, FileRelation>` map. `recordType` lives inside the value as the schema-side discriminator. Two-level naming matches Phase 26 success criterion #4 verbatim.
- **D-09:** `ModuleRegistry.loadAll()` collects `def.fileRelations` in Phase 24, immediately after the existing `def.health` collection block at `apps/api/src/core/registry.ts:101-103`. Phase 26's files module just reads the populated registry — no Phase 26 wiring change.

### Env defaults & validation (`validateStorageEnv`)

- **D-10:** `STORAGE_PROVIDER` defaults to `'local'` when unset. Matches Phase 17's `TRACER='noop'` default DX posture — clone, run, uploads work in dev without S3 setup.
- **D-11:** `STORAGE_DEFAULT_QUOTA_BYTES` defaults to **1 GiB** (`1073741824`). Conservative for fork users on cheap hosting; per-tenant override remains available at row level.
- **D-12:** `IMAGE_TRANSFORM_PROVIDER` defaults to `'sharp'` (Phase 28's spike S-1 may flip this if the smoke test goes RED — that pivot is Phase 28's call, not Phase 24's).
- **D-13:** Adapter-specific env validation is **selective**: only the selected provider's required vars are checked. `STORAGE_PROVIDER=local` requires only `STORAGE_LOCAL_PATH` (default `'./storage'`); `=s3` requires `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_REGION`/`S3_BUCKET`; `=s3-compat` requires `S3_ENDPOINT` + creds + `S3_BUCKET` + `S3_FORCE_PATH_STYLE`. Crash message names the missing var + the selected provider.
- **D-14:** Pitfall 14 is enforced in Phase 24's env validator: `STORAGE_PROVIDER === 'local' && NODE_ENV === 'production'` crashes at boot with `"Local storage adapter is not safe for production. Set STORAGE_PROVIDER=s3 or s3-compat."` This ships in Phase 24 even though the Local adapter body arrives in Phase 25 — the env contract is foundation work.

### Adapter scaffold strategy

- **D-15:** Three `FileStorage` adapter classes ship in Phase 24 — `LocalFileStorage`, `S3FileStorage`, `S3CompatFileStorage` — each implementing the port with every method throwing `new Error('FileStorage.{method}: not yet implemented in Phase 24; arriving in Phase 25')`. Factory selects the right class per `STORAGE_PROVIDER`. `getFileStorage()` returns a real instance (never null), satisfying success criterion #3 ("factory returns the correct adapter shape").
- **D-16:** Same scaffold strategy for `ImageTransform`: `SharpImageTransform` + `ImagescriptImageTransform` ship as throwing-NotImplemented classes. Phase 28 fills the bodies after spike S-1.
- **D-17:** Biome GritQL ban on direct `db.select().from(files)` ships in Phase 24 at `.biome/grit/ban-files-table-access.grit` with `biome.json` plugins config. Allow-list path is `packages/modules/files/**` (proactively allowed even though the path is created in Phase 26). Rule fires through the existing `bun run validate` chain.
- **D-18:** Phase 24 does **not** add `'files'` to `apps/api/src/core/registry.ts` `moduleImportMap`. Phase 26's first task adds the entry alongside the `@baseworks/module-files` package skeleton. Avoids dead-load of an empty module for one phase.

### Claude's Discretion

- Exact Zod schema shape for `FileRelation` (column-by-column field names match research §4 keystone; refinements like array-non-empty, byte-size positive-integer are Claude's call).
- Index choices on `files` and `tenant_storage_usage` beyond the obvious `(tenant_id)` and `(tenant_id, owner_module, owner_record_id)` — Claude proposes during planning; planner verifies against query patterns from Phases 26–31.
- Exact phrasing of crash messages from `validateStorageEnv` (must include the missing var name + the offending provider; format style is Claude's call).
- Whether to colocate Phase 24 tests in `packages/storage/__tests__/` or `packages/storage/src/__tests__/` (existing project precedent: observability uses `packages/observability/src/__tests__/`).

### Folded Todos

None. No pending todos matched Phase 24's foundation scope.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.4 milestone research (synthesis + sources)
- `.planning/research/SUMMARY.md` — TL;DR, top-10 pitfalls, 8-phase decomposition rationale; FILE-02-moved-to-Phase-25 variance explained
- `.planning/research/STACK.md` — `Bun.S3Client` HIGH confidence, `sharp` MEDIUM (spike S-1 required), library decisions, NOT-using list
- `.planning/research/FEATURES.md` — table-stakes vs differentiators per category; per-category dependency graph
- `.planning/research/ARCHITECTURE.md` §1 Decision Summary, §2 Schema, §3 Ports, §4 Module Integration, §10 Polymorphic Association, §11 New-vs-modified file inventory, §12 Build order
- `.planning/research/PITFALLS.md` Pitfall 1 (predictable storage keys), Pitfall 5 (cross-tenant authz on file read), Pitfall 7 (concurrent quota race), Pitfall 13 (multi-row Drizzle returning), Pitfall 14 (Local adapter prod refusal), Pitfall 20 + Pitfall 21 (auth registry timing, scopedDb wrapper)

### Roadmap and requirements
- `.planning/ROADMAP.md` Phase 24 entry — 5 success criteria (locked)
- `.planning/REQUIREMENTS.md` FILE-01 + MOD-01

### Existing patterns this phase mirrors
- `apps/api/src/core/registry.ts` lines 95-105 — health-contributor collection block; `fileRelations` collection block lands immediately after
- `packages/shared/src/types/module.ts` — `ModuleDefinition` interface; `fileRelations?: Record<string, FileRelation>` field added here in Phase 24
- `packages/observability/src/factory.ts` — env-selected singleton factory pattern with `set*`/`reset*` test helpers; `getFileStorage()`/`getImageTransform()` follow this exact shape
- `packages/db/src/schema/base.ts` — `primaryKeyColumn()`, `tenantIdColumn()`, `timestampColumns()` shared helpers used by `files` + `tenant_storage_usage` schemas
- `packages/db/src/schema/billing.ts` — closest analog for a tenant-scoped, multi-table feature schema

### v1.3 patterns this phase reuses
- Phase 17 `validateObservabilityEnv` — env validation that crashes at boot with named missing var; `validateStorageEnv` is a structural copy
- Phase 22 `HealthAggregator` registration in `ModuleRegistry.loadAll()` — `fileRelationsRegistry` registers identically

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `packages/shared/src/types/module.ts` — `ModuleDefinition` is the contract being extended. `HealthContributor` already there gives the pattern shape.
- `apps/api/src/core/registry.ts` — `ModuleRegistry.loadAll()` is the boot loop. Existing `def.health` collection at lines 101-103 is the literal precedent for `def.fileRelations` collection.
- `packages/db/src/schema/base.ts` — `primaryKeyColumn()` (UUID with `gen_random_uuid()`), `tenantIdColumn()` (varchar 36, NOT NULL), `timestampColumns()` (createdAt/updatedAt with `defaultNow()`). All three used by `files` + `tenant_storage_usage`.
- `packages/observability/src/factory.ts` — `getTracer()` / `setTracer()` / `resetTracer()` lazy-singleton trio. `getFileStorage()` / `setFileStorage()` / `resetFileStorage()` and `getImageTransform()` / `setImageTransform()` / `resetImageTransform()` follow this shape verbatim, including the `process.env`-direct read (no `@baseworks/config` import to keep telemetry-bootstrap-safe).
- `packages/observability/src/index.ts` — barrel-export pattern for ports, types, adapters, factory. `packages/storage/src/index.ts` follows it.

### Established Patterns

- **Port-and-adapter (v1.1 Phase 10 + v1.3 Phase 17):** ports live in `packages/{name}/src/ports/`, adapters in `packages/{name}/src/adapters/{provider}/`, factory in `packages/{name}/src/factory.ts`. Phase 24 establishes `packages/storage/` on this layout.
- **Env-driven factory selection with crash-on-missing (v1.3 Phase 17):** Singleton factories read `process.env.{VAR}` directly. Unknown values throw with the supported list. Missing required values for the selected provider throw with the missing var name. Production-unsafe combinations throw with the named pitfall.
- **Registry collection at `loadAll()` (v1.3 Phase 22):** Module declares `def.{thing}`; registry collects all `def.{thing}` instances at boot into a typed aggregator/registry singleton; downstream code reads the populated registry.
- **Drizzle schema with shared helpers (v1.0):** all tenant-scoped tables use the three helpers from `packages/db/src/schema/base.ts`. New tables MUST use them.
- **Biome GritQL plugins (v1.3 Phase 19):** `enterWith` ban + observability rules already in `.biome/`; `ban-files-table-access.grit` follows the same plugin-loading pattern via `biome.json`.

### Integration Points

- `packages/shared/src/types/module.ts` — `ModuleDefinition` interface gets a new optional field. Existing modules (auth, billing, example) compile without changes.
- `apps/api/src/core/registry.ts` `loadAll()` — one new block after the existing `def.health` block, calling `collectFileRelations()` from `@baseworks/storage`.
- `packages/db/src/schema/index.ts` — re-exports the new `storage.ts` schema file.
- `packages/db/drizzle.config.ts` — already discovers schemas via the index re-export; no config change.
- `apps/api/src/index.ts` and `apps/worker/src/index.ts` — env validator (`validateStorageEnv()`) called at boot, before module registry initialization. Phase 17 pattern.
- `biome.json` plugins array + `.biome/grit/` directory — the GritQL rule lands here.
- `.env.example` — adds `STORAGE_PROVIDER`, `IMAGE_TRANSFORM_PROVIDER`, `STORAGE_DEFAULT_QUOTA_BYTES`, `STORAGE_LOCAL_PATH`, `S3_*`, `AWS_*` documentation entries.

</code_context>

<specifics>
## Specific Ideas

- "Phase 24 schema decisions echo Phase 17's discipline: ship the contract surface broadly, fill bodies later. Adding columns mid-milestone is more expensive than living with one or two unused-for-a-phase columns."
- "Throwing-NotImplemented adapters keep the factory return type honest — `getFileStorage()` always returns a real instance, never null, never throws at lookup time. Methods throw on call, with phase-pointer error messages so a fork user accidentally invoking them gets actionable guidance."
- "1 GiB quota default is a conservative fork-friendly number. Forks on bigger plans bump it via env; forks on cheap hosting feel safe out of the box."
- "Pitfall 14 (`STORAGE_PROVIDER=local && NODE_ENV=production`) lives in Phase 24's env validator even though the Local adapter is Phase 25 — the prod-safety contract is foundation-phase work, not adapter-phase work."

</specifics>

<deferred>
## Deferred Ideas

- **Per-tenant quota plans via better-auth org metadata** (research §8 open question) — deferred to Phase 26 or a v1.5 quota-plans phase. v1.4 ships single env-default + per-row override only.
- **Bucket-per-tenant vs prefix-per-tenant** (research §8) — locked to prefix-per-tenant for v1.4; bucket-per-tenant is v1.5+ when fork-user demand emerges.
- **`files.kind` discriminator validation** (registry-validated vs free-form) — registry-validated is implied by D-08 (registry knows allowed kinds), but the rejection-of-unknown-pairs assertion is Phase 26's `sign-upload` HTTP 400 contract, not Phase 24's.
- **POST policy default vs PUT default** (research §8) — locked to PUT default in research §1; POST is opt-in via Phase 25 spike S-2.
- **Virus-scanning hook port shape** (research §8) — deferred entirely per PROJECT.md; no port shape reserved in Phase 24.
- **Test infrastructure scope** (MinIO-in-CI, sharp fixture set, adapter conformance suite) — Phase 25 deliverable per ROADMAP. Phase 24 ships only the unit-level tests around env validation, registry collection, factory selection, and migration up/down.

### Reviewed Todos (not folded)

None — no pending todos surfaced for review against this phase's scope.

</deferred>

---

*Phase: 24-foundation-storage-port-files-schema-moduledefinition-extens*
*Context gathered: 2026-05-05*
