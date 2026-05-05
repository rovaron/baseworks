# Phase 24: Foundation — Storage Port + Files Schema + ModuleDefinition Extension - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-05
**Phase:** 24-foundation-storage-port-files-schema-moduledefinition-extens
**Areas discussed:** Migration column scope, fileRelationsRegistry ownership, Env defaults & validation, Adapter scaffold strategy

---

## Migration column scope

### `files.status` modeling

| Option | Description | Selected |
|--------|-------------|----------|
| TEXT enum with full lifecycle | pgEnum/text+CHECK declaring `pending\|uploaded\|transforming\|ready\|failed\|deleted` in Phase 24; Phases 26-28 transition into them | ✓ |
| Minimal enum, expand per phase | Phase 24 ships pending/uploaded/deleted; later phases ALTER to add states | |
| Boolean flags instead of enum | Separate is_pending/is_complete/is_deleted/transform_status columns | |

**User's choice:** TEXT enum with full lifecycle.
**Notes:** Mid-flight enum migrations in Postgres are painful; declaring all states up front is foundation-phase work.

### `tenant_storage_usage.bytes_pending` in Phase 24?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — ship the column now | bigint NOT NULL DEFAULT 0 in Phase 24, consumed by Phase 26 race-safe quota UPSERT | ✓ |
| No — add it in Phase 26's migration | Phase 26 bundles a migration alongside the quota logic | |

**User's choice:** Yes — ship the column now.

### `files.transforms` jsonb + `deleted_at` columns

| Option | Description | Selected |
|--------|-------------|----------|
| Ship both | transforms jsonb DEFAULT '{}'::jsonb (Phase 28) + deleted_at timestamp NULL (Phase 27) | ✓ |
| Ship deleted_at only | transforms in Phase 28 | |
| Minimal — add both later | Highest per-phase clarity, most migration churn | |

**User's choice:** Ship both.

### Rollback path

| Option | Description | Selected |
|--------|-------------|----------|
| Drizzle down() migration alongside up | Standard drizzle-kit pattern; treated as dev escape hatch | ✓ |
| No down migration; documented manual rollback | Forward-only; rollback in leading-comment SQL snippet | |

**User's choice:** Drizzle down() migration alongside up.

---

## fileRelationsRegistry ownership

### Where does the registry singleton live?

| Option | Description | Selected |
|--------|-------------|----------|
| packages/storage/ — colocated with ports | Storage package owns contract surface; files module (Phase 26) consumes registry | ✓ |
| apps/api/src/core/ — alongside HealthAggregator | Tightest pattern match to Phase 22, but escapes to app layer | |
| packages/shared/ — alongside ModuleDefinition type | Mixes type contracts with runtime singleton state | |

**User's choice:** packages/storage/ — colocated with ports.

### Validation strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Zod schema at registry collection time | Throws on invalid shape with module name + relation key | ✓ |
| TypeScript types only — no runtime validation | TS catches at compile time; trusts build pipeline | |
| Light runtime checks (presence + types) only | Avoids Zod dependency in @baseworks/storage | |

**User's choice:** Zod schema at registry collection time.

### Registry lookup key

| Option | Description | Selected |
|--------|-------------|----------|
| (ownerModule, kind) where kind is the relation key | Two-level naming: kind = developer-facing API; recordType = schema column | ✓ |
| (ownerModule, recordType) — single field | Drops the kind alias; drifts from Phase 26 success criterion wording | |

**User's choice:** (ownerModule, kind) where kind is the relation key.

### Boot wiring timing

| Option | Description | Selected |
|--------|-------------|----------|
| Wire it in Phase 24 | loadAll() collects fileRelations exactly like def.health | ✓ |
| Defer wiring to Phase 26 | Phase 24 ships only type + empty registry singleton | |

**User's choice:** Wire it in Phase 24.

---

## Env defaults & validation

### `STORAGE_PROVIDER` default

| Option | Description | Selected |
|--------|-------------|----------|
| Default to 'local' | Matches Phase 17 noop-default DX posture | ✓ |
| Required — no default, crash if unset | Forces operator intent; punishes dev workflows | |
| Default to 's3-compat' (cloud-first) | Forces S3 setup; awkward in Phase 24 since adapters are Phase 25 | |

**User's choice:** Default to 'local'.

### `STORAGE_DEFAULT_QUOTA_BYTES` default

| Option | Description | Selected |
|--------|-------------|----------|
| 5 GiB (5368709120) | Research §8 placeholder; balanced for SaaS starter | |
| 1 GiB (1073741824) | Conservative for fork users on cheap hosting | ✓ |
| Unlimited (0 = no enforcement) by default | Operators opt-in via env > 0 | |

**User's choice:** 1 GiB.
**Notes:** Conservative for fork users on cheap hosting; per-tenant override available at row level.

### Adapter env validation scope

| Option | Description | Selected |
|--------|-------------|----------|
| Validate only the selected provider's vars | Phase 17 pattern; crash names missing var + offending provider | ✓ |
| Validate all backends' env at boot | Catches config errors early but punishes dev workflows | |

**User's choice:** Validate only the selected provider's vars.

### Pitfall 14 prod-with-local refusal

| Option | Description | Selected |
|--------|-------------|----------|
| Boot-time refusal in env validator | validateStorageEnv() checks STORAGE_PROVIDER=local && NODE_ENV=production | ✓ |
| Defer to Phase 25 with the Local adapter | Phase 25's adapter constructor refuses prod | |

**User's choice:** Boot-time refusal in env validator.

---

## Adapter scaffold strategy

### What does Phase 24 ship for FileStorage adapter classes?

| Option | Description | Selected |
|--------|-------------|----------|
| Throwing 'NotImplemented' adapters per provider | Three classes implementing the port; methods throw with phase-pointer messages | ✓ |
| Single Noop adapter, factory returns it for all providers | One class returns harmless stubs; risk of silent misbehavior | |
| No adapter classes — factory throws | Fails success criterion #3 ("returns the correct adapter shape") | |

**User's choice:** Throwing 'NotImplemented' adapters per provider.

### ImageTransform scaffold

| Option | Description | Selected |
|--------|-------------|----------|
| Same as FileStorage — throwing NotImplemented adapters | Symmetry with FileStorage; tests env-selection path from day 1 | ✓ |
| Defer ImageTransform entirely to Phase 28 | Smaller Phase 24 surface | |

**User's choice:** Same as FileStorage.

### Biome GritQL ban location

| Option | Description | Selected |
|--------|-------------|----------|
| biome.json plugins config + .biome/grit/ban-files-table-access.grit | Phase 24 owns success criterion #5 | ✓ |
| Defer to Phase 26 when files-module lands | Loosens Phase 24 scope; contradicts criterion #5 | |

**User's choice:** biome.json plugins config + .biome/grit/ban-files-table-access.grit.

### `files` in moduleImportMap?

| Option | Description | Selected |
|--------|-------------|----------|
| Wait for Phase 26 | @baseworks/module-files doesn't exist until Phase 26 | ✓ |
| Add a stub module-files package now | Lets Phase 26 start without bootstrapping; ships dead code | |

**User's choice:** Wait for Phase 26.

---

## Claude's Discretion

- Exact Zod schema refinements (array-non-empty, byte-size positive-integer) for `FileRelation`.
- Index choices on `files` and `tenant_storage_usage` beyond `(tenant_id)` and `(tenant_id, owner_module, owner_record_id)`.
- Crash message phrasing in `validateStorageEnv` (must include missing var name + offending provider).
- Test layout: `packages/storage/__tests__/` vs `packages/storage/src/__tests__/`.

## Deferred Ideas

- Per-tenant quota plans via better-auth org metadata (research §8 open question).
- Bucket-per-tenant vs prefix-per-tenant — locked to prefix-per-tenant for v1.4.
- `files.kind` discriminator validation (registry-validated implied by D-08; rejection-of-unknown-pairs is Phase 26).
- POST policy default vs PUT default — locked to PUT default; POST opt-in via Phase 25 spike S-2.
- Virus-scanning hook port shape — deferred entirely per PROJECT.md.
- Test infrastructure scope (MinIO-in-CI, sharp fixtures, conformance suite) — Phase 25 deliverable.
