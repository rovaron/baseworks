---
phase: 15-developer-documentation
plan: 06
subsystem: testing
tags: [documentation, bun-script, validation, phase-close-gate, mermaid, secret-scan]

requires:
  - phase: 15-developer-documentation
    provides: "docs/architecture.md (4 Mermaid diagrams), docs/integrations/*.md (1 sequenceDiagram each), Plan 15-05 Task 5 spec"
provides:
  - "scripts/validate-docs.ts Bun runtime validator enforcing three docs invariants (forbidden-import, secret-shape, Mermaid floor)"
  - "Mechanical enforcement of D-01 Mermaid diagram floor (>= 8 fences across docs/)"
  - "Mechanical enforcement that `@baseworks/test-utils` (nonexistent workspace package) never leaks into docs"
  - "Mechanical enforcement that real-shaped provider secrets never leak into docs"
affects: [future docs edits, Phase 15 verification gate, future CI wiring]

tech-stack:
  added: []
  patterns:
    - "Read-only static validators live under scripts/ and run via `bun run scripts/<name>.ts` (no npm dependency)"
    - "On Windows, derive a file-system-safe ROOT via `fileURLToPath(new URL('..', import.meta.url))` -- the raw `.pathname` form yields `/C:/...` which Bun.Glob cannot open as cwd"
    - "Cross-platform path reassembly uses `node:path.join(ROOT, relPath)` -- glob output separators differ by platform"

key-files:
  created:
    - "scripts/validate-docs.ts -- 82-line Bun validator, three invariants, exits 0 on pass / 1 on fail"
  modified: []

key-decisions:
  - "Apply a minimal Windows path-compat fix to the 15-05 Task 5 verbatim spec (fileURLToPath + path.join) rather than leave the script Windows-broken. Invariants, acceptance criteria, and exit contract are unchanged."
  - "Keep the script as the ONE repo location permitted to contain `@baseworks/test-utils` (documented in plan frontmatter; used as the forbidden-import regex source)."

patterns-established:
  - "Phase-close validators: idempotent, read-only, no filesystem writes, no network calls, exit 0/1 with stderr diagnostics"
  - "Windows-compat for Bun runtime scripts: always use fileURLToPath over URL.pathname when constructing directory cwds"

requirements-completed: []

# Metrics
duration: 3 min
completed: 2026-04-18
---

# Phase 15 Plan 06: Phase-close Validate-docs Script Summary

**Bun runtime validator at `scripts/validate-docs.ts` enforcing three docs invariants (no `@baseworks/test-utils`, no real-shaped provider secrets, >=8 Mermaid fences) -- closes the single unmet must-have from 15-VERIFICATION.md.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-18T02:15:53Z
- **Completed:** 2026-04-18T02:18:13Z
- **Tasks:** 1 completed
- **Files modified:** 1 created

## Accomplishments

- Created `scripts/validate-docs.ts` (82 lines) -- the phase-close developer-docs validator that Plan 15-05 Task 5 specified but did not execute.
- Script enforces three invariants from 15-VERIFICATION.md truth #27:
  1. **Forbidden-import gate:** fails if any `docs/**/*.md` file contains the literal string `@baseworks/test-utils`.
  2. **Secret-shape gate:** fails on `sk_live_*`, `sk_test_{24+}`, `re_{20+}`, or `whsec_{24+}` shapes.
  3. **Mermaid-floor gate:** fails if fewer than 8 Mermaid fenced blocks are counted across `docs/`.
- Verified `bun run scripts/validate-docs.ts` exits 0 against the current docs tree with stdout:
  - `[validate-docs] OK: found 8 Mermaid fenced blocks across docs/ (>= 8 required).`
  - `[validate-docs] PASS`
- Verified failure-mode smoke: appending `@baseworks/test-utils` to `docs/README.md` triggered exit 1 with a clear FAIL diagnostic; revert restored clean PASS.

## Task Commits

1. **Task 1: Create scripts/validate-docs.ts (gap closure for Plan 15-05 Task 5)** -- `84aa388` (docs)

**Plan metadata:** _(appended by execute-plan metadata commit)_

## Files Created/Modified

- `scripts/validate-docs.ts` -- Phase-close docs validator. Reads `docs/**/*.md` via `Bun.Glob`, applies four regex gates, accumulates a Mermaid fence count, prints diagnostics to stderr, exits 0/1. No npm dependencies; uses `Bun.Glob` (built-in since Bun 1.1), `node:fs/promises`, `node:url`, `node:path` (standard library).

## Decisions Made

- **Windows path-compat fix applied to the verbatim 15-05 Task 5 spec.** The spec used `new URL('..', import.meta.url).pathname` which on Windows produces `/C:/Projetos/baseworks/` -- a string Bun.Glob cannot open as a cwd (it appends a null byte and throws ENOENT). Swapped to `fileURLToPath(new URL('..', import.meta.url))` and rebuilt `full` via `path.join(ROOT, relPath)` so the script works identically on Windows and POSIX. No change to the three invariants enforced, the exit contract, the regex sources, or the stdout/stderr format. Deviation documented below under Rule 1.
- **Kept the script as the single repo home for the literal `@baseworks/test-utils` string** (per plan frontmatter must_haves.artifacts[0].contains). The script lives under `scripts/`, not `docs/`, so its own match-on-self is excluded by the glob pattern `docs/**/*.md`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Windows path incompatibility in the verbatim 15-05 Task 5 script**
- **Found during:** Task 1 (first `bun run scripts/validate-docs.ts` invocation after writing the file verbatim from the spec)
- **Issue:** `new URL('..', import.meta.url).pathname` on Windows yields `/C:/Projetos/baseworks/` (with a leading slash that breaks absolute-path resolution). Passing that to `docsGlob.scan({ cwd: ROOT })` caused Bun.Glob to attempt `open('/C:/Projetos/baseworks/\u0000')` and fail with ENOENT -- the scan never yielded a single file. This would have caused the Mermaid fence count to be 0, which in turn would have failed the >= 8 floor and exited 1 against a docs tree that actually satisfies the invariant. The failure is a cross-platform portability bug in the transcribed spec, not a bug in the docs tree.
- **Fix:** Added `import { fileURLToPath } from "node:url"` and `import { join } from "node:path"`, derived `ROOT` via `fileURLToPath(new URL("..", import.meta.url))` to get a native Windows path (`C:\Projetos\baseworks`), and rebuilt `full` via `join(ROOT, relPath)` to handle platform-specific separators returned by `glob.scan`. The three invariants, their thresholds, their exit contract, and their stderr format are unchanged -- only the two path-handling lines differ from the 15-05 verbatim source.
- **Files modified:** `scripts/validate-docs.ts` (the only file this plan creates)
- **Verification:**
  - Re-ran `bun run scripts/validate-docs.ts` -> exit 0 with `[validate-docs] OK: found 8 Mermaid fenced blocks across docs/ (>= 8 required).` + `[validate-docs] PASS`.
  - Failure-mode smoke: `echo '@baseworks/test-utils' >> docs/README.md` then re-ran -> exit 1 with `[validate-docs] FAIL: docs\README.md contains forbidden string "@baseworks/test-utils" (1x). ...`; reverted `docs/README.md` to restore clean PASS.
  - All acceptance criteria greps pass: `@baseworks/test-utils`, `sk_live_`, `sk_test_`, `re_`, `whsec_`, `mermaid` all present; 82 lines >= 40-line floor; `package.json` untouched.
- **Committed in:** `84aa388` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug, cross-platform portability of the transcribed spec)
**Impact on plan:** Minimal. The fix preserves every plan-level acceptance criterion, every must-have invariant, and the exit-code contract. Without the fix, the script would have exit-1'd on Windows against a clean docs tree (false positive) and failed the "exits 0 against the current tree" success criterion. The change is documented in the script's own comment block and in this summary.

## Issues Encountered

- First run of the verbatim script on Windows failed with `ENOENT: no such file or directory, open '/C:/Projetos/baseworks/\u0000'`. Diagnosed as `URL.pathname` yielding a non-native path form on Win32. Fixed via `fileURLToPath` + `path.join` (see Deviation #1 above).

## User Setup Required

None - no external service configuration required. The validator is a read-only local script invoked via `bun run scripts/validate-docs.ts`.

## Next Phase Readiness

- Phase 15 gap closed. All six must-have truths from 15-VERIFICATION.md now hold on disk. Plan count for Phase 15 reaches 6/6 (1 planner-added gap-closure plan atop the original 5-plan design).
- Optional follow-up (out of scope for this gap-closure): wire `bun run scripts/validate-docs.ts` into a pre-commit hook or CI step so future docs edits cannot regress the invariants silently. Currently enforcement is manual (invoked at phase close).
- Phase 15 ready for re-verification via `/gsd-verify-work 15`.

## Self-Check: PASSED

- FOUND: `scripts/validate-docs.ts` on disk
- FOUND: `.planning/phases/15-developer-documentation/15-06-SUMMARY.md` on disk
- FOUND: commit `84aa388` in `git log --oneline --all`
- `bun run scripts/validate-docs.ts` exits 0 with expected stdout

---
*Phase: 15-developer-documentation*
*Completed: 2026-04-18*
