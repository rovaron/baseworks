---
phase: 15-developer-documentation
plan: 04
subsystem: docs
tags: [documentation, markdown, tutorial, configuration, testing, cqrs, bullmq]

# Dependency graph
requires:
  - phase: 15-developer-documentation
    provides: "docs/README.md navigation index + tone/citation/Mermaid contracts (Plan 01)"
  - phase: 15-developer-documentation
    provides: "Extended example module with create-example.ts + list-examples.ts + process-followup.ts + registerExampleHooks, the DOCS-03 tutorial subject (Plan 02)"
  - phase: 15-developer-documentation
    provides: "docs/architecture.md prerequisite for add-a-module.md per D-06; docs/getting-started.md precedes configuration.md (Plan 03)"
  - phase: 14-unit-tests
    provides: "packages/modules/__test-utils__ mock factories (createMockContext, createMockDb, assertResultOk/Err) and the mock.module test pattern in billing.test.ts"
  - phase: 13-jsdoc-annotations
    provides: "docs/jsdoc-style-guide.md technical-precise tone reference"
provides:
  - "docs/add-a-module.md (DOCS-03) — 10-step annotated walkthrough of packages/modules/example covering command, query, event, BullMQ job"
  - "docs/configuration.md (DOCS-04) — 20-row env var catalog mirroring packages/config/src/env.ts + module loading + provider selection + deployment config"
  - "docs/testing.md (DOCS-05) — test runner scope + shared __test-utils__ factories + two mock strategies + common mistakes"
  - "Canonical relative-path import convention for __test-utils__ (../../../__test-utils__/mock-context) exercised across both add-a-module.md and testing.md"
affects:
  - "15-05 (plan 05 / integration docs DOCS-06..09) — configuration.md is the authoritative env reference each integration doc cites; testing.md is the adapter-test pattern reference; add-a-module.md is the mechanics reference every Extending section can assume is familiar"
  - "phase-15-verifier — same forbidden-word / forbidden-package-manager / forbidden-real-secret grep chains apply"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tutorial-doc structure: prerequisite callout + What you will build + N-step walkthrough + Smoke test + Security checklist + Next steps"
    - "Reference-doc structure: single-paragraph lead + catalog/table + subsystem subsections + Security notes + Next steps"
    - "Relative-path __test-utils__ convention codified in two docs simultaneously — never referenced as a workspace package"

key-files:
  created:
    - "docs/add-a-module.md — 165-line 10-step annotated walkthrough (DOCS-03)"
    - "docs/configuration.md — 104-line env catalog + module loading + deploy config (DOCS-04)"
    - "docs/testing.md — 121-line test runner + mock patterns + adapter conformance (DOCS-05)"
  modified: []

key-decisions:
  - "Kept all code citations short and cited by path:line or function-name anchors per the Plan 01 contract; no inline code block exceeded 12 lines, and the single 12-line block (Step 7 module definition) is explicitly flagged in the prose as an exception to the 10-line guideline."
  - "Reworked the Plan-01-style inline declaration that `@baseworks/test-utils` does not exist: both docs state the fact without using the literal string (which the verify regex forbids). `add-a-module.md` says 'the shared directory is NOT a workspace package and has no @baseworks-prefixed package name'; `testing.md` uses 'has no @baseworks-prefixed package name'. Both satisfy the zero-count requirement while preserving the warning."
  - "Added `### How env loading works` and `### Variable groups` H3 subsections under configuration.md §Environment variables to meet the 100-line frontmatter minimum with substantive technical content rather than prose padding (the schema declaration-order table alone left the doc at 86 lines)."
  - "Added `### Event-bus hooks` H3 subsection under §Module loading to document the canonical register{Module}Hooks wiring (registerBillingHooks + registerExampleHooks) — an operational requirement omitted from the plan body but implied by the threat-model T-15-14 mitigation ('both arrays must be kept in sync' must also cover the hook call, otherwise events silently disconnect)."

patterns-established:
  - "Relative-path test-utils imports as project convention: `../../../__test-utils__/mock-context` and `../../../__test-utils__/assert-result` from each module's `src/__tests__/*`. Plan 05 integration docs will inherit this when they show integration-specific test snippets."
  - "Env-var catalog layout: 4-column table (name / required / default / purpose) + grouped variable-groups subsection + dedicated startup-guards section. Integration-doc env tables should mirror this shape to stay consistent with the root configuration.md."
  - "Mock strategy decision tree: shared+db-only handler → createMockContext alone; handler importing @baseworks/config or external SDK → mock.module block at top of file, ordered config → Redis → BullMQ → Postgres. Adapter conformance → mock the upstream SDK only."

requirements-completed: [DOCS-03, DOCS-04, DOCS-05]

# Metrics
duration: 5min
completed: 2026-04-18
---

# Phase 15 Plan 04: Add-a-Module + Configuration + Testing Summary

**Three reference docs — `docs/add-a-module.md` walks a developer through creating a new module against the four-surface `packages/modules/example`, `docs/configuration.md` catalogs every env var from `packages/config/src/env.ts` plus the two startup guards and both module-loading registration sites, and `docs/testing.md` documents the Phase 14 `__test-utils__` factories and the two mock strategies (HandlerContext mock vs `mock.module` block) every backend test in the repo uses.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-18T00:03:29Z
- **Completed:** 2026-04-18T00:08:44Z
- **Tasks:** 3
- **Files modified:** 3 (all created)

## Accomplishments

- **DOCS-03 — `docs/add-a-module.md`** (165 lines): H1 + one-paragraph lead + explicit `./architecture.md` prerequisite paragraph + `## What you will build` + 10 numbered steps (`## Step 1: Copy the example module` through `## Step 10: Test it`) + `## Smoke test` + `## Security checklist` + `## Next steps`. Every required example-module file cited: `create-example.ts`, `list-examples.ts`, `process-followup.ts`. Registration anchors named: `moduleImportMap`, `ModuleDefinition`, `defineCommand`, `defineQuery`. Test snippet imports `createMockContext` via the relative path `../../../__test-utils__/mock-context` and flags the no-workspace-package convention in prose. The Step 7 full four-surface `ModuleDefinition` snippet is 12 lines — explicitly called out as the canonical exception to the 10-line guideline.
- **DOCS-04 — `docs/configuration.md`** (104 lines): H1 + one-paragraph lead citing `packages/config/src/env.ts` as source of truth + `## Environment variables` with a 20-row table covering every var in `env.ts` (declaration order: `DATABASE_URL`, `NODE_ENV`, `PORT`, `REDIS_URL`, `LOG_LEVEL`, `INSTANCE_ROLE`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, Google/GitHub OAuth pairs, `PAYMENT_PROVIDER`, Stripe + Pagar.me secrets, `RESEND_API_KEY`, `WEB_URL`, `ADMIN_URL`, `WORKER_HEALTH_PORT`) + `### How env loading works` explaining Bun + `@t3-oss/env-core` + `### Variable groups` + `## Startup guards` with `### validatePaymentProviderEnv` and `### assertRedisUrl` subsections + `## Module loading` with `### Static import map`, `### Active modules per role`, and `### Event-bus hooks` subsections + `## Provider selection` citing `provider-factory.ts::getPaymentProvider` + `## Deployment configuration` with `### docker-compose.yml`, `### Dockerfiles`, `### Worker health endpoint` subsections + `## Security notes` + `## Next steps`.
- **DOCS-05 — `docs/testing.md`** (121 lines): H1 + one-paragraph lead naming `bun test` scope and deferred Vitest integration + `## Test runner` with `### Frontend tests (deferred)` subsection + `## Shared test utilities` with `### createMockContext`, `### createMockDb`, `### assertResultOk / assertResultErr` subsections (all citing files under `packages/modules/__test-utils__/`) + `## Testing commands and queries` with typical command-test inline snippet and a `### Behavioral assertions` subsection banning over-specific ORM assertions + `## Testing adapters and handlers that import external SDKs` with the `mock.module` block snippet, explicit citation of `billing.test.ts:1-67` for the full pattern, and a `### Adapter conformance tests` subsection citing `pagarme-adapter.test.ts` + `## Testing job handlers` with a typical `spyOn(console, "log")` snippet + `## Coverage philosophy` (80%+, not 100%, rejects 100% target per `REQUIREMENTS.md`) + `## Common mistakes` bulleted list + `## Next steps`.
- Every doc obeys the Plan 01 contracts: technical-precise tone (no `basically` / `simply` / `just`), `path:line` and `path::functionName` citation format, no `npm install` / `yarn` / `pnpm`. `configuration.md` additionally passes the real-secret regex gate (no `sk_live_`, no long `sk_test_`, no `re_*`, no `whsec_*`).
- The relative-path test-utils import convention (`../../../__test-utils__/mock-context`) is now pinned in TWO docs simultaneously (add-a-module.md Step 10 and testing.md §Shared test utilities) so a future refactor that introduces `@baseworks/test-utils` as a real workspace package must update both docs explicitly.

## Task Commits

Each task was committed atomically via `--no-verify` (parallel-executor mode):

1. **Task 1: Author docs/add-a-module.md (DOCS-03)** — `0607a84` (docs)
2. **Task 2: Author docs/configuration.md (DOCS-04)** — `7ec3374` (docs)
3. **Task 3: Author docs/testing.md (DOCS-05)** — `fb9d18a` (docs)

## Files Created/Modified

- `docs/add-a-module.md` (created) — 165-line 10-step annotated walkthrough.
- `docs/configuration.md` (created) — 104-line env catalog + module loading + deployment config.
- `docs/testing.md` (created) — 121-line test runner scope + shared utilities + mock patterns.

## Decisions Made

- **Rewording to avoid the `@baseworks/test-utils` literal.** Plan acceptance required zero occurrences of the string `@baseworks/test-utils` in both add-a-module.md and testing.md, but the plan's prose examples for those docs both used the literal string in an expository sentence. Reworded both sentences to communicate the same fact — the shared directory is NOT a workspace package — without using the forbidden literal: add-a-module.md says "the shared directory is NOT a workspace package and has no `@baseworks`-prefixed package name"; testing.md says "The shared directory is NOT a workspace package; it has no `@baseworks`-prefixed package name and must be consumed by relative paths only". Both satisfy the verify chain's `grep -c "@baseworks/test-utils" = 0` while preserving the warning.
- **Expanded configuration.md to meet the 100-line floor without padding.** The plan's prescribed structure (20-row table + six `##` sections + bulleted Security notes) left the doc at 86 lines. Rather than pad with prose, added two substantive H3 subsections under §Environment variables (`### How env loading works` explaining Bun + `@t3-oss/env-core` + `emptyStringAsUndefined: true`, and `### Variable groups` grouping the 20 variables into seven functional buckets), plus a `### Event-bus hooks` subsection under §Module loading documenting the `register{Module}Hooks` wiring required to keep the event-to-job path connected. All content is verifiable against `packages/config/src/env.ts`, `apps/api/src/index.ts`, and the two existing register-hooks call sites.
- **Kept line counts at pragmatic levels, not at soft targets.** Plan suggested 180-260 lines for add-a-module.md, 120-180 for configuration.md, 100-160 for testing.md. Delivered 165 / 104 / 121 respectively. All three are above their `min_lines` frontmatter floors (150 / 100 / 80) and fit within the envelope each task prescribes. Extending beyond the soft target would violate D-11 (no filler, domain-terminology-first). Every section is present; every required citation lands.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Reconciled `@baseworks/test-utils` literal conflict between plan prose and verify regex**

- **Found during:** Task 1 (verification step for add-a-module.md), then Task 3 (same issue)
- **Issue:** The plan action text for both Task 1 Step 10 and Task 3 §"Shared test utilities" suggested phrasing that included the literal string `@baseworks/test-utils` (e.g., "there is no `@baseworks/test-utils` workspace package"). The plan's verify chain forbids any occurrence (`grep -c "@baseworks/test-utils" = 0`). Direct inclusion of the suggested phrasing caused the Task 1 verify chain to fail on first run.
- **Fix:** Reworded both mentions to state the same fact — the shared directory is not a workspace package — without the literal string. Both docs now pass the verification count of 0.
- **Files modified:** `docs/add-a-module.md` (Step 10 intro), `docs/testing.md` (§Shared test utilities intro)
- **Verification:** `grep -c "@baseworks/test-utils" docs/add-a-module.md` → 0; same for testing.md. Full Task 1 and Task 3 verify chains both return `PASS`.
- **Committed in:** `0607a84` (Task 1), `fb9d18a` (Task 3)

**2. [Rule 2 — Missing critical functionality] Added §Module loading `### Event-bus hooks` subsection**

- **Found during:** Task 2 (configuration.md authoring)
- **Issue:** The plan's §Module loading section covers two registration sites (moduleImportMap + per-role modules array) but does not mention the third site — the `register{Module}Hooks(eventBus)` invocation in `apps/api/src/index.ts` that wires domain events to BullMQ queues. Omitting this creates the exact T-15-14 failure mode the threat model warns about: a module is declared and loaded, but events silently do not enqueue jobs. The plan's "both arrays must be kept in sync" language does not cover the hook call.
- **Fix:** Added a `### Event-bus hooks` H3 subsection under §Module loading that documents the pattern, cites the two existing sites (`registerBillingHooks`, `registerExampleHooks`), and warns that forgetting the call leaves the event-to-job path disconnected.
- **Files modified:** `docs/configuration.md` (added subsection)
- **Verification:** Full Task 2 verify chain passes; the new subsection does not introduce any forbidden patterns.
- **Committed in:** `7ec3374` (Task 2)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical functionality)
**Impact on plan:** Both deviations are localized, preserve the plan's intent, and each strengthens the threat-model mitigation it was related to (T-15-14 in particular). No scope creep; no additional files created.

## Issues Encountered

- Git normalized LF to CRLF on commit for all three new files (standard Windows warning, no content change).
- Pre-existing worktree baseline contains ~200 modified/untracked files from the parent snapshot; none were touched by this plan. Staging stayed targeted: only `docs/add-a-module.md`, `docs/configuration.md`, and `docs/testing.md` were staged for their respective task commits.

## Full Test Suite Status

No code changes in this plan; no test impact. All three docs are pure prose plus fenced code blocks. Grep-based acceptance chains (see verification below) serve as the automated gate. The code samples inside the docs are verbatim citations from files that exist in the repo — they have not been re-written, so any future refactor of those source files automatically surfaces in a doc-consistency review.

## Verification (per-task automated chains)

Ran the verbatim `<automated>` grep chain from each task block of `15-04-PLAN.md` after the commit for that task:

- **Task 1 chain (add-a-module.md):** file exists, all 13 required H1/H2 headings present (`Add a Module`, Steps 1/3/4/5/6/7/9/10, `Smoke test`, `Security checklist`), prerequisite `architecture.md` link present, all three example-module file citations (`create-example.ts`, `list-examples.ts`, `process-followup.ts`), registration anchors (`moduleImportMap`, `ModuleDefinition`, `defineCommand`, `defineQuery`), `createMockContext` citation, relative-path test-utils import (`../../../__test-utils__/mock-context`), `@baseworks/test-utils` count = 0, zero `npm install` / `yarn` / `pnpm`, zero filler words. Output: `TASK1_VERIFY_PASS`.
- **Task 2 chain (configuration.md):** file exists, all 7 `##` headings present (Environment variables, Startup guards, Module loading, Provider selection, Deployment configuration, Security notes — Next steps implied by header count), all critical env var names present (DATABASE_URL, BETTER_AUTH_SECRET, REDIS_URL, PAYMENT_PROVIDER, STRIPE_SECRET_KEY, PAGARME_SECRET_KEY, RESEND_API_KEY, INSTANCE_ROLE, WORKER_HEALTH_PORT), both startup-guard function names (validatePaymentProviderEnv, assertRedisUrl), moduleImportMap, docker-compose.yml, packages/config/src/env.ts, zero real-shaped secrets, zero npm/yarn/pnpm, zero filler words. Output: `TASK2_VERIFY_PASS`.
- **Task 3 chain (testing.md):** file exists, all 8 `##` headings present (Test runner, Shared test utilities, Testing commands and queries, Testing adapters and handlers that import external SDKs, Testing job handlers, Coverage philosophy, Common mistakes, Next steps implied), all cited helpers (createMockContext, createMockDb, assertResultOk), `mock.module` present, `bun test` present, cited files (mock-context.ts, billing.test.ts, pagarme-adapter.test.ts), Vitest mentioned as deferred, relative-path test-utils import present, `@baseworks/test-utils` count = 0, zero npm/yarn/pnpm, zero filler words. Output: `TASK3_VERIFY_PASS`.

## Known Open Cross-links

The `Next steps` sections link to Plan 05 deliverables that do not yet exist on disk:

- `./integrations/bullmq.md` — Plan 15-05 (DOCS-08), linked from add-a-module.md §Next steps
- `./integrations/billing.md` — Plan 15-05 (DOCS-07), linked from configuration.md §Provider selection
- `./integrations/better-auth.md` — Plan 15-05 (DOCS-06), linked from testing.md §Next steps
- `./integrations/` directory — linked from configuration.md §Next steps

GitHub's relative-link checker will flag these as broken until Plan 05 lands. Expected; consistent with the open cross-links noted at the bottom of Plan 03's summary.

## User Setup Required

None — no external service configuration required. All three documents are pure markdown.

## Next Phase Readiness

- **Plan 15-05 (integration docs DOCS-06..09) can now proceed with all three reference docs in place.** Every integration doc's Setup section can link to `configuration.md` for env var details instead of duplicating them; every Extending section can link to `add-a-module.md` for module-mechanics context instead of re-explaining registration; every integration's test examples can link to `testing.md` for the mock patterns.
- **The canonical `__test-utils__` relative-path import convention is now documented in two places.** Plan 05's integration-specific test snippets (notably the adapter-conformance examples in DOCS-07) should follow the same pattern.
- **Threat-model mitigation T-15-14 is reinforced.** The `### Event-bus hooks` subsection added to configuration.md ensures future module additions include the `register{Module}Hooks` call — the mitigation's "both arrays must be kept in sync" language now covers three sites instead of two.

## TDD Gate Compliance

Not applicable — Plan 15-04 is `type: execute`, not `type: tdd`. All three tasks are pure documentation, so no RED/GREEN cycle is expected.

---
*Phase: 15-developer-documentation*
*Completed: 2026-04-18*

## Self-Check: PASSED

Files verified on disk:

- `docs/add-a-module.md` — FOUND (165 lines)
- `docs/configuration.md` — FOUND (104 lines)
- `docs/testing.md` — FOUND (121 lines)

Commits verified in `git log`:

- `0607a84` (Task 1 — docs) — FOUND
- `7ec3374` (Task 2 — docs) — FOUND
- `fb9d18a` (Task 3 — docs) — FOUND

Per-task automated verify chains re-executed after committing each task:

- Task 1 chain: `TASK1_VERIFY_PASS`
- Task 2 chain: `TASK2_VERIFY_PASS`
- Task 3 chain: `TASK3_VERIFY_PASS`

All 6 plan-level success criteria confirmed:

1. `docs/add-a-module.md` exists with 10 numbered steps + smoke test + security checklist, cites the post-Plan-02 example module files (`create-example.ts`, `list-examples.ts`, `process-followup.ts`), links back to `./architecture.md` as a prerequisite — VERIFIED
2. `docs/configuration.md` exists with a complete env var catalog mirroring `packages/config/src/env.ts`, documents both startup guards (`validatePaymentProviderEnv`, `assertRedisUrl`), both registration sites for module loading (plus the event-bus hooks addition), provider selection, and deployment config — VERIFIED
3. `docs/testing.md` exists with test-runner scope, shared utilities (`createMockContext`, `createMockDb`, `assertResultOk`), the two Phase 14 mock strategies (context mock + `mock.module` block), job-handler testing, and common mistakes — VERIFIED
4. All three docs pass forbidden-word greps (`basically`, `simply`, `just`) and forbidden-package-manager greps — VERIFIED
5. `docs/configuration.md` contains no real-shaped secrets — VERIFIED
6. DOCS-03, DOCS-04, DOCS-05 requirement IDs covered — VERIFIED
