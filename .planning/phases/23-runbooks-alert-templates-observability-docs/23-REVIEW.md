---
phase: 23-runbooks-alert-templates-observability-docs
reviewed: 2026-04-28T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - scripts/validate-docs.ts
  - scripts/__tests__/_slugs.ts
  - scripts/__tests__/alert-files-present.test.ts
  - scripts/__tests__/observability-docs-present.test.ts
  - scripts/__tests__/runbook-files-present.test.ts
  - scripts/__tests__/runbook-no-screenshots.test.ts
  - scripts/__tests__/runbook-section-shape.test.ts
  - scripts/__tests__/validate-docs.test.ts
  - .github/workflows/validate.yml
  - package.json
findings:
  critical: 0
  warning: 4
  info: 6
  total: 10
status: issues_found
---

# Phase 23: Code Review Report

**Reviewed:** 2026-04-28
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Phase 23 added a `scripts/validate-docs.ts` validator (with two exported pure
helpers), seven Bun-test files under `scripts/__tests__/`, a CI workflow at
`.github/workflows/validate.yml`, and a single `validate` script entry in
`package.json`. The surface is small, well-documented, and the helpers are
correctly factored for unit testing (no subprocess required for the 4th-invariant
helpers). Code style is consistent and matches the project's Bun/TS conventions.

No Critical issues were found. No security vulnerabilities are present — all
file reads are scoped to the repo (no user-controlled paths reach `readFile` /
`existsSync`), no `eval` / `exec` / shell calls exist, and no secrets are
committed (the validator itself scans for secret-shaped strings).

The Warnings cluster around three real correctness/robustness concerns:
the line-scan link regex can match across `]` characters in malformed link
text and the fenced-code-block false-negative is intentional but undertested;
the CI workflow lacks a `permissions:` block (best-practice hardening); and
test scripts run only inside `bun test apps/api …` etc., so the new
`scripts/__tests__/` directory is **not** wired into `bun run test`. Info items
flag minor consistency / maintainability issues.

## Warnings

### WR-01: `scripts/__tests__/` is not run by `bun run test`

**File:** `package.json:16`
**Issue:** The `test` script is hard-scoped to `apps/api packages/config packages/db packages/modules packages/queue` and the `packages/ui` Vitest run. The new `scripts/__tests__/*.test.ts` directory created in this phase (8 test files) is **not** included. CI runs `bun run validate` (the script invocation), but the unit tests for `checkCrossRunbookLinks` / `checkRunbookUrl` and the doc-shape RED tests will never execute on `bun run test`, so test failures in this directory will not gate merges via the existing test command. The CI `validate.yml` workflow also does not invoke `bun test scripts/__tests__/`.
**Fix:** Add `scripts` to the `test` script glob, or add a dedicated `bun test scripts/__tests__/` invocation to either the script or the CI workflow:
```json
"test": "bun test apps/api packages/config packages/db packages/modules packages/queue scripts/__tests__ && cd packages/ui && bun run test"
```
And/or add a step to `.github/workflows/validate.yml`:
```yaml
- name: Run validate-docs unit tests
  run: bun test scripts/__tests__
```

### WR-02: Link regex character class admits unexpected characters in link targets

**File:** `scripts/validate-docs.ts:47`
**Issue:** `linkRegex = /\]\((\.\.?\/[\w/.-]+\.md)(?:#[\w-]+)?\)/g` uses `[\w/.-]+` for the path body. This is generally fine, but: (a) it does not allow spaces or URL-encoded sequences (`%20`) so legal-but-ugly link targets are silently skipped — false negative rather than false positive, but worth noting; (b) the `\w` shorthand admits `_`, which is fine, but excludes Unicode letters that could appear in non-English filenames. More importantly: the regex anchors only on the closing `](` — it does not require the opening `[`. A line containing `foo](./bar.md)` outside any markdown link syntax would still be scanned. This is benign for current docs but is a latent fragility.
**Fix:** Tighten the regex to require the opening `[`, and document the deliberate scope:
```typescript
const linkRegex = /\[[^\]]*\]\((\.\.?\/[\w%/.\- ]+\.md)(?:#[\w-]+)?\)/g;
```
Or, accept the current form and add a code comment explicitly noting the missing `[` anchor is intentional.

### WR-03: CI workflow lacks `permissions:` block

**File:** `.github/workflows/validate.yml:1-26`
**Issue:** The workflow has no top-level or job-level `permissions:` declaration. By default GitHub grants the workflow's `GITHUB_TOKEN` write access to the repo (or read, depending on org default). For a read-only validator job that only checks out code and runs a script, granting the token write scopes is unnecessary and violates least-privilege. This is not exploitable in the current form (no third-party action with a known compromise is in use) but is a CI hardening best practice and is the kind of finding the project's `gsd-security-auditor` would flag.
**Fix:** Add an explicit minimal permissions block at the workflow or job level:
```yaml
permissions:
  contents: read
```
Place it after `on:` and before `jobs:` (or under `jobs.validate-docs:`).

### WR-04: `bun-version: latest` floats in CI — non-reproducible builds

**File:** `.github/workflows/validate.yml:20`
**Issue:** `bun-version: latest` resolves to whatever Bun version the action publishes when the workflow runs. A future Bun release that changes `Bun.Glob` semantics, `import.meta.main` behavior, or the JSON parser error message format could turn a green PR red without any code change. The validator script and tests both depend on Bun-specific APIs (`Bun.Glob`, `Bun.spawn`, `import.meta.main`).
**Fix:** Pin to a specific Bun major+minor version matching the constraint declared in `CLAUDE.md` (`^1.1+`):
```yaml
with:
  bun-version: "1.1.x"
```
Or use the version recorded in `bun.lock` / a project `.bun-version` file if one exists. At minimum prefer `1.1.x` over `latest` to bound the blast radius.

## Info

### IN-01: Mermaid floor magic number duplicated in code and message

**File:** `scripts/validate-docs.ts:185-189`
**Issue:** The constant `11` is hardcoded in the `if (mermaidTotal < 11)` check and again in the error message string. A future bump of the floor (e.g., when Phase 24 adds another diagram) requires editing two places, and the long parenthetical "(4 in docs/architecture.md + 1 per integration doc + 2 in docs/observability/trace-propagation.md + 1 in docs/observability/README.md, with 1 buffer)" is documentation that will drift.
**Fix:** Extract to a named const at the top of the file and interpolate:
```typescript
const MERMAID_FLOOR = 11;
// …
if (mermaidTotal < MERMAID_FLOOR) {
  console.error(
    `[validate-docs] FAIL: found ${mermaidTotal} Mermaid fenced blocks across docs/; floor is ${MERMAID_FLOOR}.`,
  );
}
```

### IN-02: Test 5 — RED-state assertion uses misleading equality message

**File:** `scripts/__tests__/runbook-section-shape.test.ts:29-30`
**Issue:** `expect(`docs/runbooks/${slug}.md`).toBe("authored")` is a clever way to emit a "<path> did not equal authored" message, but Bun's failure output format is `expected "authored" to equal "docs/runbooks/foo.md"`, which reads backwards relative to the comment's claim. A reader who has not read this file's docstring will be confused.
**Fix:** Use an explicit failure helper or a clearer message:
```typescript
if (!existsSync(path)) {
  expect.fail(`runbook not yet authored: docs/runbooks/${slug}.md`);
}
```
(`expect.fail` is available in `bun:test`.) Alternatively keep current pattern but add a comment with the actual error message format so future maintainers don't get confused.

### IN-03: Heading regex disallows hyphens / other punctuation in section names

**File:** `scripts/__tests__/runbook-section-shape.test.ts:35`
**Issue:** `/^##\s+([A-Za-z][A-Za-z0-9 ]*)\s*$/` rejects level-2 headings like `## Post-Mortem`, `## Q&A`, `## Step 1: Triage`. Currently the 5 canonical sections are simple words so this is fine, but a future runbook author who adds a `## Step-by-step Triage` subsection-marker-as-h2 will silently see it dropped from `headingsInOrder` (which is the correct intent — only canonical sections are checked — but the filtering happens via `.filter((h): h is RequiredSection => REQUIRED_SECTIONS.includes(h))` after collection, so the regex restrictiveness is redundant and actively hides extra headings from any future "log all H2s for diagnostics" mode).
**Fix:** Loosen the heading regex to capture the heading text generically and let the filter do the canonical-section gating:
```typescript
const m = line.match(/^##\s+(.+?)\s*$/);
```

### IN-04: `bun install --frozen-lockfile` requires `bun.lockb` in CI

**File:** `.github/workflows/validate.yml:23`
**Issue:** `--frozen-lockfile` will fail the CI run if `bun.lockb` is not committed or out of sync with `package.json`. The repo currently shows a tracked lockfile pattern (`bun install` is listed in the project), so this should work — but if a future PR modifies `package.json` without regenerating the lockfile, CI will fail with a confusing error rather than auto-resolving. This is the correct production policy; just flagging that contributors will need a clean `bun install` + `bun.lockb` commit. No fix required, but worth a CONTRIBUTING.md note.
**Fix:** No code change needed. Optionally document in a contribution guide that lockfile changes must be committed alongside `package.json` changes.

### IN-05: Validator does not surface which docs file pushed Mermaid total over the floor

**File:** `scripts/validate-docs.ts:159-161, 185-194`
**Issue:** When `mermaidTotal` is below 11 the failure message tells the operator the *expected* breakdown but not the *actual* per-file counts. Diagnosing "we lost 3 fences somewhere" requires re-running with manual instrumentation. This is a quality-of-life issue, not a bug.
**Fix:** Track per-file counts and emit them on failure:
```typescript
const fenceCounts: Record<string, number> = {};
// inside the loop:
if (fences) {
  fenceCounts[relPath] = fences.length;
  mermaidTotal += fences.length;
}
// on failure:
console.error(`[validate-docs] FAIL: per-file fences:`, fenceCounts);
```

### IN-06: Two test files duplicate the `^```mermaid$` regex

**File:** `scripts/__tests__/observability-docs-present.test.ts:38`, `scripts/validate-docs.ts:42`
**Issue:** The Mermaid fence regex `/^```mermaid$/gm` is defined in both files. Not a bug — the regex is trivial — but if the Mermaid spec ever needs a tweak (e.g., to allow a trailing language-args suffix `^```mermaid\b`), both copies must be updated in lockstep.
**Fix:** Optionally export `mermaidFence` from `scripts/validate-docs.ts` and reuse it in the test. Low priority; the duplication cost is small.

---

_Reviewed: 2026-04-28_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
