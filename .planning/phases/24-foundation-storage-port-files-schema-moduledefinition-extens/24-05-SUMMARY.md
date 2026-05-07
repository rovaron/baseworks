---
phase: 24-foundation-storage-port-files-schema-moduledefinition-extens
plan: 05
subsystem: storage
tags: [storage, registry, file-relations, zod, singleton, tdd, file-storage]

# Dependency graph
requires:
  - phase: 24-foundation-storage-port-files-schema-moduledefinition-extens
    plan: 01
    provides: "@baseworks/storage package skeleton + barrel"
  - phase: 24-foundation-storage-port-files-schema-moduledefinition-extens
    plan: 03
    provides: "FileRelation interface + ModuleDefinition.fileRelations? in @baseworks/shared (canonical type home)"
provides:
  - "FileRelationsRegistry class with register/get/getAll/reset (process-wide singleton fileRelationsRegistry per D-06)"
  - "Two-level key scheme `${ownerModule}:${kind}` (D-08) — disambiguates modules sharing kind names"
  - "Zod runtime validation gate (D-07) on every register() — invalid shape throws with module + kind + Zod error context"
  - "collectFileRelations(modules) collector — walks Iterable<[name, ModuleDefinition]>, skips modules without fileRelations, propagates Zod errors with module + kind context"
  - "Barrel re-exports for both symbols from @baseworks/storage"
affects:
  - 24-06 (ModuleRegistry.loadAll() wires collectFileRelations() right after the existing def.health collection block per D-09)
  - 26-* (files module reads the populated fileRelationsRegistry to enforce sign-upload allowedMimeTypes / maxByteSize)
  - 27-* (cascade-on-delete reads onDelete from registered relations; ATT-02 reads canRead hook)
  - 28-* (image-transform jobs read generateVariants from registered relations)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Process-wide singleton class instance exported from a module-level const (mirrors observability heartbeat publisher; adds reset() for test isolation)"
    - "Two-level registry key `${ownerModule}:${kind}` — colon separator forbidden in module names by upstream conventions, structurally prevents cross-module collision"
    - "Zod safeParse + manual error throw with module + kind context (CQRS/better-auth fail-loud pattern) instead of letting Zod throw raw — guarantees error messages name the offending module"
    - "Optional-iterable collector — `for...of Iterable<[string, ModuleDefinition]>`; skip silently when def.fileRelations is undefined (matches optional ModuleDefinition field semantics)"

key-files:
  created:
    - packages/storage/src/registry.ts
    - packages/storage/src/__tests__/registry.test.ts
  modified:
    - packages/storage/src/index.ts (re-exports collectFileRelations + fileRelationsRegistry)

key-decisions:
  - "Imported FileRelation + ModuleDefinition from @baseworks/shared, NOT a local copy. Plan 24-03 declared shared as the canonical type owner; the registry consumes the contract type as a downstream dependency."
  - "Zod schema validates hooks `canRead` / `canWrite` as `z.any()` (T-24-05-04 disposition: accept). Function arity validation isn't worth runtime cost; Phase 26 consumer is responsible for invoking hooks safely (and `any` matches the type's plan-locked declaration in shared)."
  - "Re-register on same (ownerModule, kind) key OVERWRITES — last write wins. Documented behavior; matches existing CQRS register pattern. Tested explicitly so a future maintainer can't change semantics silently."
  - "Biome auto-format moved the `export { collectFileRelations, fileRelationsRegistry } from './registry'` line to the bottom of the barrel (alphabetical-aware ordering). The Plan 24-04 SUMMARY anticipated this and it landed cleanly — all greps pass on the literal symbol names; the line position is purely cosmetic."

requirements-completed: [MOD-01]

# Metrics
duration: 2min
completed: 2026-05-07
---

# Phase 24 Plan 05: fileRelationsRegistry + collectFileRelations Summary

**Shipped the `fileRelationsRegistry` singleton and `collectFileRelations()` collector inside `@baseworks/storage`, with Zod runtime validation (D-07) and the two-level `${ownerModule}:${kind}` key scheme (D-08). The boot loop (Plan 24-06) can now collect every module's `fileRelations` declaration into a single, fail-loud-validated registry that Phase 26's files module reads at sign-upload time.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-05-07T10:52:36Z
- **Completed:** 2026-05-07T10:54:12Z
- **Tasks:** 1 (type="auto", tdd="true")
- **Files affected:** 3 (2 created + 1 modified)
- **Tests:** 11 new tests in `registry.test.ts`; 90 total tests in `packages/storage` (11 new + 79 pre-existing from Plans 24-01 / 24-04)

## Accomplishments

### Registry class + singleton (Task 24-05-01)
- `FileRelationsRegistry` class in `packages/storage/src/registry.ts` exposes `register(ownerModule, kind, relation)`, `get(ownerModule, kind)`, `getAll()` (read-only Map snapshot), `reset()`.
- Module-level `fileRelationsRegistry` const is the process-wide singleton (D-06). Single instance shared across all consumers; `reset()` enables test isolation.
- Internal storage is a `Map<string, FileRelation>` keyed by `${ownerModule}:${kind}` (D-08). The `:` separator is forbidden in module names by upstream module-loading conventions, so two distinct modules with the same `kind` (e.g., `auth:user` and `billing:user`) keep distinct entries — verified by Test 3.

### Zod fail-loud validation (D-07)
- `fileRelationSchema` in `registry.ts` validates every `register()` call:
  - `recordType: z.string().min(1)` — non-empty.
  - `allowedMimeTypes: z.array(z.string().min(1)).min(1)` — array of non-empty strings, length ≥ 1.
  - `maxByteSize: z.number().int().positive()` — positive integer.
  - `generateVariants: z.array(imageVariantSpecSchema).optional()` — each variant validates against `imageVariantSpecSchema` which restricts `format` to `webp | jpeg | png` (T-24-03-03 / IDA-02 — SVG structurally rejected at runtime, mirrors the compile-time rejection from Plan 24-03).
  - `onDelete: z.enum(["cascade", "orphan"]).optional()`.
  - `canRead` / `canWrite: z.any().optional()` — function arity is not validated at runtime (T-24-05-04 accept).
- On `safeParse` failure, throws `Error("Invalid FileRelation for module=\"${ownerModule}\" kind=\"${kind}\": ${parsed.error.message}")` — the assertion `.toThrow(/auth.*user/)` in 4 negative-path tests confirms both module name AND kind appear in the error string.

### collectFileRelations() collector
- `collectFileRelations(modules: Iterable<[string, ModuleDefinition]>)` walks any iterable of `[moduleName, def]` pairs (e.g., `Map.entries()`).
- Modules without `def.fileRelations` are skipped silently — matches the optional field semantics in `@baseworks/shared`. Test 9 verifies a module with `name: "billing"` and no `fileRelations` produces zero entries.
- Modules with `def.fileRelations` are iterated via `Object.entries(def.fileRelations)`; each `(kind, relation)` pair is forwarded to `fileRelationsRegistry.register(moduleName, kind, relation)`. Zod errors thrown by `register()` propagate up to the boot loop with the offending module + kind context already encoded.

### Barrel re-exports
- `packages/storage/src/index.ts` re-exports both symbols: `export { collectFileRelations, fileRelationsRegistry } from "./registry";`. Biome's import-sort moved the line to the bottom of the file (alphabetical-aware ordering across mixed export blocks); functionally equivalent — the symbols are importable from `@baseworks/storage` directly, which the test file proves at line 3.

## Task Commits

Each step committed atomically on `main` with TDD gate sequence honored:

1. **Task 24-05-01 RED:** `4dcf2c1` — `test(24-05): add failing tests for fileRelationsRegistry + collectFileRelations`
2. **Task 24-05-01 GREEN:** `f2844dd` — `feat(24-05): add fileRelationsRegistry singleton + collectFileRelations collector`

## Files Created/Modified

**Created (2):**
- `packages/storage/src/registry.ts` — `FileRelationsRegistry` class + `fileRelationsRegistry` singleton + `collectFileRelations()` collector + Zod schemas (`fileRelationSchema`, `imageVariantSpecSchema`).
- `packages/storage/src/__tests__/registry.test.ts` — 11 tests: empty-after-reset, register/get round-trip, two-module disambiguation, last-write-wins overwrite, 4 Zod fail-loud paths (empty recordType, empty mime list, non-positive maxByteSize ×2, SVG format), collectFileRelations skip-empty, collectFileRelations propagates errors with context, reset() empties.

**Modified (1):**
- `packages/storage/src/index.ts` — Added `export { collectFileRelations, fileRelationsRegistry } from "./registry";` (positioned at bottom of file by Biome auto-format; barrel preserves all 24-04 exports — factory functions, env validator, adapter scaffold classes, port types).

## Decisions Made

- **Type ownership: import from `@baseworks/shared`, do NOT re-declare locally.** Plan 24-03's SUMMARY locked `FileRelation` and `ModuleDefinition` as canonical residents of `@baseworks/shared` (both types live in `packages/shared/src/types/module.ts`). The registry consumes the contract — it doesn't own it. The grep `from "@baseworks/shared"` in `registry.ts` is the structural witness; the test file imports `FileRelation`/`ModuleDefinition` from `@baseworks/shared` and `fileRelationsRegistry`/`collectFileRelations` from `@baseworks/storage`, which is the exact two-package import shape Phase 26's files module will use.
- **Hook signatures validated as `z.any()`.** `FileRelation.canRead` and `canWrite` are `(ctx: any, recordId: string) => Promise<boolean>` per Plan 24-03 (the `any` is plan-mandated to avoid a cqrs.ts import cycle in shared). At runtime, validating a function's arity via Zod is heavyweight and brittle; we accept the threat (T-24-05-04 disposition: `accept`) and let Phase 26 enforce hook arity at the consumer boundary where `HandlerContext` is in scope.
- **Re-register OVERWRITES (last-write-wins).** Test 4 asserts this explicitly. Matches the existing CQRS `register` pattern in `apps/api/src/core/registry.ts`. Documented in registry JSDoc and pinned by a test so a future maintainer can't change semantics without breaking the test suite.
- **Biome import-sort cosmetic re-order.** The original Plan 24-04 SUMMARY's "Next Phase Readiness" section anticipated that biome would re-order the appended export block. The actual outcome: the registry line landed at the very bottom of `index.ts`, NOT adjacent to the other adapter-scaffold exports. Cosmetically fine; structurally identical (the symbols are correctly importable from `@baseworks/storage`); all verify greps pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Biome auto-format applied to all three plan files**
- **Found during:** Post-GREEN verify (`bun x biome check --write`)
- **Issue:** Files were originally written with default formatting; Biome wanted: (a) the registry-export line moved to the bottom of `index.ts` (alphabetical-aware sort order across mixed export blocks), (b) the `collectFileRelations` function signature collapsed onto a single line (Biome line-width limit allows it), (c) imports in `registry.ts` reordered (`import type` from `@baseworks/shared` before the `zod` import per Biome's import-group convention).
- **Fix:** `bun x biome check --write packages/storage/src/registry.ts packages/storage/src/__tests__/registry.test.ts packages/storage/src/index.ts` — Biome reported `Fixed 2 files`. Tests still pass; verify-chain greps still match (they target literal symbol names, not layout).
- **Files modified:** `packages/storage/src/index.ts`, `packages/storage/src/registry.ts`. The test file was already biome-clean.
- **Verification:** All 90 storage tests pass; tsc exit 0; `grep -c "fileRelationsRegistry" index.ts == 1`, `grep -c "collectFileRelations" index.ts == 1`, `grep -c "z.object" registry.ts == 2`, `grep -c "@baseworks/shared" registry.ts == 2`.
- **Folded into:** GREEN commit `f2844dd`.

---

**Total deviations:** 1 auto-fixed (cosmetic formatting). Zero scope creep, zero contract surface deviation.

## Issues Encountered

- **Pre-existing CRLF/LF warnings on git add** — Same Windows-vs-LF convention as prior plans (24-01 / 24-03 / 24-04). `core.autocrlf` config-gate; files commit with LF. Not a deviation.
- **No pre-existing test or tsc failures introduced by this plan** — `bun test packages/storage` clean (90/90); `bun tsc --noEmit` exit 0 from `packages/storage/`.
- Pre-existing TS errors in `packages/modules/auth` and `packages/modules/billing` remain (out of scope per SCOPE BOUNDARY; same as 24-03 / 24-04 SUMMARY).

## User Setup Required

None — pure code implementation. The registry is collected at boot by Plan 24-06's wire-up; no env vars, no external services, no manual steps. Module authors who declare `fileRelations` in their `ModuleDefinition` get runtime validation at boot for free.

## Next Phase Readiness

- **Plan 24-06** (boot wire-up — final plan in Wave 2) — can now `import { collectFileRelations } from "@baseworks/storage"` and add a single `collectFileRelations(this.modules.entries())` call inside `ModuleRegistry.loadAll()` at `apps/api/src/core/registry.ts`, immediately AFTER the existing `def.health` collection block (lines ~101-103 per 24-CONTEXT). Phase 26 then reads the populated registry without further wiring.
- **Phase 26** (files module / sign-upload) — call `fileRelationsRegistry.get(ownerModule, kind)` to resolve the FileRelation for an incoming sign-upload request; reject with HTTP 400 if undefined (unknown pair) or if the request's MIME type / byte size violates the relation's constraints. The two-level key scheme (D-08) is already locked.
- **Phase 27** (cascade-on-delete + ATT-02 read-hook) — iterate `fileRelationsRegistry.getAll()` to find relations with `onDelete === "cascade"` and dispatch deletes; invoke `relation.canRead(ctx, recordId)` per request before serving file metadata.
- **Phase 28** (image-transform pipeline) — iterate registered relations with `generateVariants?.length > 0` to drive transform jobs. The `format` union restriction (`webp|jpeg|png`) is enforced both at compile time (Plan 24-03) and at runtime (this plan's Zod schema) — SVG cannot reach the variant pipeline.
- **No blockers** for Wave 2's final plan (24-06).

## TDD Gate Compliance

Single task honored RED → GREEN sequence:

- **RED commit `4dcf2c1`** — `packages/storage/src/__tests__/registry.test.ts` written with 11 tests; `bun test` failed at module-load with `SyntaxError: Export named 'fileRelationsRegistry' not found in module 'C:\Projetos\baseworks\packages\storage\src\index.ts'.` (the symbols don't exist yet). Exit 1 — gate confirmed.
- **GREEN commit `f2844dd`** — `packages/storage/src/registry.ts` + barrel update; `bun test packages/storage/src/__tests__/registry.test.ts` 11/11 pass, `bun test packages/storage` 90/90 pass, `bun tsc --noEmit` exit 0. Gate confirmed without modifying the test file.
- **REFACTOR** — none needed; the implementation matches the prescribed pattern (observability heartbeat publisher class shape + reset()) directly. Biome auto-format folded into the GREEN commit (cosmetic).

## Self-Check: PASSED

All claimed files exist; both plan commits present in git history.

```
$ test -f packages/storage/src/registry.ts                       → FOUND
$ test -f packages/storage/src/__tests__/registry.test.ts         → FOUND
$ test -f packages/storage/src/index.ts                          → FOUND
$ git log --oneline | grep -q 4dcf2c1  (Task 1 RED)              → FOUND
$ git log --oneline | grep -q f2844dd  (Task 1 GREEN)            → FOUND
$ grep -q "export const fileRelationsRegistry" registry.ts       → FOUND
$ grep -q "export function collectFileRelations" registry.ts     → FOUND
$ grep -q 'z.object' registry.ts                                  → FOUND (×2)
$ grep -q 'from "@baseworks/shared"' registry.ts                  → FOUND
$ grep -q "fileRelationsRegistry" index.ts                       → FOUND
$ grep -q "collectFileRelations" index.ts                        → FOUND
$ bun test packages/storage                                       → 90 / 90 PASS
$ bun --cwd packages/storage tsc --noEmit                         → EXIT 0
```

---
*Phase: 24-foundation-storage-port-files-schema-moduledefinition-extens*
*Completed: 2026-05-07*
