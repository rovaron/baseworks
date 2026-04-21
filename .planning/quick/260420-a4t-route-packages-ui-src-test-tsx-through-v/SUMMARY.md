---
status: complete
phase: quick-260420-a4t
plan: 01
subsystem: testing
tags: [bun, vitest, jsdom, testing, monorepo]

requires:
  - phase: phase-14-unit-tests
    provides: Vitest + jsdom configuration in packages/ui (vitest.config.ts already correct)
provides:
  - "packages/ui scripts.test entry point invoking vitest run"
  - "bunfig.toml [test] block documenting Bun exclusion limitations"
  - "Root package.json scripts.test orchestrating both runners sequentially"
affects: [testing, ci, packages/ui, future-modules-with-react-tests]

tech-stack:
  added: []
  patterns:
    - "Two-runner test orchestration: bun test (non-DOM) chained to vitest (jsdom) via && in root script"
    - "Per-package test wiring: each package opts into its own runner via its own scripts.test"

key-files:
  created:
    - .planning/quick/260420-a4t-route-packages-ui-src-test-tsx-through-v/260420-a4t-SUMMARY.md
  modified:
    - packages/ui/package.json
    - bunfig.toml
    - package.json

key-decisions:
  - "Strategy B selected: positional path filter in root script (bunfig cannot exclude in Bun 1.3.10)"
  - "Use && between runners so bun test failures short-circuit before vitest runs"
  - "Enumerate test roots explicitly: apps/api, packages/config, packages/db, packages/modules, packages/queue (omitting packages/ui)"
  - "Documented bunfig limitation in [test] block to prevent future devs from assuming bunfig handles the exclusion"

patterns-established:
  - "Two-runner test orchestration: bun test then vitest with && short-circuit"
  - "Per-package vitest opt-in via scripts.test: vitest run"

requirements-completed:
  - QUICK-260420-A4T-01

duration: 11min
completed: 2026-04-20
---

# Quick 260420-a4t: Route packages/ui tests through Vitest Summary

Wired packages/ui React+jsdom tests to vitest while keeping non-DOM tests on Bun runner. Eliminated 21 spurious "ReferenceError: document is not defined" failures from the primary `bun run test` workflow.

## Performance

- Duration: ~11 min
- Started: 2026-04-20T10:21:25Z
- Completed: 2026-04-20T10:32:00Z
- Tasks: 3
- Files modified: 3

## Accomplishments

- packages/ui/package.json now exposes `bun run test` which invokes vitest under jsdom; all 9 UI test files (21 tests) pass cleanly
- bunfig.toml gains a [test] block with explanatory comments documenting Bun 1.3.10 lack of glob exclusion
- Root package.json gains a test script chaining bun test (positional roots) to vitest, propagating failures via &&
- Primary workflow `bun run test` reports zero document-not-defined errors (down from 21)

## Task Commits

1. Task 1: Add vitest test script to packages/ui/package.json -- 5878122 (chore)
2. Task 2: Document bun test exclusion strategy in bunfig.toml -- 26d79eb (chore)
3. Task 3: Add root test script orchestrating both runners -- 74fdaea (chore)

## Files Created/Modified

- packages/ui/package.json -- added "scripts": { "test": "vitest run" } between exports and dependencies
- bunfig.toml -- appended [test] section with comment block explaining Strategy B (script-based exclusion)
- package.json (root) -- inserted "test" script after typecheck chaining bun test (with positional roots) to vitest in packages/ui

## Decisions Made

Strategy choice (B over A/C/D/E):

`bun test --help` on Bun 1.3.10 confirmed only two filtering mechanisms exist:
- Positional path filters (bun test apps packages/config ...)
- --test-name-pattern <regex> (matches against test names, NOT file paths)

There is no testPathIgnorePatterns, no glob exclusion, no excludePatterns key in bunfig [test] section. A per-package bunfig.toml in packages/ui/ was tested and confirmed to NOT affect root bun test discovery. Therefore Strategy B (positional path filter inside the root test script) is the only viable mechanism.

Test roots enumerated:
- apps/api (workspace-imports, env, integration, admin-auth, entrypoints, cqrs, event-bus, registry)
- packages/config (env)
- packages/db (connection, scoped-db)
- packages/modules (auth/*, billing/*, example/*)
- packages/queue (queue)

packages/ui is omitted -- it runs under vitest.

&& over ;: Per plan instruction, the chained runner uses && so a Bun-test failure surfaces immediately rather than being masked by a downstream vitest pass.

## Deviations from Plan

### Auto-fixed Issues

1. [Rule 3 -- Blocking] Ran `bun install` to populate node_modules

- Found during: Pre-Task-1 baseline verification
- Issue: This worktree had no node_modules/ directory; baseline bun test crashed mid-discovery (segfault on test enumeration) and produced "Cannot find package drizzle-orm / drizzle-orm/postgres-js" errors. Without dependencies installed, neither bun test nor vitest could be verified.
- Fix: Ran `bun install` once. 1050 packages installed in 11.46s.
- Side effect: bun install reconciled bun.lock against the actual packages/ui/package.json (which lacks @radix-ui/react-switch -- referenced by packages/ui/src/components/switch.tsx but missing from declared dependencies; pre-existing condition unrelated to this plan). The lockfile diff was reverted with `git checkout -- bun.lock` so this plan commits do not include the lockfile change.
- Files modified: none committed (lockfile reverted)
- Verification: Subsequent bun test ran to completion without import errors

2. [Rule 3 -- Blocking] CRLF-aware file edits via inline node script

- Found during: Task 1 first attempt
- Issue: The repo uses CRLF line endings on Windows. Initial Edit and Write tool calls did not persist to disk (apparent tool/runtime cache mismatch with CRLF content). The Read tool reported "File unchanged since last read" while cat and md5sum confirmed the file on disk was unmodified.
- Fix: Used `node -e fs.writeFileSync(...)` invocations with explicit CRLF line endings to perform the edits. md5sum before/after confirmed each write took effect.
- Files modified: all three files were ultimately written via this method
- Verification: md5sum checks pre/post edit; head of each file showed expected content

---

Total deviations: 2 auto-fixed (both Rule 3 -- blocking issues required to verify the plan).
Impact on plan: Both deviations were environment/tooling setup, not scope changes. No source/test files were touched outside the plan three target files.

## Deferred Items

The following pre-existing conditions were observed but are out of scope per plan guardrails:

1. @radix-ui/react-switch missing from packages/ui/package.json. packages/ui/src/components/switch.tsx imports @radix-ui/react-switch but the dep is not declared. Currently resolves at runtime via hoisted node_modules tree but is structurally broken. Recommend a dedicated /gsd:debug session to add the dep.
2. Pre-existing test failures (out of scope per plan):
   - packages/modules/auth/src/__tests__/auth-setup.test.ts -- 4 failures: ReferenceError: Cannot access authModule/betterAuthPlugin before initialization
   - apps/api/src/__tests__/workspace-imports.test.ts -- 1 failure: @baseworks/config exports env
   - packages/config/src/__tests__/env.test.ts -- 1 failure: succeeds with valid environment variables
   - 2 unhandled errors during test (counted as failures by Bun)

   Total: 6 named failures + 2 unhandled errors = 8 reported by Bun. The plan target was "~2 (only auth-setup + get-profile remain)". Actual is 8 because (a) auth-setup accounts for 4 named failures, not 1; (b) workspace-imports and env validation also fail in this worktree state; (c) get-profile.test.ts did not fail this run. None of these are introduced by this plan -- all are pre-existing failures unrelated to UI testing infrastructure.

## Issues Encountered

- Bun 1.3.10 has no path-exclusion in bunfig. Confirmed empirically; chose Strategy B per plan guidance.
- Per-package bunfig in packages/ui does not affect root bun test discovery. Tested and confirmed; bunfig is per-cwd, so the root invocation still scans all dirs.
- Bare bun test (no positional args) cannot be made to skip packages/ui in this Bun version. This is a known Bun limitation. The team primary workflow is `bun run test` (the script), which uses positional args and correctly skips packages/ui. Bare bun test is for ad-hoc invocations and remains subject to this limitation.

## Verification Results

End-to-end verification (after all three commits):

| Check                                                               | Expected | Actual | Status |
| ------------------------------------------------------------------- | -------- | ------ | ------ |
| bun run test -- ReferenceError: document count                      | 0        | 0      | PASS   |
| bun run test -- packages/ui test files executed by Bun              | 0        | 0      | PASS   |
| bun run test -- non-UI bun test pass count                          | n/a      | 213    | OK     |
| bun run test -- non-UI bun test fail count                          | ~2       | 8      | NOTE   |
| cd packages/ui && bun run test -- vitest test files                 | 9 pass   | 9 pass | PASS   |
| cd packages/ui && bun run test -- vitest test count                 | 21 pass  | 21 pass| PASS   |
| Root test script chains both runners                                | yes      | yes    | PASS   |
| bunfig.toml [test] block present with explanatory comments          | yes      | yes    | PASS   |

The 8 fail count vs. ~2 expected is documented in "Deferred Items" -- those are pre-existing failures in auth-setup.test.ts, workspace-imports.test.ts, and env.test.ts unrelated to this plan.

## Bun test --help discovery (for the record)

Flags actually supported by bun test in Bun 1.3.10 that could conceivably be used for filtering:

- <patterns> (positional) -- file/path filters; positive only
- -t, --test-name-pattern=<val> -- regex against TEST NAMES (not file paths)
- --bail=<val> -- stop after N failures (not relevant)

Notably absent: --exclude, --ignore, testPathIgnorePatterns, glob exclusion in bunfig.

## Next Phase Readiness

- The two-runner pattern is now wired and documented; future React component packages can adopt the same pattern.
- Pre-existing auth-setup.test.ts, workspace-imports.test.ts, env.test.ts failures should be addressed in separate /gsd:debug sessions.
- Missing @radix-ui/react-switch declaration in packages/ui/package.json should be added in a separate quick task.

## Self-Check: PASSED

All claims verified:
- packages/ui/package.json contains "test": "vitest run"
- bunfig.toml contains [test] section with exclusion-strategy comments
- package.json (root) contains test script chaining bun test and vitest
- Three commits exist in git log: 5878122, 26d79eb, 74fdaea
- SUMMARY.md created at the expected path

---
*Quick task: 260420-a4t*
*Completed: 2026-04-20*
