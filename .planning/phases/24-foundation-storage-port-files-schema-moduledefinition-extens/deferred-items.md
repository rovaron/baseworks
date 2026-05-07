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
