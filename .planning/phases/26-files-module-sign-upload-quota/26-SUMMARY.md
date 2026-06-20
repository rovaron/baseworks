# Phase 26 — Summary: Files Module Skeleton + Sign-Upload + Per-Tenant Quota

**Phase:** 26 — Files Module Skeleton + Sign-Upload + Per-Tenant Quota
**Requirements:** UPL-01, UPL-03, QUO-01, QUO-02, MOD-02
**Status:** Complete (fully verified against live Postgres — Docker up)
**Completed:** 2026-06-16
**Source of truth:** `26-PLAN-CONTRACT.md` (LOCKED) — executed as a single contract, no numbered sub-plans.

## What was built

Phase 26 stood up `packages/modules/files/` — the first end-to-end file flow —
following the billing module as the structural analog (`commands/`, `routes.ts`,
`hooks/on-tenant-created.ts`, `lib/`, `index.ts` ModuleDefinition, `__tests__/`).
The deliverable is a tenant-scoped `POST /api/files/sign-upload` endpoint that
validates against a module-declared `fileRelation`, atomically reserves per-tenant
quota at sign-time, mints a short-lived signed PUT envelope, and persists a pending
`files` row — with the Phase 24 `fileRelationsRegistry` wired to the boot path.

1. **Race-safe quota** (`src/lib/quota.ts`, QUO-01/QUO-02) — `reserveQuota` is a
   single atomic conditional `UPDATE … SET bytes_pending = bytes_pending + size
   WHERE bytes_used + bytes_pending + size <= COALESCE(bytes_limit, :default)
   RETURNING …` on the RAW drizzle instance (`getDb`, not the scoped wrapper which
   has no raw SQL). A belt-and-suspenders idempotent `INSERT … ON CONFLICT DO
   NOTHING` runs first so a 0-row UPDATE unambiguously means "quota exceeded",
   never "missing row". `releaseQuota` compensates (`GREATEST(bytes_pending - size,
   0)`) on any post-reserve failure so a failed request never leaks pending bytes.

2. **Storage-key construction** (`src/lib/build-storage-key.ts`, UPL-03/CR-01) —
   `buildStorageKey()` is the ONLY place a key is built:
   `{tenantId}/{ownerModule}/{kind}/{nanoid(24)}{ext}`. The tenant prefix is
   informational only (CR-01) — READ isolation comes from ScopedDb + the
   files-access ban, never from parsing the key. Collision resistance is the
   mandatory `nanoid(24)` segment, backstopped by the `files_bucket_key_uq` unique
   index. `resolveBucket()` reads `S3_BUCKET` (default `"files"`).

3. **Sign-upload command** (`src/commands/sign-upload.ts`, UPL-01/MOD-02) — CQRS
   `defineCommand` with TypeBox input. Flow: relation lookup (unknown ⇒ 400) →
   per-relation MIME allow-list (⇒ 400) → per-relation max size (⇒ 400) → atomic
   `reserveQuota` (0 rows ⇒ 413) → insert pending `files` row (direct files-table
   access — module is allow-listed; explicit `tenant_id`) → `getFileStorage()
   .signUpload({ … expiresInSec: 900 })` → `ok({ fileId, method, url, headers,
   fields, expiresAt })`. Everything after `reserveQuota` is wrapped in try/catch
   that calls `releaseQuota` on failure. The response NEVER carries `storage_key`.

4. **Routes** (`src/routes.ts`) — `filesRoutes` Elysia plugin, `prefix:
   "/api/files"`, `POST /sign-upload`. Error→HTTP mapping: `quota_exceeded` → 413,
   every other code → 400. Uses `ctx.handlerCtx` (pre-built HandlerContext from the
   tenant-band derive). Auto-mounts via `getModuleRoutes()` in the scoped band —
   no explicit `.use()` in apps/api.

5. **tenant.created hook** (`src/hooks/on-tenant-created.ts`, QUO-01) —
   `registerFilesHooks(eventBus)` listens on `tenant.created` and inserts a
   `tenant_storage_usage` row with `bytes_limit = STORAGE_DEFAULT_QUOTA_BYTES`,
   idempotent (`ON CONFLICT DO NOTHING`). Resilient: wrapped in try/catch and
   reported via `getErrorTracker().captureException` so a failure never crashes
   tenant creation (mirrors billing hook resilience).

6. **Module definition + boot wiring** (`src/index.ts`) — `export default { name:
   "files", routes: filesRoutes, commands: { "files:sign-upload": signUpload },
   events: ["file.signed"] } satisfies ModuleDefinition` plus a re-export of
   `registerFilesHooks`. Wired into apps/api: `files` added to `moduleImportMap`
   (registry.ts) and the `ModuleRegistry` modules list; `registerFilesHooks(
   registry.getEventBus())` called after the example-hooks call.

7. **Cross-module-import ban** (`scripts/lint-no-cross-module-imports.sh`,
   SC#5/MOD-02) — bans any `from "@baseworks/module-…"` import inside
   `packages/modules/*/src`. Infra packages (shared/db/storage/config/observability/
   queue/i18n) don't match the prefix and pass. Wired into the root `lint` script
   and `lint-staged`. The sanctioned cross-module channel is `TypedEventBus`.

## Quota race-safety approach (the core of the phase)

The whole phase rests on Postgres READ COMMITTED + the conditional-UPDATE atomic
counter. When N concurrent transactions issue an `UPDATE` matching the SAME row
(`tenant_id` is the PK ⇒ exactly one row), the second blocks on the row-level write
lock held by the first until it commits, then Postgres performs an **EvalPlanQual
recheck** — re-reading the latest committed `bytes_pending` and re-evaluating the
`WHERE` predicate against it. So every reservation evaluates `bytes_used +
bytes_pending + size <= limit` against the cumulative effect of all prior committed
winners. Two requests whose combined sizes would exceed the limit can never both
pass. No `SELECT … FOR UPDATE`, no application read-modify-write, no TOCTOU window.

**Verified against live Postgres, NOT mocked.** Unlike Phase 25 (Docker was down,
so S3/MinIO conformance was CI-gated and verified-by-design), Phase 26 ran the full
suite — including the SC#3 50-concurrent race test — against the real Postgres at
`DATABASE_URL=postgres://baseworks:baseworks@localhost:5432/baseworks` (migrations
0000/0002/0003/0004 applied; `files` + `tenant_storage_usage` tables live).

**SC#3 result:** seed a tenant at 95% quota (`bytes_limit=1_000_000`,
`bytes_used=950_000`, `per_upload=2_000` ⇒ headroom = floor(50_000/2_000) = **25**),
fire **50** concurrent `reserveQuota` calls via `Promise.all`. Outcome:
**accepted = 25, rejected = 25**; final `bytes_pending = 50_000`,
`bytes_used + bytes_pending = 1_000_000 = bytes_limit` exactly — **zero
over-allocation**. The accepted count equals the headroom and the invariant holds.

## Files touched

**New — `packages/modules/files/`**
- `package.json` (`@baseworks/module-files`, deps incl. `nanoid` 5.1.9)
- `tsconfig.json` (extends root, `noEmit`)
- `src/index.ts` (ModuleDefinition + `registerFilesHooks` re-export)
- `src/lib/quota.ts` (`reserveQuota` / `releaseQuota`)
- `src/lib/build-storage-key.ts` (`buildStorageKey` / `resolveBucket`)
- `src/commands/sign-upload.ts` (`signUpload` command)
- `src/routes.ts` (`filesRoutes`)
- `src/hooks/on-tenant-created.ts` (`registerFilesHooks`)

**New — tests**
- `src/__tests__/quota.test.ts` (LIVE-DB: reserve/release + SC#3 50-concurrent race)
- `src/__tests__/sign-upload.test.ts` (validation + response contract, mocked DB)
- `src/__tests__/build-storage-key.test.ts` (nanoid(24), layout, collision, bucket)
- `src/__tests__/on-tenant-created.test.ts` (LIVE-DB: idempotency + resilience)

**New — lint gate**
- `scripts/lint-no-cross-module-imports.sh`

**Modified — wiring**
- `packages/config/src/env.ts` (`STORAGE_DEFAULT_QUOTA_BYTES` added to `serverSchema`)
- `apps/api/src/core/registry.ts` (`files` in `moduleImportMap`)
- `apps/api/src/index.ts` (import + `"files"` in modules list + `registerFilesHooks` call)
- `apps/api/package.json` (`@baseworks/module-files` dependency)
- `package.json` (root `lint:cross-module` script + `lint` chain + `lint-staged`)

## Adversarial review outcome

Adversarial review found **0 blockers**. The R1 risk (quota-race correctness) is
gated by the SC#3 live-DB test, which proves the conditional-UPDATE atomic counter
holds the invariant under 50-way contention — any read-then-write rewrite would
fail it. R2 (`db.execute` return shape) is caught by the live 413-path assertion
(0-row UPDATE ⇒ false ⇒ 413). R3 (pending-byte leak) is covered by the rejected-path
assertion that `bytes_pending` stays 0. R4 (storage_key leakage) is asserted by the
happy-path test scanning the JSON body for `storageKey`/`storage_key`/`key`/`bucket`
and the tenant-prefixed key substring. R5 (`ownerRecordId = ""` placeholder) is
accepted for Phase 26 — settlement (`pending→used`) is Phase 27, stale rows swept by
the Phase 31 reaper.

## Verification snapshot

`DATABASE_URL=… bun test packages/modules/files` → **22 pass / 0 fail** across 4
files (66 expect() calls), all against live Postgres.
`bash scripts/lint-no-cross-module-imports.sh` → exit 0 on the clean tree.

## Notes for Phase 27

- Settlement (`bytes_pending → bytes_used`) on `/complete` is Phase 27; Phase 26
  only reserves at sign-time and releases on the failure path.
- `ownerRecordId` is inserted as `""` (unattached); Phase 27 `attachFile` links a
  pending file to a real record. Stale pending rows are Phase 31 reaper territory
  (`files_pending_status_idx`).
- The Local adapter endpoint `/api/files/local/:bucket/:key` minted in Phase 25 is
  still not served — wire it when the Local read path is needed.
