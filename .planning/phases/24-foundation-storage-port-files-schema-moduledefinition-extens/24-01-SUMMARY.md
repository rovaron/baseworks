---
phase: 24-foundation-storage-port-files-schema-moduledefinition-extens
plan: 01
subsystem: storage
tags: [storage, ports, file-storage, image-transform, typescript, bun-workspace]

# Dependency graph
requires:
  - phase: 17-observability-ports
    provides: port-and-adapter pattern (packages/observability/src/ports/* shape)
  - phase: 22-health-aggregator
    provides: registry-collection pattern (ModuleDefinition.health → HealthAggregator)
provides:
  - "@baseworks/storage workspace package (port-only Phase 24 surface)"
  - "FileStorage port interface (signUpload, signRead, stat, delete, getObject, putObject)"
  - "ImageTransform port interface (resize + metadata)"
  - "SignedUpload, SignedRead, ObjectStat, ImageMetadata result types"
  - "ImageVariantSpec canonical declaration in @baseworks/shared (declared early to satisfy soft cross-plan dep with Plan 24-03)"
  - "Re-export of ImageVariantSpec from @baseworks/storage for ergonomics"
affects:
  - 24-02 (env validator and factory will consume these port types)
  - 24-04 (factory + adapter scaffolds implement FileStorage/ImageTransform)
  - 24-05 (fileRelations registry will be added to this package)
  - 25-* (real adapter bodies — LocalFileStorage, S3FileStorage, S3CompatFileStorage)
  - 26-* (files module consumes the port and registry)
  - 28-* (sharp/imagescript ImageTransform adapter bodies)

# Tech tracking
tech-stack:
  added:
    - "@baseworks/storage workspace (private, type-only Phase 24)"
    - "zod ^3.23.0 (declared in storage package.json for Plan 24-05 registry validator)"
  patterns:
    - "Port-and-adapter — ports under src/ports/, adapters arrive in Phase 25/28"
    - "Type ownership — types with zero workspace deps live in @baseworks/shared, re-exported from feature packages for ergonomics"
    - "Header doc citing phase / decision IDs (Phase 24 / FILE-01 / D-XX)"
    - "Threat-model encoding in TypeScript unions (ImageVariantSpec.format excludes SVG → T-24-01-02)"

key-files:
  created:
    - packages/storage/package.json
    - packages/storage/tsconfig.json
    - packages/storage/src/index.ts
    - packages/storage/src/ports/types.ts
    - packages/storage/src/ports/file-storage.ts
    - packages/storage/src/ports/image-transform.ts
    - packages/storage/src/__tests__/ports.test.ts
  modified:
    - tsconfig.json (added @baseworks/storage paths mapping)
    - packages/shared/src/types/module.ts (added ImageVariantSpec interface)
    - packages/shared/src/index.ts (re-exported ImageVariantSpec)
    - bun.lock (regenerated for new workspace)

key-decisions:
  - "ImageVariantSpec declared in @baseworks/shared during Plan 24-01 (not waiting for 24-03) — sequential execution forced the soft cross-plan dependency to resolve early; Plan 24-03 will confirm/extend the declaration."
  - "Added @baseworks/storage to root tsconfig.json paths mapping (Rule 3) — required for self-import resolution under tsc, matches the pattern already used for @baseworks/observability and other workspaces."
  - "SignedUpload/SignedRead types deliberately omit storage_key — T-24-01-01 mitigation against Pitfall 1 (predictable storage keys leaking taxonomy)."
  - "ImageVariantSpec.format restricted to webp|jpeg|png — T-24-01-02 mitigation against Pitfall 10 (XSS via <script> in SVG variants)."

patterns-established:
  - "Soft cross-plan dependency resolution: when Plan A re-exports a type from Plan B's canonical home, sequential execution requires the type to land in B-package before A-package's TS check runs. Resolution is to make the canonical declaration in the dependency-target package as part of the consumer plan, leaving the canonical owner plan to confirm/extend."
  - "Workspace TS path mapping is mandatory for new @baseworks/* packages that self-import in tests."

requirements-completed: [FILE-01]

# Metrics
duration: 7min
completed: 2026-05-07
---

# Phase 24 Plan 01: Storage Port Surface Summary

**Stood up the @baseworks/storage workspace and locked the FileStorage + ImageTransform port contract that every Phase 25/28 adapter will implement against; ImageVariantSpec canonicalized in @baseworks/shared with a re-export for downstream ergonomics.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-07T10:08:51Z
- **Completed:** 2026-05-07T10:16:15Z
- **Tasks:** 3 (all type="auto", 2 with TDD)
- **Files modified:** 11 (8 created + 3 modified)

## Accomplishments

- `@baseworks/storage` workspace registered and resolvable via `bun install`; consumers (e.g., `packages/storage/node_modules/@baseworks/shared`) link correctly.
- `FileStorage` port locked with all six methods from RESEARCH §3 (`signUpload`, `signRead`, `stat`, `delete`, `getObject`, `putObject`) plus `readonly name: string`. Result types `SignedUpload`, `SignedRead`, `ObjectStat` defined with the T-24-01-01 mitigation (no `storage_key` in result shape).
- `ImageTransform` port locked with BOTH `resize` AND `metadata` (per ROADMAP success criterion #2 — research §3 only listed `resize`); `ImageMetadata` result type defined; `metadata` is required so Phase 28's decompression-bomb pre-flight check has a contract to call.
- `ImageVariantSpec` canonically declared in `@baseworks/shared` with `format: "webp" | "jpeg" | "png"` (T-24-01-02 — no SVG); re-exported from `@baseworks/storage` so downstream code can `import { ImageVariantSpec } from "@baseworks/storage"` unchanged.
- 7 port-shape tests passing under `bun test`, including Test 7 (cross-package identity test proving the storage re-export resolves to the same canonical declaration as the direct shared import).
- `bun --cwd packages/storage tsc --noEmit` clean; biome formatting clean.

## Task Commits

Each task was committed atomically:

1. **Task 24-01-01: Workspace skeleton** — `9080205` (feat)
2. **Task 24-01-02: FileStorage port (TDD)**
   - RED: `cb5667d` (test)
   - GREEN: `dd276c1` (feat)
   - Barrel + tsconfig path: `1d6cfda` (chore)
3. **Task 24-01-03: ImageTransform port + ImageVariantSpec re-export (TDD)**
   - RED: `fa4bcb9` (test)
   - Shared declaration: `237c0b3` (feat)
   - GREEN: `917908a` (feat)
4. **Plan-wide style:** `ea58141` (style — biome auto-format)

## Files Created/Modified

**Created:**
- `packages/storage/package.json` — workspace manifest with `@baseworks/shared` (`workspace:*`) + `zod` deps (sharp / @aws-sdk / Bun.S3Client deliberately deferred to Phases 25/28).
- `packages/storage/tsconfig.json` — verbatim copy of `packages/observability/tsconfig.json`.
- `packages/storage/src/index.ts` — barrel exporting all FileStorage, ImageTransform, ImageVariantSpec, ImageMetadata, SignedUpload, SignedRead, ObjectStat, StorageBucket, StorageKey types.
- `packages/storage/src/ports/types.ts` — `StorageBucket`, `StorageKey` shared port types.
- `packages/storage/src/ports/file-storage.ts` — `FileStorage`, `SignedUpload`, `SignedRead`, `ObjectStat` interfaces.
- `packages/storage/src/ports/image-transform.ts` — `ImageTransform`, `ImageMetadata` interfaces; re-exports `ImageVariantSpec` from `@baseworks/shared`.
- `packages/storage/src/__tests__/ports.test.ts` — 7 port-shape tests (4 FileStorage + 3 ImageTransform + cross-package identity).

**Modified:**
- `tsconfig.json` (root) — added `@baseworks/storage` and `@baseworks/storage/*` paths mapping.
- `packages/shared/src/types/module.ts` — added `ImageVariantSpec` interface.
- `packages/shared/src/index.ts` — re-exported `ImageVariantSpec`.
- `bun.lock` — regenerated for new workspace registration.

## Decisions Made

- **ImageVariantSpec landed early in @baseworks/shared** rather than waiting for Plan 24-03. The plan explicitly anticipated this as a "soft cross-plan dependency" and instructed retry-after-24-03 in parallel-execution mode. In sequential mode the equivalent is to land the canonical declaration as part of this plan; Plan 24-03 will find it already declared and confirm or extend.
- **tsconfig paths mapping for @baseworks/storage** added to root tsconfig.json — without it `tsc --noEmit` cannot resolve self-imports in the test file, blocking the verify step. Same pattern is already in place for `@baseworks/observability`, `@baseworks/db`, and the other workspaces.
- **No deviation from the plan-locked surface:** every method name in RESEARCH §3 plus `metadata` from ROADMAP success criterion #2 is present; no extras added; no SVG in the format union.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added @baseworks/storage paths to root tsconfig.json**
- **Found during:** Task 24-01-02 (GREEN gate `tsc --noEmit`)
- **Issue:** `bun x tsc --noEmit` failed with `TS2307: Cannot find module '@baseworks/storage'` on the test file's self-import; the new workspace was missing from the root tsconfig.json `paths` block (every other `@baseworks/*` workspace already has an entry).
- **Fix:** Appended two lines to `paths`: `"@baseworks/storage": ["./packages/storage/src"]` and `"@baseworks/storage/*": ["./packages/storage/src/*"]`.
- **Files modified:** `tsconfig.json`
- **Verification:** `bun --cwd packages/storage tsc --noEmit` exits 0 (pre-existing repo-wide errors in unrelated packages remain — out of scope).
- **Committed in:** `1d6cfda`

**2. [Rule 3 - Blocking] Declared ImageVariantSpec in @baseworks/shared**
- **Found during:** Task 24-01-03 (GREEN gate `tsc --noEmit`)
- **Issue:** Plan 24-01 re-exports `ImageVariantSpec` from `@baseworks/shared`, but the canonical declaration is owned by Plan 24-03 (not yet executed in sequential mode). The plan documents this as a "soft cross-plan dependency" and explicitly says "retry after Plan 24-03 completes — no rework needed."
- **Fix:** Added the `ImageVariantSpec` interface to `packages/shared/src/types/module.ts` with the locked `format: "webp" | "jpeg" | "png"` union (T-24-01-02), and re-exported it from the shared barrel. The declaration matches the shape published in 24-PATTERNS.md lines 740-748 verbatim, so Plan 24-03 will find an idempotent canonical declaration when it runs.
- **Files modified:** `packages/shared/src/types/module.ts`, `packages/shared/src/index.ts`
- **Verification:** `bun test packages/storage/src/__tests__` 7/7 passing including Test 7 (cross-package identity).
- **Committed in:** `237c0b3`

**3. [Rule 3 - Blocking] Applied biome auto-formatting to plan files**
- **Found during:** Plan-wide post-task verification
- **Issue:** `bunx biome check packages/storage` reported 3 formatting violations (alphabetical export ordering and union-line-width).
- **Fix:** Ran `bunx biome check --write packages/storage`; tests still pass (7/7).
- **Files modified:** `packages/storage/src/__tests__/ports.test.ts`, `packages/storage/src/index.ts`, `packages/storage/src/ports/image-transform.ts`
- **Verification:** `bunx biome check packages/storage` reports 0 issues; tests still pass.
- **Committed in:** `ea58141`

---

**Total deviations:** 3 auto-fixed (3 blocking issues, 0 missing critical, 0 bugs)
**Impact on plan:** All three were necessary to make sequential execution match the plan's parallel-execution assumption. No scope creep — the surface defined exactly matches the plan-locked contract. The early `ImageVariantSpec` landing is explicitly allowed by the plan's "soft cross-plan dependency" guidance.

## Issues Encountered

- **Pre-existing TS errors elsewhere (118 in unrelated packages — billing, queue):** out of scope per SCOPE BOUNDARY. Verified pre-existing by stashing and checking the parent commit (`934db0f` had 122 errors; this plan's work introduced none and incidentally resolved 4 by adding the storage paths mapping).
- **Pre-existing biome errors in @baseworks/shared:** out of scope; confirmed pre-existing by stashing.

## User Setup Required

None — port-only contract surface, no external services or env vars touched in this plan.

## Next Phase Readiness

- **Plan 24-02** can now `import { FileStorage, ImageTransform, ... } from "@baseworks/storage"` to build the env validator and factory against the locked contract.
- **Plan 24-03** can declare its canonical `ImageVariantSpec` and find the type already exists; the declaration in `packages/shared/src/types/module.ts` matches the planned shape verbatim, so Plan 24-03 should be a no-op or a confirm-and-extend.
- **Plan 24-04** (factory + adapter scaffolds) can implement against the FileStorage/ImageTransform interfaces.
- **No blockers** for Wave 1 continuation.

## TDD Gate Compliance

- Task 24-01-02 (FileStorage port): RED `cb5667d` (test) → GREEN `dd276c1` (feat) → REFACTOR (none needed; pure types). Commit-history gate sequence ✓.
- Task 24-01-03 (ImageTransform port): RED `fa4bcb9` (test) → GREEN `237c0b3` + `917908a` (feat) → REFACTOR `ea58141` (style auto-format). Commit-history gate sequence ✓.

Note: `bun test` alone does not catch the RED state for type-only contracts (TypeScript types are erased at runtime). The actual RED gate is `tsc --noEmit`, which correctly reported `TS2307` / `TS2305` before each port file was created. Both tasks honored the RED→GREEN→REFACTOR sequence at the type-check level.

## Self-Check: PASSED

All 11 created/modified files exist on disk; all 8 plan-related commits exist in git history. See verification block below.

---
*Phase: 24-foundation-storage-port-files-schema-moduledefinition-extens*
*Completed: 2026-05-07*
