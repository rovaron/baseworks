---
phase: 24-foundation-storage-port-files-schema-moduledefinition-extens
plan: 03
subsystem: shared
tags: [shared, module-definition, file-relations, types, typescript, tdd]

# Dependency graph
requires:
  - phase: 24-foundation-storage-port-files-schema-moduledefinition-extens
    plan: 01
    provides: "ImageVariantSpec canonical declaration in @baseworks/shared (landed early per soft cross-plan dependency)"
provides:
  - "FileRelation interface in @baseworks/shared (recordType + allowedMimeTypes + maxByteSize required; generateVariants/onDelete/canRead/canWrite optional)"
  - "ModuleDefinition.fileRelations?: Record<string, FileRelation> additive optional field"
  - "FileRelation re-exported from @baseworks/shared barrel"
affects:
  - 24-05 (fileRelations registry consumes FileRelation type — `import { FileRelation } from \"@baseworks/shared\"`)
  - 24-06 (registry.ts wire-up imports FileRelation transitively via shared)
  - 25-* (real adapters consume the FileRelation contract for sign-upload validation)
  - 26-* (files module uses canRead/canWrite hooks per request)
  - 27-* (cascade-on-delete reads onDelete; ATT-02 read hook)
  - 28-* (image transform jobs consume FileRelation.generateVariants)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Type ownership — FileRelation lives in @baseworks/shared (zero workspace deps); @baseworks/storage will import from shared, not own a local copy"
    - "Additive interface extension — new optional field on ModuleDefinition does not break existing modules"
    - "Threat-model encoding in TypeScript — FileRelation requires recordType/allowedMimeTypes/maxByteSize at compile time (T-24-03-01); ImageVariantSpec.format excludes SVG (T-24-03-03 / T-24-01-02)"
    - "Type-only TDD — RED gate is `tsc --noEmit` (TS2305/TS2353/TS2339), not `bun test` (types are runtime-erased)"

key-files:
  created:
    - packages/shared/src/__tests__/module-types.test.ts
  modified:
    - packages/shared/src/types/module.ts
    - packages/shared/src/index.ts

key-decisions:
  - "ImageVariantSpec NOT redeclared — verified Plan 24-01 already canonicalized it in @baseworks/shared (lines 84-95 of module.ts pre-edit). Plan 24-03's task to define ImageVariantSpec is therefore auto-resolved by prior plan; only FileRelation + the fileRelations? field were new work."
  - "FileRelation hooks `canRead`/`canWrite` typed `(ctx: any, recordId: string)` — plan-locked decision to avoid an import cycle with cqrs.ts in @baseworks/shared. Phase 26 will narrow the ctx type at the consumer boundary."
  - "Pre-existing TS errors in packages/modules/auth (24) and packages/modules/billing (57) are out of scope — same counts before and after this plan; no errors reference FileRelation/fileRelations/ImageVariantSpec. @baseworks/shared and packages/modules/example (the canonical reference module) tsc clean (exit 0)."
  - "Pre-existing biome `noExplicitAny` warnings on lines 32-36 (routes/commands/queries) NOT in scope. Two new `any` usages on FileRelation hook signatures (lines 73, 75) are plan-mandated and documented in the JSDoc."

requirements-completed: [MOD-01]

# Metrics
duration: 4min
completed: 2026-05-07
---

# Phase 24 Plan 03: ModuleDefinition fileRelations Extension Summary

**Extended `ModuleDefinition` with an additive optional `fileRelations?: Record<string, FileRelation>` field and locked the `FileRelation` contract type in `@baseworks/shared`; module authors can now declare polymorphic file relations on their modules without depending on `@baseworks/storage`.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-07T10:29:09Z
- **Completed:** 2026-05-07T10:32:57Z
- **Tasks:** 1 (type="auto", tdd="true")
- **Files affected:** 3 (1 created + 2 modified)

## Accomplishments

- `FileRelation` interface lives in `packages/shared/src/types/module.ts` with all four required fields (`recordType: string`, `allowedMimeTypes: string[]`, `maxByteSize: number`, plus optional `generateVariants?: ImageVariantSpec[]`, `onDelete?: "cascade" | "orphan"`, `canRead?`, `canWrite?`).
- `ModuleDefinition.fileRelations?: Record<string, FileRelation>` added as a peer of `health?` — purely additive, no breaking change to existing module authors.
- `FileRelation` re-exported from `packages/shared/src/index.ts` alongside the existing `ImageVariantSpec` re-export.
- Type-level TDD gate sequence honored: RED commit (TS2305/TS2353/TS2339 errors at `tsc --noEmit`) → GREEN commit (4 tests pass at runtime + tsc clean).
- `bun --cwd packages/shared tsc --noEmit` exits 0; `bun test packages/shared/src/__tests__/module-types.test.ts` 4/4 pass.
- **`@baseworks/shared`** now provides the canonical home for the entire FileRelation contract (per PATTERNS line 762 type-ownership decision); Plan 24-05's registry collector will `import { FileRelation } from "@baseworks/shared"` rather than declaring a local copy.

## Task Commits

Each step committed atomically on `main`:

1. **Task 24-03-01 RED:** `d4694a5` — `test(24-03): add failing fileRelations type tests`
2. **Task 24-03-01 GREEN:** `337285d` — `feat(24-03): add FileRelation type and extend ModuleDefinition with fileRelations?`

## Files Created/Modified

**Created:**
- `packages/shared/src/__tests__/module-types.test.ts` — 4 type-level tests covering: (1) module without fileRelations type-checks, (2) module with full fileRelations literal type-checks, (3) FileRelation minimal required fields, (4) ImageVariantSpec.format excludes SVG (verified via `// @ts-expect-error` directive).

**Modified:**
- `packages/shared/src/types/module.ts` — Added `FileRelation` interface (lines 47-76) and `fileRelations?: Record<string, FileRelation>` field on `ModuleDefinition` (line 44). All existing fields preserved exactly. Biome auto-format applied (LF endings).
- `packages/shared/src/index.ts` — Added `FileRelation` to the named re-export list from `./types/module`. Biome auto-format applied.

## Decisions Made

- **ImageVariantSpec NOT redeclared.** Per the prior_wave_context, Plan 24-01 already canonicalized `ImageVariantSpec` in `@baseworks/shared` (one plan ahead of the original schedule, to satisfy a soft cross-plan dependency in sequential execution). Verified before any edits: `packages/shared/src/types/module.ts` already contained the full `ImageVariantSpec` interface with the locked `format: "webp" | "jpeg" | "png"` union (T-24-01-02 mitigation), JSDoc citing Plan 24-01, and a re-export already in place. Plan 24-03's task to "define ImageVariantSpec" is therefore an auto-resolved no-op; only `FileRelation` + the `fileRelations?` field needed new code. Documented as Deviation #1 below.
- **`canRead` / `canWrite` typed `(ctx: any, recordId: string) => Promise<boolean>`.** The plan explicitly mandates this `any` to avoid a cqrs.ts import cycle inside `@baseworks/shared`. The JSDoc documents the expected `HandlerContext` shape; Phase 26 will narrow the type at the consumer boundary. Two `noExplicitAny` biome warnings on lines 73/75 are plan-allowed.
- **Biome auto-format applied to all three modified files.** Files were originally written with CRLF line endings (Windows default); biome's format rule requires LF. Applied `bun x biome format --write` to align with project style. Test file then re-flowed onto fewer lines (5 → 2 for the import, etc.). All 4 tests still pass.

## Deviations from Plan

### Auto-resolved by Prior Plan

**1. [Auto-resolved] Plan 24-03's "define ImageVariantSpec" task already done by Plan 24-01**
- **Found during:** Step 0 (read-before-edit of `packages/shared/src/types/module.ts`)
- **Issue:** Plan 24-03 instructs us to add `ImageVariantSpec` to `@baseworks/shared`, but Plan 24-01's SUMMARY (and the file itself) already contains the canonical declaration verbatim — same shape, same `format: "webp" | "jpeg" | "png"` union, same JSDoc citing T-24-01-02. Plan 24-01 did this to resolve a soft cross-plan dependency in sequential execution mode.
- **Resolution:** Did NOT redeclare. Verified the existing declaration matches the plan's locked shape exactly (5 fields: `name`, `width`, `height?`, `format`, `quality?`). The re-export from `packages/shared/src/index.ts` was also already in place from Plan 24-01.
- **Files affected:** None — no edit needed.
- **Net effect on this plan:** Saved one entire interface declaration; only `FileRelation` + `fileRelations?` field were new work.

### Auto-fixed Issues

**2. [Rule 3 - Blocking] Biome auto-format (CRLF → LF + line wrapping)**
- **Found during:** Plan-wide post-task verification (`bun x biome format`)
- **Issue:** All three modified files used CRLF line endings (Windows default) and the test file's import statement was wrapped across 5 lines; biome's format rule rejected both.
- **Fix:** Ran `bun x biome format --write packages/shared/src/types/module.ts packages/shared/src/index.ts packages/shared/src/__tests__/module-types.test.ts`. Same pattern Plan 24-01 used (commit `ea58141`).
- **Files modified:** All three files in this plan.
- **Verification:** `bun test packages/shared/src/__tests__/module-types.test.ts` 4/4 still pass after format.
- **Committed in:** `337285d` (folded into the GREEN commit since RED → GREEN was contiguous).

---

**Total deviations:** 1 auto-resolved (no work needed) + 1 auto-fixed (formatting). Zero scope creep, zero surface deviation from the plan-locked contract.

## Issues Encountered

- **Pre-existing TS errors in `packages/modules/auth` (24) and `packages/modules/billing` (57)** — out of scope per SCOPE BOUNDARY. Verified by stashing this plan's changes and re-running tsc on the parent commit: error counts were 24 and 57 BEFORE my changes, and remain 24 and 57 AFTER. Zero of those errors reference `FileRelation`, `fileRelations`, or `ImageVariantSpec`. Same situation noted in 24-01-SUMMARY.md and 24-02-SUMMARY.md.
- **Plan-wide biome `noExplicitAny` warnings on lines 32-36 (`routes`, `commands`, `queries` in ModuleDefinition)** — pre-existing, not introduced by this plan. The two new `any` usages on `FileRelation.canRead/canWrite` (lines 73/75) are plan-mandated to avoid the cqrs.ts cycle and are documented inline.

## User Setup Required

None — pure type-extension. No env vars, no external services, no database changes, no runtime side-effects.

## Next Phase Readiness

- **Plan 24-04** (factory + adapter scaffolds) — no dependency on this plan's work.
- **Plan 24-05** (fileRelations registry collector) — can now `import { FileRelation } from "@baseworks/shared"` and accept any `Record<string, FileRelation>` from a `ModuleDefinition.fileRelations` slot. Type-ownership decision is locked: storage's registry imports the type from shared, NOT the other way around (no cycle).
- **Plan 24-06** (registry.ts wire-up) — can iterate `module.fileRelations` at boot via the typed optional field.
- **Plan 24-07** (Biome GritQL ban) — unaffected.
- **Phase 25-31 modules** — can author `fileRelations: { kind: { ... } }` on their `ModuleDefinition` and TypeScript will enforce the shape at compile time.

## TDD Gate Compliance

Type-level TDD honored:

- **RED gate** — `tsc --noEmit` reported `TS2305: Module '"@baseworks/shared"' has no exported member 'FileRelation'`, `TS2353: ... 'fileRelations' does not exist in type 'ModuleDefinition'`, and `TS2339: Property 'fileRelations' does not exist on type 'ModuleDefinition'` (3 errors before any implementation). RED test commit: `d4694a5`.
- **GREEN gate** — `tsc --noEmit` clean (exit 0); `bun test` 4/4 passing including the `// @ts-expect-error` SVG-rejection assertion. GREEN feat commit: `337285d`.
- **REFACTOR gate** — none needed; pure type declaration. Biome auto-format folded into the GREEN commit (cosmetic only).

Note: `bun test` alone does not catch the RED state for type-only contracts (TypeScript types are erased at runtime). The actual RED gate is `tsc --noEmit` — same observation as Plan 24-01.

## Self-Check: PASSED

All claimed files exist; all 2 plan commits present in git history.

```
$ test -f packages/shared/src/__tests__/module-types.test.ts                  → FOUND
$ test -f packages/shared/src/types/module.ts                                 → FOUND
$ test -f packages/shared/src/index.ts                                        → FOUND
$ git log --oneline | grep -q d4694a5  (RED test)                             → FOUND
$ git log --oneline | grep -q 337285d  (GREEN feat)                           → FOUND
$ grep -q 'export interface FileRelation' packages/shared/src/types/module.ts → FOUND
$ grep -q 'fileRelations?: Record<string, FileRelation>' .../module.ts        → FOUND
$ grep -q 'FileRelation' packages/shared/src/index.ts                         → FOUND
$ bun test packages/shared/src/__tests__/module-types.test.ts                 → 4/4 PASS
$ bun --cwd packages/shared tsc --noEmit                                      → EXIT 0
```

---
*Phase: 24-foundation-storage-port-files-schema-moduledefinition-extens*
*Completed: 2026-05-07*
