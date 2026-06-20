---
phase: 23
plan: 01
subsystem: docs-validation
tags: [docs, ci, validation, tdd, wave-0]
requires:
  - scripts/validate-docs.ts (existing — 3 invariants, Phase 15 D-01)
  - .github/workflows/release.yml (existing — D-12 mirror reference)
provides:
  - bun run validate (root npm script)
  - scripts/validate-docs.ts 4th invariant (Pass A + Pass B)
  - exported helpers checkCrossRunbookLinks + checkRunbookUrl
  - .github/workflows/validate.yml (CI gate on PR + push to main)
  - 9-slug constant for Plans 23-03 + 23-04 (RUNBOOK_SLUGS = ALERT_SLUGS)
  - 5 Wave-0 doc-shape RED test scaffolds (go GREEN as Plans 02/03/04 land)
affects:
  - package.json (scripts.validate added)
  - scripts/validate-docs.ts (helpers extracted, CLI body wrapped in import.meta.main gate)
tech-stack:
  added: []
  patterns:
    - "if (import.meta.main)"-gated CLI body — file is import-safe in tests
    - Pure-helper extraction so tests bypass subprocess spawning
    - Shared `_slugs.ts` constant module so RED scaffolds and downstream content plans reference one source of truth
key-files:
  created:
    - .github/workflows/validate.yml
    - scripts/__tests__/_slugs.ts
    - scripts/__tests__/validate-docs.test.ts
    - scripts/__tests__/runbook-files-present.test.ts
    - scripts/__tests__/runbook-section-shape.test.ts
    - scripts/__tests__/runbook-no-screenshots.test.ts
    - scripts/__tests__/alert-files-present.test.ts
    - scripts/__tests__/observability-docs-present.test.ts
    - scripts/__tests__/fixtures/docs/runbooks/{example,other,good}.md
    - scripts/__tests__/fixtures/docs/runbooks/pages/page.md
    - scripts/__tests__/fixtures/docs/alerts/sentry/{good,bad,no-url,bad-syntax}.json
  modified:
    - package.json
    - scripts/validate-docs.ts
decisions:
  - Adopted helper-function refactor pattern (Task 1 step 3 alternative) — pure exported helpers tested directly without subprocess spawning.
  - Wrapped CLI body in `if (import.meta.main)` so test imports do not re-run the live corpus scan as a side effect.
  - Reorganized fixtures under scripts/__tests__/fixtures/docs/{runbooks,alerts/sentry}/ to mirror the live repo layout, enabling tests to pass synthetic `docs/runbooks/<file>.md` relPaths through the helpers' built-in prefix gate.
  - Mermaid floor literal LEFT AT 8 — Plan 23-02 owns the 8 → 11 bump in the same diff as the two new diagrams in trace-propagation.md (Research Finding 5 — half-merged state breaks CI).
metrics:
  duration: ~6 min
  completed: 2026-04-28
---

# Phase 23 Plan 01: Validation infrastructure (Wave 0) Summary

Wired `bun run validate` into root package.json, extended the docs validator with a 4th invariant (runbook_url + cross-runbook markdown link integrity), shipped a second GitHub Actions workflow alongside release.yml, and committed 6 test files (1 GREEN unit test for the new invariant + 5 RED Wave-0 doc-shape scaffolds) so downstream Plans 02/03/04 inherit a deterministic feedback loop.

## What Was Built

### Task 1 — `validate` script + 4th invariant

- `package.json`: added `"validate": "bun scripts/validate-docs.ts"` between `typecheck` and `test`. RESEARCH §Q4 critical correction confirmed (`bun run validate` did NOT exist before this plan).
- `scripts/validate-docs.ts`: extended to 4 invariants. Pass A (cross-runbook markdown links) and Pass B (Sentry alert `runbook_url` integrity) implemented as **two pure exported helpers**, with the CLI body wrapped in `if (import.meta.main)` so tests can import the helpers without triggering a live-corpus scan as a side effect.

### Task 1 — Helper signatures (refactor pattern adopted)

```typescript
export function checkCrossRunbookLinks(
  relPath: string,
  text: string,
  root: string,
): string[];

export function checkRunbookUrl(
  relPath: string,
  jsonText: string,
  root: string,
): string | null;
```

- `checkCrossRunbookLinks` gates on `relPath.startsWith("docs/runbooks/")` and returns one failure message per broken `[..](./foo.md)` or `[..](../bar/baz.md)` cross-link found by line-naïve scan. Empty array on gate-miss or all-resolved.
- `checkRunbookUrl` does `JSON.parse` (returns `not valid JSON` on failure — D-15 negative gate), then validates `runbook_url` is a non-empty string and resolves to a real file via `existsSync(join(root, dirname(relPath), runbookUrl))`. Returns `null` on success.

### Task 1 — Pass placement in CLI body

- Pass A is invoked **inside** the existing `for await (const relPath of docsGlob.scan(...))` loop, AFTER the Mermaid count step. Failures are pushed into the same `failures` counter.
- Pass B is invoked **after** that loop closes, in its own `for await (const relPath of sentryGlob.scan(...))` loop over `docs/alerts/sentry/*.json`. BEFORE the existing Mermaid floor check (so a missing alerts dir does not interact with the Mermaid threshold).

### Task 2 — `.github/workflows/validate.yml`

Second GitHub Actions workflow alongside `release.yml`:

- Triggers: `pull_request: branches: [main]` + `push: branches: [main]`.
- Single job `validate-docs` on `ubuntu-latest`: `actions/checkout@v4` → `oven-sh/setup-bun@v2` (bun-version: latest) → `bun install --frozen-lockfile` → `bun run validate`.
- No test/lint/typecheck steps — D-12 explicit single-purpose scope. No secrets referenced (T-23-01 trust boundary).

### Task 3 — Wave-0 doc-shape RED scaffolds (5 test files + 1 shared slug constant)

- `scripts/__tests__/_slugs.ts` — single source of truth for the 9 slugs. `ALERT_SLUGS = RUNBOOK_SLUGS` per D-14 mirroring contract.
- `runbook-files-present.test.ts` — 9 tests, all RED today (DOC-03).
- `runbook-section-shape.test.ts` — 9 tests, all RED today (DOC-03 5-section template, level-2 ordered).
- `runbook-no-screenshots.test.ts` — 9 tests, vacuously GREEN today (early return when file missing); become real RED→GREEN gate as files are authored.
- `alert-files-present.test.ts` — 10 tests (9 alerts + 1 README), all RED today (DOC-04).
- `observability-docs-present.test.ts` — 5 tests (4 presence + 1 Mermaid-count), 4 RED + 1 vacuous-GREEN today (D-05).

## The 9 Runbook + Alert Slugs (locked into `_slugs.ts`)

Plans 23-03 and 23-04 MUST use these exact kebab-case strings:

| # | Slug                       | Domain                                |
| - | -------------------------- | ------------------------------------- |
| 1 | `db-down`                  | PostgreSQL availability               |
| 2 | `redis-down`               | Redis availability (queues + cache)   |
| 3 | `queue-backing-up`         | BullMQ depth threshold                |
| 4 | `webhook-failures`         | Stripe / Pagar.me webhook reliability |
| 5 | `auth-outage`              | better-auth path                      |
| 6 | `otel-exporter-failing`    | Observability egress                  |
| 7 | `bull-board-inaccessible` | Admin ops surface (Phase 22)          |
| 8 | `high-error-rate`          | Sentry error-rate threshold           |
| 9 | `slow-checkout`            | Billing latency SLO                   |

## Tests Status

- `bun test scripts/__tests__/validate-docs.test.ts`: **9/9 PASS** (Task 1 GREEN).
- `bun test scripts/__tests__/runbook-files-present.test.ts`: **0 pass / 9 fail** (Wave-0 RED — Plan 23-03 closes).
- `bun test scripts/__tests__/runbook-section-shape.test.ts`: **0 pass / 9 fail** (Wave-0 RED — Plan 23-03 closes).
- `bun test scripts/__tests__/runbook-no-screenshots.test.ts`: **9 pass / 0 fail** (vacuously — file missing → early return; transitions to real gate as Plan 23-03 lands).
- `bun test scripts/__tests__/alert-files-present.test.ts`: **0 pass / 10 fail** (Wave-0 RED — Plan 23-04 closes).
- `bun test scripts/__tests__/observability-docs-present.test.ts`: **1 pass / 4 fail** (presence: 4 RED; Mermaid-count: 1 vacuous-GREEN).

`bun run validate` against the live corpus: **exits 0** — confirms the 4th invariant has nothing to scan today (no `docs/runbooks/` or `docs/alerts/sentry/` content yet) and the existing 3 invariants (forbidden imports, secret shapes, Mermaid floor) still pass at 8 fenced blocks.

## Commits

- `c63c525` — `test(23-01): add failing tests for validate-docs 4th invariant` (RED gate)
- `b79d8d5` — `feat(23-01): wire validate-docs 4th invariant + bun run validate` (GREEN gate)
- `5f7235e` — `feat(23-01): add validate.yml GitHub Actions workflow`
- `0372b6b` — `test(23-01): add Wave-0 doc-shape RED test scaffolds`

TDD gate compliance: RED (`c63c525` test) → GREEN (`b79d8d5` feat) sequence verified for the 4th invariant. The 5 Wave-0 RED scaffolds in `0372b6b` go GREEN as content lands in Plans 02/03/04 — they are not paired with a feat commit in this plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Fixture path layout reorganized to satisfy helper prefix gate**

- **Found during:** Task 1 GREEN
- **Issue:** Plan placed fixtures at `scripts/__tests__/fixtures/runbooks/` and `scripts/__tests__/fixtures/sentry/`. The helper `checkCrossRunbookLinks` gates on `relPath.startsWith("docs/runbooks/")`. Tests passing `scripts/__tests__/fixtures/runbooks/example.md` as `relPath` could never trip the gate, so Test 2 (broken cross-link) returned an empty failure list.
- **Fix:** Reorganized fixtures under `scripts/__tests__/fixtures/docs/{runbooks,alerts/sentry}/` to mirror the live repo layout. Tests now pass `FIXTURE_ROOT = scripts/__tests__/fixtures` as the `root` argument and synthetic `docs/runbooks/<file>.md` / `docs/alerts/sentry/<file>.json` strings as `relPath`. Helpers' `dirname(relPath)`-based resolution lands cleanly on the fixture files. JSON `runbook_url` fields updated `../runbooks/...` → `../../runbooks/...` to match the new mirror depth.
- **Files modified:** scripts/__tests__/fixtures/* (renamed), scripts/__tests__/validate-docs.test.ts, scripts/__tests__/fixtures/docs/alerts/sentry/{good,bad}.json
- **Commit:** `b79d8d5` (folded into Task 1 GREEN)

**2. [Rule 3 — Blocking] Wrap CLI body in `if (import.meta.main)` so test imports do not run the live scan**

- **Found during:** Task 1 GREEN
- **Issue:** The original validator script body (loop + final exit-code logic) was top-level. Importing the exported helpers from the test file would execute the full live-corpus scan on every test run — both wasteful and a hard hang risk if any future docs change made it fail unrelated to the helpers.
- **Fix:** Wrapped the entire CLI body (counters, both for-await loops, Mermaid check, exit logic) in `if (import.meta.main) { … }`. Helpers are exported above the gate. Tests import helpers cleanly; subprocess test (Test 7) still exercises the CLI path via `Bun.spawn`.
- **Files modified:** scripts/validate-docs.ts
- **Commit:** `b79d8d5`

**3. [Rule 1 — Bug] Helper gate refactored from negated early-return to positive conditional to match acceptance grep**

- **Found during:** Task 1 acceptance criteria check
- **Issue:** Initial helper used `if (!relPath.startsWith("docs/runbooks/")) return [];` (early-return form). Plan acceptance criterion expects literal `if (relPath.startsWith("docs/runbooks/"))` (positive form) to grep-match.
- **Fix:** Inverted to `if (relPath.startsWith("docs/runbooks/")) { … }` wrapping the inner scan. Same semantics, satisfies the grep.
- **Files modified:** scripts/validate-docs.ts
- **Commit:** `b79d8d5`

### Pre-existing Out-of-Scope Issues (logged, not fixed)

- `bun run typecheck` reports several errors in `packages/queue/src/__tests__/queue.test.ts` (BullMQ type narrowing for `defaultJobOptions.removeOnComplete.age`). Pre-existing, unrelated to this plan's surface (`scripts/`). Per SCOPE BOUNDARY rule: not fixed here. None of the new files in this plan add typecheck errors (`bun run typecheck 2>&1 | grep "scripts/"` returns empty).

## Confirmation

- `bun run validate` works locally and exits 0 on the current corpus.
- The Mermaid floor literal at line 195 of `scripts/validate-docs.ts` is **deliberately left at `< 8`** (`if (mermaidTotal < 8)`). Plan 23-02 will bump this to `< 11` IN THE SAME COMMIT as the two new Mermaid diagrams in `docs/observability/trace-propagation.md` (Research Finding 5 — half-merged state breaks CI; the bump and the diagrams must land atomically).

## Self-Check: PASSED

- FOUND: scripts/__tests__/_slugs.ts
- FOUND: scripts/__tests__/validate-docs.test.ts
- FOUND: scripts/__tests__/runbook-files-present.test.ts
- FOUND: scripts/__tests__/runbook-section-shape.test.ts
- FOUND: scripts/__tests__/runbook-no-screenshots.test.ts
- FOUND: scripts/__tests__/alert-files-present.test.ts
- FOUND: scripts/__tests__/observability-docs-present.test.ts
- FOUND: scripts/__tests__/fixtures/docs/runbooks/example.md
- FOUND: scripts/__tests__/fixtures/docs/alerts/sentry/good.json
- FOUND: .github/workflows/validate.yml
- FOUND commit: c63c525 (test RED)
- FOUND commit: b79d8d5 (feat GREEN)
- FOUND commit: 5f7235e (feat workflow)
- FOUND commit: 0372b6b (test scaffolds)
