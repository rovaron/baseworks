---
phase: 23-runbooks-alert-templates-observability-docs
plan: 02
subsystem: docs
tags: [docs, observability, mermaid, validation, otel, als, bullmq]
requires:
  - phase: 23-01
    provides: "validate-docs.ts 4th invariant + Wave-0 RED tests + Mermaid floor literal still at 8 (this plan owns the bump)"
  - phase: 19
    provides: "obsContext ALS instance + setSpan/setTenantContext mutators + Biome GritQL enterWith ban referenced in trace-propagation.md"
  - phase: 20
    provides: "wrapQueue producer span + W3C carrier injection on job.data._otel + wrapProcessorWithAls consumer extract"
  - phase: 18
    provides: "scrubPii denylist (DEFAULT_DENY_KEYS at scrub-pii.ts:34-52) cited in cardinality.md"
provides:
  - "docs/observability/README.md — index + 1-paragraph intro + 'where observability lives' flowchart (1 Mermaid block)"
  - "docs/observability/attributes.md — 5-column glossary table (Name | Lives on | Type | Example | Cardinality risk) for 11 fields, with verbatim ObservabilityContext snippet citation"
  - "docs/observability/cardinality.md — rules + 9-value HIGH-card list (D-08) + scrub-pii.ts:34-38 snippet + anti-patterns + OTLP forward-looking note"
  - "docs/observability/trace-propagation.md — 2 verbatim Mermaid diagrams (sequenceDiagram + stateDiagram-v2 with note blocks) + walkthroughs citing wrap-queue.ts:74-83 + context.ts:57 + queue/src/index.ts:85-130"
  - "scripts/validate-docs.ts Mermaid floor bumped 8 → 11 (literal + JSDoc + error message)"
  - "Total docs/ Mermaid count: 11 (4 architecture + 4 integrations + 2 trace-propagation + 1 README)"
affects:
  - "23-03 (runbooks under docs/runbooks/) — runbooks deep-link to attributes.md/cardinality.md/trace-propagation.md anchors"
  - "23-04 (Sentry alert JSON templates) — alert templates' runbook_url fields point at docs/runbooks/ which cross-link back to docs/observability/"
  - "23-05 (Phase close) — Mermaid floor invariant now enforces 11; Plan 23-05 CI smoke check inherits this floor"
tech-stack:
  added: []
  patterns:
    - "Verbatim Mermaid copy from RESEARCH §Q3 — diagrams ship the same syntax already validated as GitHub-renderable in this repo (sequenceDiagram in 8 places, stateDiagram-v2 prepared)"
    - "5-line snippet citation format with first-line source comment (`// From <path>:<lo>-<hi>`) — extends docs/README.md:36 mixed-citation strategy"
    - "Synthetic placeholder values throughout (req_a8f3b1, tenant_abc123, cus_test_xxxx) — no real customer or internal data appears in any document (T-23-07/09 mitigation)"
    - "Atomic floor-bump-with-content rule — Mermaid floor literal raised to 11 in the SAME plan's commit chain as the 3 new diagrams (Research Finding 5: half-merged state breaks CI)"
key-files:
  created:
    - docs/observability/README.md
    - docs/observability/attributes.md
    - docs/observability/cardinality.md
    - docs/observability/trace-propagation.md
  modified:
    - scripts/validate-docs.ts
key-decisions:
  - "Honored RESEARCH Finding 2 corrected paths in every citation: packages/observability/src/context.ts:43-51 + :57, packages/observability/src/wrappers/wrap-queue.ts:74-83, packages/observability/src/lib/scrub-pii.ts:34-52, packages/queue/src/index.ts:85-130. The CONTEXT.md WRONG paths (packages/queue/src/wrap-queue.ts and packages/observability/src/lib/obs-context.ts) appear ZERO times in any deliverable."
  - "Verbatim Mermaid diagrams from RESEARCH §Q3 — both diagram blocks copied byte-for-byte including the two `note right of` annotations on the stateDiagram-v2 block (per <action> directive). No improvisation."
  - "Mermaid floor literal raised in the same plan as the diagram content (Plan 23-02), satisfying Research Finding 5's atomicity requirement. Plan 23-01 deliberately left the literal at 8."
  - "Forward-looking links from docs/observability/cardinality.md and trace-propagation.md to ../runbooks/otel-exporter-failing.md are intentional. Plan 23-03 ships the target. Pass A only validates cross-runbook links INSIDE docs/runbooks/, so these forward references do not currently fail validation. They will resolve when Plan 23-03 lands."
patterns-established:
  - "docs/observability/ subdirectory layout established. Future observability concept docs (e.g., dashboards-and-alerts.md when OTLP wires in v1.4+) land under the same subdirectory and follow the same shape: H1 + 4-line opener + General Rules + content sections + Cross-references."
  - "Cardinality risk classification (LOW/MEDIUM/HIGH) is now the standard column on every attribute glossary. Future field additions land in attributes.md FIRST, with a Cardinality risk decision recorded in the same PR."
  - "Scrubber denylist + cardinality denylist are tracked as related-but-distinct lists. Cardinality is a superset of PII (every PII value is high-card; not every high-card value is PII — requestId is the canonical counter-example)."
requirements-completed: [DOC-04]

duration: ~12min
completed: 2026-04-28
---

# Phase 23 Plan 02: Observability concept docs (Wave 2) Summary

**Shipped 4 observability concept docs under `docs/observability/` (README + attributes + cardinality + trace-propagation), atomically bumped the validate-docs.ts Mermaid floor literal from 8 to 11, and turned the Wave-0 RED `observability-docs-present.test.ts` GREEN (5/5 pass).**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-28T20:07:00Z (approx)
- **Completed:** 2026-04-28T20:19:36Z
- **Tasks:** 3 / 3
- **Files modified:** 5 (4 created + 1 modified)

## Accomplishments

- 4 markdown files live under `docs/observability/` with verified file:line citations using the corrected paths from RESEARCH Finding 2.
- Mermaid floor literal raised from 8 to 11 in `scripts/validate-docs.ts` IN THE SAME PLAN's commit chain as the 3 new diagrams (Research Finding 5 atomicity satisfied).
- `bun run validate` passes — exactly 11 Mermaid blocks across docs/ (4 architecture + 4 integrations + 2 trace-propagation + 1 README, with 1 buffer).
- `bun test scripts/__tests__/observability-docs-present.test.ts` 5/5 GREEN (was 1 pass / 4 fail in Wave-0 RED state from Plan 23-01).
- `bun test scripts/__tests__/validate-docs.test.ts` 9/9 GREEN — Plan 23-01's invariants intact, no regression.

## Final line counts

| File | Lines |
| --- | --- |
| docs/observability/README.md | 32 |
| docs/observability/attributes.md | 69 |
| docs/observability/cardinality.md | 68 |
| docs/observability/trace-propagation.md | 121 |

All four files exceed the `min_lines` thresholds in the plan's `must_haves.artifacts` block (25 / 60 / 50 / 80 respectively).

## Final Mermaid block count: 11

- `docs/architecture.md` — 4 blocks (pre-existing)
- `docs/integrations/{better-auth, billing, bullmq, email}.md` — 1 block each (4 total, pre-existing)
- `docs/observability/trace-propagation.md` — 2 blocks (sequenceDiagram + stateDiagram-v2)
- `docs/observability/README.md` — 1 block (flowchart)

`bun run validate` output: `[validate-docs] OK: found 11 Mermaid fenced blocks across docs/ (>= 11 required).`

## Verbatim Mermaid fidelity (RESEARCH §Q3)

Both diagram blocks in `trace-propagation.md` were copied verbatim from the plan's `<context>` block (which itself quotes RESEARCH §Q3):

- **Diagram 1 (sequenceDiagram):** 12 participants + 11 numbered steps + 4-segment carrier hop + response-side traceparent emission. Zero divergence from the source text.
- **Diagram 2 (stateDiagram-v2):** 5 states (NoFrame, ActiveFrame, ForkedFrame, EnqueueBoundary, WorkerSeeded) + 9 transitions + the two mandated `note right of` blocks (the `enterWith` lint-ban note and the W3C-carrier-shape note with the `wrap-queue.ts:74-83` citation). Zero divergence.
- **Diagram 3 (README flowchart):** verbatim from the plan's `<context>` Diagram 3 — `Code → Ports → Adapters` plus the parallel `Code → Wrappers → Ports` path, with 6 concrete code-identifier labels (obsContext, wrapQueue, wrapProcessorWithAls, SentryErrorTracker, PinoErrorTracker, NoopAdapters).

## Verified file:line references at exec time (2026-04-28)

Re-verified during Task 1/2 implementation against working-tree HEAD `d45cd5b`:

| Cited path:lines | Verified content | Cited from |
| --- | --- | --- |
| `packages/observability/src/context.ts:43-51` | ObservabilityContext interface (7 fields, last is optional) | attributes.md (1x) |
| `packages/observability/src/context.ts:57` | `export const obsContext = new AsyncLocalStorage<ObservabilityContext>()` | trace-propagation.md (1x) |
| `packages/observability/src/wrappers/wrap-queue.ts:74-83` | carrier injection block (`propagation.inject(...)` + `dataWithCarrier` literal) | trace-propagation.md (5x — two stateDiagram notes + walkthrough + 5-line snippet + cross-link), attributes.md (1x indirectly via narrative) |
| `packages/observability/src/wrappers/wrap-queue.ts:55-59` | D-09 short-circuit when `obsContext.getStore()` is undefined | trace-propagation.md (1x) |
| `packages/observability/src/wrappers/wrap-queue.ts:87-89` | `messaging.message.id` setAttribute on producer span | attributes.md (1x) |
| `packages/observability/src/lib/scrub-pii.ts:34-52` | DEFAULT_DENY_KEYS array (17 keys) | cardinality.md (2x), attributes.md (1x) |
| `packages/observability/src/lib/scrub-pii.ts:34-38` | First 5 keys of denylist (snippet) | cardinality.md (1x — snippet + source comment) |
| `packages/queue/src/index.ts:85-130` | wrapProcessorWithAls function body | trace-propagation.md (1x) |
| `packages/queue/src/index.ts:148-160` | createWorker function | trace-propagation.md (1x) |

The two CONTEXT.md WRONG paths NEVER appear in any deliverable:

- `grep -c "packages/queue/src/wrap-queue.ts"` across all 4 new docs returns **0**.
- `grep -c "packages/observability/src/lib/obs-context.ts"` across all 4 new docs returns **0**.

## Task Commits

Each task was committed atomically:

1. **Task 1: README + attributes glossary** — `ce8bd59` (docs)
2. **Task 2: cardinality + trace-propagation** — `cc31caa` (docs)
3. **Task 3: Mermaid floor 8 → 11** — `8089e76` (feat)

**Plan metadata commit:** to follow this SUMMARY.

## Files Created/Modified

### Created

- `docs/observability/README.md` — Observability concept index. H1 + 1-paragraph intro naming the v1.3 stack (ports / adapters / wrappers / ALS), 1 Mermaid flowchart showing where observability lives in the code, Reading Order, Contents table, Scope.
- `docs/observability/attributes.md` — Canonical glossary. 4-line opener, General Rules (5 bullets), verbatim ObservabilityContext snippet from `context.ts:43-51`, 5-column glossary table (Name | Lives on | Type | Example value | Cardinality risk) covering 11 fields, Field notes, Cross-references.
- `docs/observability/cardinality.md` — Cardinality rules + 9-value HIGH-card list (tenantId / userId / requestId / email / command / queryName / jobId / stripeCustomerId / pagarmeCustomerId), scrub-pii.ts:34-38 verbatim snippet, anti-patterns (4 examples including matched-route-template fix), OTLP forward-looking note, Cross-references.
- `docs/observability/trace-propagation.md` — 2 verbatim Mermaid diagrams (sequenceDiagram with 12 participants + stateDiagram-v2 with 5 states + 9 transitions + 2 note blocks), 4-paragraph walkthrough of Diagram 1 + 3-paragraph walkthrough of Diagram 2, verbatim 10-line carrier-injection snippet from `wrap-queue.ts:74-83`, Cross-references.

### Modified

- `scripts/validate-docs.ts` — Mermaid floor literal `8 → 11` in the if-condition (line 185), error message updated to reference 11 + new sources, JSDoc invariant 3 documentation updated. No other changes; Plan 01's 4th invariant (Pass A + Pass B) untouched.

## Decisions Made

- **Honored RESEARCH Finding 2 paths exclusively.** Every citation in the 4 docs uses the verified paths from RESEARCH "File Refs Verified" (2026-04-28). The CONTEXT.md WRONG paths appear zero times. This was a non-negotiable invariant of the plan and was satisfied.
- **Verbatim Mermaid copy from RESEARCH §Q3.** No improvisation. The two `note right of` blocks in the stateDiagram-v2 were preserved including the file:line reference inside the second note (validates the W3C carrier shape claim against verifiable source).
- **5-line snippet format with source comment.** Each embedded code snippet starts with `// From <path>:<lo>-<hi>` so future refactors that move these symbols surface the drift in code review (T-23-08 mitigation per the plan's threat model).
- **Forward-looking cross-links to `../runbooks/otel-exporter-failing.md` are intentional and harmless.** Pass A's gate is `relPath.startsWith("docs/runbooks/")`, so links FROM `docs/observability/` to `docs/runbooks/` are not validated by Pass A. Plan 23-03 ships the target.

## Deviations from Plan

None - plan executed exactly as written.

The plan stated the Mermaid floor literal lived at line 69 of `scripts/validate-docs.ts`. After Plan 23-01's refactor (CLI body wrapped in `if (import.meta.main)` and helpers extracted), the literal had moved to line 185. The plan's `<action>` text accurately described the textual change required (`if (mermaidTotal < 8) {` → `if (mermaidTotal < 11) {` plus the error message update plus the JSDoc invariant-3 line); only the line number was stale. The acceptance grep `grep -c "if (mermaidTotal < 11)"` returns the expected 1 regardless of line number, so this was not a deviation requiring an entry — the exact textual transform from the plan was applied without modification.

The plan's done criterion stated `bun test scripts/__tests__/validate-docs.test.ts continues to pass 7/7`; the actual file has 9 tests (the `_slugs.ts` consistency check and the JSON-comment negative test land outside the original Plan-01 7-test scope). All 9 pass; this is GREENER than the plan called for, not a regression.

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** Clean execution. All 3 tasks landed in 3 atomic commits. No Rule 1/2/3/4 triggers.

## Issues Encountered

None.

## User Setup Required

None — pure documentation + 1-line validator literal change. No env vars, no external services, no migrations.

## Next Phase Readiness

- **Plan 23-03 (Wave 2 sibling): runbooks** — 9 incident runbooks land under `docs/runbooks/`. Each runbook can deep-link to `attributes.md`, `cardinality.md`, and `trace-propagation.md` anchors. Pass A in the validator will validate those cross-runbook links AT MERGE TIME. The 4 docs/observability/ files this plan ships are now stable targets.
- **Plan 23-04 (Wave 2 sibling): Sentry alert JSON templates** — Each `runbook_url` field on the 9 alert templates can link to `docs/runbooks/<slug>.md`, which in turn cross-links back to `docs/observability/`. Pass B (Sentry alert template `runbook_url` integrity) is independent of this plan but composes with it.
- **Plan 23-05 (Wave 3): Phase close + CI smoke check** — Inherits the now-bumped Mermaid floor of 11. The next addition to the floor (e.g., a v1.4+ dashboards-and-alerts.md with diagrams) will require a similar atomic bump.

## Self-Check: PASSED

- FOUND: docs/observability/README.md
- FOUND: docs/observability/attributes.md
- FOUND: docs/observability/cardinality.md
- FOUND: docs/observability/trace-propagation.md
- FOUND modified: scripts/validate-docs.ts (line 185 literal `< 11`, line 13 JSDoc `at least 11 Mermaid`, line 187 error message `floor is 11`)
- FOUND commit: ce8bd59 (docs Task 1 — README + attributes)
- FOUND commit: cc31caa (docs Task 2 — cardinality + trace-propagation)
- FOUND commit: 8089e76 (feat Task 3 — Mermaid floor 8 → 11)
- VALIDATOR: `bun run validate` exits 0 with `OK: found 11 Mermaid fenced blocks across docs/ (>= 11 required)`
- TESTS: observability-docs-present.test.ts 5/5 GREEN (was 1/5 in Plan 01 close), validate-docs.test.ts 9/9 GREEN (no regression)

---
*Phase: 23-runbooks-alert-templates-observability-docs*
*Completed: 2026-04-28*
