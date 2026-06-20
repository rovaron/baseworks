# Phase 24 — Deferred Items

Out-of-scope discoveries logged during execution. NOT fixed; tracked for future cleanup.

## Pre-existing: nested biome.json in `.claude/worktrees/` breaks `bun run lint`

**Discovered during:** Plan 24-07 execution.

**Symptom:** `bun run lint` exits non-zero with `Found a nested root configuration` errors for every `.claude/worktrees/agent-*/biome.json` file. Biome 2.4.x rejects nested root configs.

**Verified pre-existing:** Reverting `biome.json` and `package.json` to `HEAD~2` (before Plan 24-07 commits) reproduces the same failure. Plan 24-07 did not introduce this.

**Cause:** `.claude/worktrees/` contains untracked stale worktree directories (the path is gitignored). Each worktree carries its own copy of `biome.json`. Biome scans them and fails on the duplicate-root rule.

**Out of scope for Plan 24-07:** This plan's scope is the no-direct-files-table-access ban; the nested-config error existed before this plan started and is unrelated to its files (.biome/plugins/, scripts/, package.json scripts entry).

**Suggested resolution (future task):**
- Delete the stale `.claude/worktrees/` directories (they are leftovers from prior parallel-agent runs and not needed in main).
- OR add a `files.experimentalScannerIgnores` entry in root biome.json excluding `.claude/worktrees/**`.
- OR migrate biome.json with `bun biome migrate --write` per Biome's hint.

**Plan 24-07 individual lint tasks pass:**
- `bun run lint:als` exits 0.
- `bun run lint:files-access` exits 0.
- The 4 files-access-ban.test.ts tests all pass.
- Smoke-test confirms the GritQL rule fires on the banned pattern.

## Pre-existing: `bun --cwd apps/api tsc --noEmit` reports 132 repo-wide errors

**Discovered during:** Plan 24-06 execution (Task 24-06-04 verification phase).

**Symptom:** `bun --cwd apps/api tsc --noEmit` exits 2 with 132 errors. The dominant class is `TS6059` ("File '…' is not under 'rootDir' 'apps/api/src'") emitted for EVERY workspace import: `@baseworks/db`, `@baseworks/config`, `@baseworks/queue`, `@baseworks/observability`, `@baseworks/i18n`, `@baseworks/module-auth/billing/example`, AND `@baseworks/storage`. Additional unrelated errors: Elysia generic-type drift (`TS2345`/`TS2322` in middleware/route test files) and `TS2307` "Cannot find module 'ioredis' / 'bullmq'".

**Verified pre-existing:** The `@baseworks/storage` import (added by already-committed Tasks 24-06-01/02) contributes exactly ONE `TS6059` line of the same systemic class — the other 131 errors involve packages this plan never touched. The root cause is `apps/api/tsconfig.json` setting `rootDir: ./src` while the root tsconfig sets `declaration: true`; cross-package `paths` imports pull sibling `src/*.ts` into the program, which the rootDir rule rejects. This affects all workspace packages equally and predates Plan 24-06. The monorepo relies on Bun's native runtime resolution and per-package `bun test`, not project-wide `tsc`, so this never surfaced as a build gate.

**Out of scope for Plan 24-06:** Task 24-06-04 is a DB migration; it changed no source. The wire-up tasks added one storage import that is swept up in the pre-existing rootDir problem. Fixing it is a repo-wide tsconfig restructure (project references or dropping `rootDir`/`declaration`) — architectural scope, not this plan's.

**Plan 24-06 functional verification passes independently of tsc:**
- `bun test packages/storage` → 90 pass / 0 fail.
- Migration `0002_v14_file_storage` applied; `files` (17 cols) + `tenant_storage_usage` (5 cols) exist with `files_status_check` CHECK and `files_pending_status_idx` partial index (WHERE deleted_at IS NULL).
- `validateStorageEnv()` smoke: default env passes; `STORAGE_PROVIDER=s3` without creds crashes naming `AWS_ACCESS_KEY_ID`.
- `bun run db:migrate` is idempotent (second run exits 0).

**Suggested resolution (future task):** Adopt TypeScript project references across the monorepo, OR drop `rootDir`/`declaration` from the app tsconfigs and rely on per-package builds, and add `ioredis`/`bullmq` to the relevant package `dependencies` so `TS2307` clears.

## Pre-existing: 9 `bun test apps/api` failures (mock-pollution + audit-era export drift)

**Discovered during:** Plan 24-06 execution (Task 24-06-04 verification phase).

**Symptom:** `bun test apps/api` → 176 pass / 9 fail. Failing tests: bull-board `uiBasePath` Pitfall workaround, Worker-entrypoint 5s timeout, `@baseworks/config exports env` workspace-import check, `ModuleRegistry loadAll collects def.health`, and two `tenant-als-publish` tests failing with `SyntaxError: Export named 'auth' not found in module '@baseworks/module-auth'`.

**Verified pre-existing / unrelated to this plan:**
- `ModuleRegistry loadAll collects def.health` passes 4/0 **in isolation** (`bun test …/registry-health.test.ts`); it only fails in the full suite due to bun:test `mock.module` ordering pollution — the documented v1.2 mock-isolation behavior. Its fixture has only `name` + `health` (no `fileRelations`), so the Task 24-06-02 `if (def.fileRelations)` block is never entered for it.
- The `tenant-als-publish` / config-export / bull-board / worker failures are audit-era (`auth` export drift, ioredis missing) issues touching files this plan never modified.

**Out of scope for Plan 24-06:** None of the 9 failures involve the migration, the storage package, or the `fileRelations` collection block. The registry change is exercised by the passing storage suite and the isolation run.
