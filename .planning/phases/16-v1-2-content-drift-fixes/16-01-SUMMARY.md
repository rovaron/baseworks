---
phase: 16-v1-2-content-drift-fixes
plan: 01
subsystem: documentation
tags: [docs, content-drift, v1.2-audit, better-auth, billing, testing]

# Dependency graph
requires:
  - phase: 15-developer-documentation
    provides: Third-party integration docs (better-auth.md, billing.md) and testing.md that drifted from live code
provides:
  - docs/integrations/better-auth.md §"Module wire-up" paragraph matching apps/api/src/worker.ts and apps/api/src/index.ts actual module arrays (DOCS-06)
  - docs/integrations/billing.md §"PaymentProvider port" paragraph matching packages/modules/billing/src/ports/payment-provider.ts member count (DOCS-07)
  - docs/testing.md §"createMockDb" paragraph disambiguated from ScopedDb.select(table) (DOCS-05)
affects: [v1.2-milestone-close, future-docs-maintenance]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Content-drift fix pattern: cite sibling source-of-truth (mock-payment-provider.ts:5, cancel-subscription.ts:29-33, list-examples.ts:20) in prose so future readers can re-verify claims against live code"

key-files:
  created: []
  modified:
    - docs/integrations/better-auth.md
    - docs/integrations/billing.md
    - docs/testing.md

key-decisions:
  - "Applied Rule 3 (blocking) to expand DOCS-07 fix to all three '14 methods' occurrences in billing.md — the count was wrong in the overview (line 5), the PaymentProvider port section (line 47), and the Add-a-provider section (line 107). The plan scoped the fix to line 47 only, but the grep invariant `grep -c '14 methods' docs/integrations/billing.md` requires 0 matches, and the count is wrong everywhere it appears."

patterns-established:
  - "When correcting a claimed count in docs, search the full file for every occurrence of the number-plus-noun phrase — a single count typically appears in an overview, a detailed section, and procedural instructions"

requirements-completed: [DOCS-05, DOCS-06, DOCS-07]

gap_closure: true
closes_gap_from: .planning/v1.2-MILESTONE-AUDIT.md

# Metrics
duration: ~5min
completed: 2026-04-19
---

# Phase 16 Plan 1: v1.2 Content-Drift Fixes (DOCS-05, DOCS-06, DOCS-07) Summary

**Three WARN/FAIL content-drift items closed by editing three independent docs paragraphs — better-auth.md module wire-up, billing.md PaymentProvider count (13 members), and testing.md createMockDb shape disambiguation.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-19T21:51:59Z
- **Completed:** 2026-04-19T21:57:10Z (approximate)
- **Tasks:** 3 / 3
- **Files modified:** 3

## Accomplishments

- **DOCS-06 (FAIL → PASS):** better-auth.md:29 no longer falsely claims the auth module is registered in `apps/api/src/worker.ts:23`. The paragraph now cites `apps/api/src/index.ts:25-28` for API-side registration and explicitly states the worker loads `["example", "billing"]` (auth has no background jobs).
- **DOCS-07 (WARN → PASS):** billing.md now states the `PaymentProvider` port has 13 members (12 methods + 1 readonly `name` property), matching the canonical count asserted in `packages/modules/__test-utils__/mock-payment-provider.ts:5`. The correction was applied to all three file locations where the old "14 methods" count appeared (overview, port section, adapter-adding instructions).
- **DOCS-05 (WARN → PASS):** testing.md §"createMockDb" now describes the **raw Drizzle query-builder shape** that the mock actually implements (with a live cite to `cancel-subscription.ts:29-33`) and contrasts it with the `ScopedDb.select(table)` one-shot form (with a live cite to `list-examples.ts:20`). The old conflating sentence is gone.
- **Phase-close validator (`bun run scripts/validate-docs.ts`) continues to PASS** — no Mermaid-floor, forbidden-import, or secret-shape invariants affected.

## Task Commits

Each task was committed atomically on the worktree branch `worktree-agent-a85fb00e`:

1. **Task 1: DOCS-06 fix — correct better-auth.md module wire-up paragraph** — `f0c93e5` (docs)
2. **Task 2: DOCS-07 fix — correct billing.md PaymentProvider member count** — `066dabc` (docs)
3. **Task 3: DOCS-05 fix — disambiguate createMockDb shape in testing.md** — `8124788` (docs)

_All three are plain `docs(16-01): ...` commits; no TDD flow applies — prose-only edits._

## Files Created/Modified

- `docs/integrations/better-auth.md` — §"Module wire-up" paragraph at line 29: replaced single sentence claiming auth is in worker.ts:23 with corrected sentence citing index.ts:25-28 and noting worker loads [example, billing] only
- `docs/integrations/billing.md` — Three edits:
  - Line 5 (overview): "14 methods" → "13 members: 12 methods plus one readonly `name` property"
  - Line 47 (§PaymentProvider port): replaced opening sentences to state "13 members", add `name` to grouped breakdown under "provider identity", cite `mock-payment-provider.ts:5` as sibling source-of-truth
  - Line 107 (§Add a third payment provider): "All 14 methods must be implemented" → "All 13 members (12 methods plus the readonly `name` property) must be implemented"
- `docs/testing.md` — §"createMockDb" (lines 37-40): replaced single paragraph claiming the mock matches the `ScopedDb` API with two paragraphs: (a) describing the raw Drizzle chainable shape with cite to `cancel-subscription.ts:29-33`, (b) contrasting `ScopedDb.select(table)` one-shot form with cite to `list-examples.ts:20`

## Verbatim Before/After Snippets

### DOCS-06 (docs/integrations/better-auth.md:29)

**BEFORE:**
```
The exported `auth` instance in `packages/modules/auth/src/auth.ts::auth` is consumed by `packages/modules/auth/src/routes.ts`, which mounts it via `.mount(auth.handler)` — without a prefix, per the basePath gotcha below. The auth module is listed in the `modules` array in `apps/api/src/index.ts:27` and in the worker entrypoint `apps/api/src/worker.ts:23`. Registration happens automatically through `ModuleRegistry.loadAll()` — no separate wire-up call is required.
```

**AFTER:**
```
The exported `auth` instance in `packages/modules/auth/src/auth.ts::auth` is consumed by `packages/modules/auth/src/routes.ts`, which mounts it via `.mount(auth.handler)` — without a prefix, per the basePath gotcha below. The auth module is listed in the `modules` array in `apps/api/src/index.ts:25-28` (API process only). The worker process (`apps/api/src/worker.ts:21-24`) loads `["example", "billing"]` — auth has no background jobs, so the worker does not register it. Registration happens automatically through `ModuleRegistry.loadAll()` — no separate wire-up call is required.
```

### DOCS-07 (docs/integrations/billing.md:47, primary edit)

**BEFORE:**
```
The port is declared in `packages/modules/billing/src/ports/payment-provider.ts:38-159`. It declares 14 methods grouped by concern: customer lifecycle (`createCustomer`), subscription lifecycle (`createSubscription`, `cancelSubscription`, `changeSubscription`, `getSubscription`), checkout (`createCheckoutSession`, `createOneTimePayment`), portal (`createPortalSession`), webhooks (`verifyWebhookSignature`, `normalizeEvent`), invoices (`getInvoices`), and an optional `reportUsage` for providers that support metered billing. Every adapter implements these as `implements PaymentProvider`, so the TypeScript compiler enforces that new adapters cover the full port.
```

**AFTER:**
```
The port is declared in `packages/modules/billing/src/ports/payment-provider.ts:38-159`. It declares 13 members: 12 methods plus one readonly `name` property. Grouped by concern: provider identity (`name`), customer lifecycle (`createCustomer`), subscription lifecycle (`createSubscription`, `cancelSubscription`, `changeSubscription`, `getSubscription`), checkout (`createCheckoutSession`, `createOneTimePayment`), portal (`createPortalSession`), webhooks (`verifyWebhookSignature`, `normalizeEvent`), invoices (`getInvoices`), and an optional `reportUsage` for providers that support metered billing. Every adapter implements these as `implements PaymentProvider`, so the TypeScript compiler enforces that new adapters cover the full port. The test utility at `packages/modules/__test-utils__/mock-payment-provider.ts:5` documents the same count ("all 13 interface methods").
```

### DOCS-05 (docs/testing.md:37-40)

**BEFORE:**
```
### createMockDb

`packages/modules/__test-utils__/mock-context.ts::createMockDb` returns a chainable stub matching the `ScopedDb` API — `select().from().where().limit()`, `insert().values()`, `update().set()`, and `delete()`. Override resolved values per method with the options object `{ insert, select, update, delete }`. Each returned mock function is a Bun `mock(...)`, so tests can assert call arguments with `toHaveBeenCalledWith`.
```

**AFTER:**
```
### createMockDb

`packages/modules/__test-utils__/mock-context.ts::createMockDb` returns a chainable stub matching the **raw Drizzle query-builder shape** — `select().from().where().limit()`, `insert().values()`, `update().set()`, and `delete()`. This is the shape handlers like `packages/modules/billing/src/commands/cancel-subscription.ts:29-33` use when they reach for chained Drizzle calls. Override resolved values per method with the options object `{ insert, select, update, delete }`. Each returned mock function is a Bun `mock(...)`, so tests can assert call arguments with `toHaveBeenCalledWith`.

Note that `ScopedDb.select(table)` (declared in `packages/db/src/helpers/scoped-db.ts`, used by `packages/modules/example/src/queries/list-examples.ts:20` as `ctx.db.select(examples)`) is a different, one-shot shape: it takes a table and returns results directly, with no `.from().where().limit()` chain. When testing a handler that uses the one-shot form, override the mock's `select` to accept a table and return the rows directly, or replace `ctx.db` wholesale with a minimal object implementing just the one-shot call.
```

## Verification — All Plan Invariants Hold

Ran in the worktree after all three commits:

| Check | Expected | Got | Result |
| --- | --- | --- | --- |
| `grep -c "registered in.*worker.ts" docs/integrations/better-auth.md` | `0` | `0` | PASS |
| `grep -c "worker entrypoint \`apps/api/src/worker.ts:23\`" docs/integrations/better-auth.md` | `0` | `0` | PASS |
| `grep -c "worker process (\`apps/api/src/worker.ts:21-24\`) loads" docs/integrations/better-auth.md` | `>=1` | `1` | PASS |
| `grep -c "apps/api/src/index.ts:25-28" docs/integrations/better-auth.md` | `>=1` | `1` | PASS |
| `grep -c "13 members" docs/integrations/billing.md` | `>=1` | `3` | PASS |
| `grep -c "14 methods" docs/integrations/billing.md` | `0` | `0` | PASS |
| `grep -c "readonly \`name\` property" docs/integrations/billing.md` | `>=1` | `3` | PASS |
| `grep -c "mock-payment-provider.ts:5" docs/integrations/billing.md` | `>=1` | `1` | PASS |
| `grep -c "all 13 interface methods" docs/integrations/billing.md` | `>=1` | `1` | PASS |
| `grep -c "ScopedDb.select(table)" docs/testing.md` | `>=1` | `1` | PASS |
| `grep -c "raw Drizzle query-builder shape" docs/testing.md` | `1` | `1` | PASS |
| `grep -c "chainable" docs/testing.md` | `>=1` | `1` | PASS |
| `grep -c "one-shot" docs/testing.md` | `>=1` | `1` | PASS |
| `grep -c "cancel-subscription.ts:29-33" docs/testing.md` | `>=1` | `1` | PASS |
| `grep -c "list-examples.ts:20" docs/testing.md` | `>=1` | `1` | PASS |
| `grep -c "matching the \`ScopedDb\` API" docs/testing.md` | `0` | `0` | PASS |
| `bun run scripts/validate-docs.ts` | exit 0 / PASS | `[validate-docs] PASS` | PASS |

All 17 invariants satisfied. Phase-close validator still passes.

## Decisions Made

- **Expand DOCS-07 fix scope from 1 occurrence to 3.** The plan targeted only the paragraph at `docs/integrations/billing.md:47`, but the canonical grep invariant `grep -c "14 methods" docs/integrations/billing.md` requires `0` matches. The file contained "14 methods" in three places (line 5 overview, line 47 port section, line 107 adapter-adding step). Since the count is wrong everywhere it appears — the port truly has 13 members — applying the same correction to all three locations is the only way to honor both the acceptance criterion and the plan's intent (align docs with live code). Documented below as Rule 3 auto-fix.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Expanded DOCS-07 fix to all three "14 methods" occurrences in billing.md**
- **Found during:** Task 2 (DOCS-07 fix)
- **Issue:** Plan specified replacement for the paragraph at line 47 only, but `grep -c "14 methods" docs/integrations/billing.md` still returned `2` after applying the line-47 fix — the wrong count also appeared at line 5 (file overview) and line 107 (§"Add a third payment provider" step 1). The plan's acceptance criterion requires `0` matches.
- **Fix:** Applied the same "14 methods" → "13 members (12 methods + 1 readonly name)" correction to the overview sentence at line 5 and the adapter-adding instruction at line 107. Both reworded minimally to stay consistent with the fix style in the primary (line 47) edit.
- **Files modified:** `docs/integrations/billing.md`
- **Verification:** `grep -c "14 methods" docs/integrations/billing.md` now returns `0`; `grep -c "13 members" docs/integrations/billing.md` returns `3`; validator passes.
- **Committed in:** `066dabc` (Task 2 commit — single atomic commit covers all three billing.md edits)

### Execution-environment Incident (non-plan, not a code deviation)

During execution, several Bash commands were prefixed with `cd C:/Projetos/baseworks && …` to set a known working directory. In this Windows/Git-Bash environment, `cd` in the Bash shell changed the effective cwd out of the worktree (`C:/Projetos/baseworks/.claude/worktrees/agent-a85fb00e`) into the parent repo (`C:/Projetos/baseworks`). As a result, the first pass of three commits (`968a1fd`, `4f91e31`, `17b0cfd`) landed on the parent repo's `master` branch rather than the worktree branch `worktree-agent-a85fb00e`.

**Resolution (applied in this execution, before writing this summary):**
- Cherry-picked all three commits from parent `master` onto the worktree branch: `f0c93e5`, `066dabc`, `8124788`.
- Verified worktree branch `git log` shows the three docs edits on top of the plan's required base commit `58c3844`.
- Did NOT revert the commits on parent `master`: (a) a parallel worktree agent (16-02) was also committing to the same branch concurrently, so rewriting `master` history would race with that agent; (b) the parent repo's contents on those paths now match the worktree branch, so when the orchestrator merges `worktree-agent-a85fb00e` later, git will see identical content (no merge conflict) — the merge will be idempotent for this plan's files.
- Noting this for the orchestrator: **the three authoritative commits for this plan are `f0c93e5`, `066dabc`, `8124788` on branch `worktree-agent-a85fb00e`.** The same logical changes also appear on parent `master` via `968a1fd`, `4f91e31`, `17b0cfd` as a side-effect of the cd-out issue. No content is lost; history may show duplicated SHAs for the same diff.

No code was changed because of this incident — only commit routing.

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking — expanded DOCS-07 to all three occurrences)
**Impact on plan:** The blocking auto-fix is strictly in-scope for DOCS-07 (the count "14 methods" was wrong everywhere in the file; the plan under-scoped its own invariant). Execution-environment incident was an operational hiccup that did not affect the shipped content — all three tasks' changes are present on the worktree branch, verified, and pass the plan's verification and the phase-close validator.

## Issues Encountered

- None for the actual edits. The `cd`-out-of-worktree incident is documented under Deviations but did not affect the final file content.

## User Setup Required

None — this is a documentation-only plan with no new env vars, services, or external configuration.

## Next Phase Readiness

- Three v1.2 audit items closed: DOCS-05 (WARN → PASS), DOCS-06 (FAIL → PASS), DOCS-07 (WARN → PASS).
- No dependencies on 16-02 or 16-03 — this plan is wave 1 and independent.
- The remaining Phase 16 plans (16-02 enqueue-path, 16-03 auth test convention) can proceed in parallel/subsequently without blocking on this plan.

---
*Phase: 16-v1-2-content-drift-fixes*
*Plan: 01*
*Completed: 2026-04-19*
