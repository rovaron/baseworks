---
phase: 23-runbooks-alert-templates-observability-docs
fixed_at: 2026-05-05T00:00:00Z
review_path: .planning/phases/23-runbooks-alert-templates-observability-docs/23-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 23: Code Review Fix Report

**Fixed at:** 2026-05-05
**Source review:** `.planning/phases/23-runbooks-alert-templates-observability-docs/23-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (all warnings; no critical findings; 6 info findings deferred per `fix_scope: critical_warning`)
- Fixed: 4
- Skipped: 0

All four Warning findings were applied cleanly. Validator (`bun run validate`)
passes and the full `scripts/__tests__/` suite reports 55/55 tests passing
after the fixes. No findings required rollback. Info findings (IN-01..IN-06)
are out of scope for this iteration.

## Fixed Issues

### WR-01: `scripts/__tests__/` is not run by `bun run test`

**Files modified:** `package.json`
**Commit:** `0b27edb`
**Applied fix:** Added `scripts/__tests__` to the `test` script's `bun test`
glob so the eight new test files (55 tests total) are now wired into
`bun run test`. Final glob:
`bun test apps/api packages/config packages/db packages/modules packages/queue scripts/__tests__`.
Verified by running `bun test scripts/__tests__` standalone — all 55 tests
pass after the change.

> **Note on commit message:** The `gsd-sdk query commit` helper concatenated
> the filename argument into the message body, producing
> `"fix(23): WR-01 wire scripts/__tests__ into bun run test package.json"`.
> The trailing ` package.json` is helper-induced noise, not part of the
> intended message. Subsequent commits (WR-02..WR-04) used `git commit -m`
> directly to avoid this. The diff and fix itself are correct.

### WR-02: Link regex character class admits unexpected characters

**Files modified:** `scripts/validate-docs.ts`
**Commit:** `72bfb97`
**Applied fix:** Tightened `linkRegex` from
`/\]\((\.\.?\/[\w/.-]+\.md)(?:#[\w-]+)?\)/g` to
`/\[[^\]]*\]\((\.\.?\/[\w%/.\- ]+\.md)(?:#[\w-]+)?\)/g`. The leading
`\[[^\]]*\]` anchor now requires the opening `[` of the markdown link
syntax, preventing false positives on stray `](./foo.md)` substrings outside
link context. The path body permits `%` (URL-encoded segments) and spaces
in addition to `\w/.-` so legal-but-ugly link targets are not silently
skipped. Added a code comment documenting the rationale. All existing
fixtures (`good.md`, `example.md`) still parse correctly; tests 1-9 in
`validate-docs.test.ts` all pass.

### WR-03: CI workflow lacks `permissions:` block

**Files modified:** `.github/workflows/validate.yml`
**Commit:** `59f0f2f`
**Applied fix:** Added a top-level `permissions:` block with
`contents: read` between `on:` and `jobs:`. This implements least-privilege
for the validator's `GITHUB_TOKEN` — the workflow only reads code and runs
a script, so write scopes are unnecessary. Includes a comment documenting
intent.

### WR-04: `bun-version: latest` floats in CI

**Files modified:** `.github/workflows/validate.yml`
**Commit:** `db216e8`
**Applied fix:** Replaced `bun-version: latest` with `bun-version: "1.1.x"`,
matching the `^1.1+` constraint declared in `CLAUDE.md`. Quoted to keep
YAML from interpreting `1.1.x` as a number-like token. Includes a comment
documenting why pinning matters (Bun.Glob / import.meta.main / JSON.parse
error message format are all load-bearing for the validator and tests).

---

_Fixed: 2026-05-05_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
