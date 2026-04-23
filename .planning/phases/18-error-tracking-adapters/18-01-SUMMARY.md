---
phase: 18-error-tracking-adapters
plan: 01
subsystem: observability
tags: [observability, config, env, dependencies, sentry, glitchtip, pino]
requires:
  - packages/config/src/env.ts (pre-Phase-18 ERROR_TRACKER noop-only enum + empty validator arms)
  - packages/observability/package.json (pre-existing OTEL deps)
  - package.json (pre-existing devDependencies block)
provides:
  - ERROR_TRACKER enum accepting noop|pino|sentry|glitchtip with 'pino' default
  - SENTRY_DSN, GLITCHTIP_DSN, RELEASE, SENTRY_ENVIRONMENT, OBS_PII_DENY_EXTRA_KEYS env fields
  - validateObservabilityEnv() crash-hard arms for sentry + glitchtip (D-09)
  - @sentry/bun and @sentry/core resolvable from packages/observability
  - @sentry/cli resolvable from repo root
affects:
  - packages/config/src/__tests__/validate-observability-env.test.ts (extended with 17 new tests)
  - bun.lock (regenerated with Sentry deps)
tech-stack:
  added:
    - "@sentry/bun ^10.49.0"
    - "@sentry/core ^10.49.0 (explicit; A2 resolution)"
    - "@sentry/cli ^3.4.0 (root devDep)"
  patterns:
    - "Zod enum widening via .optional().default() pattern (mirrors PAYMENT_PROVIDER)"
    - "Crash-hard env validator with isTest gate (byte-for-byte mirror of validatePaymentProviderEnv)"
key-files:
  created: []
  modified:
    - packages/config/src/env.ts
    - packages/config/src/__tests__/validate-observability-env.test.ts
    - packages/observability/package.json
    - package.json
    - bun.lock
decisions:
  - "Added @sentry/core as explicit observability dep to resolve createTransport for downstream test-transport helper (A2 in RESEARCH)"
  - "Preserved Phase 21 insertion comments for TRACER and METRICS_PROVIDER switches (no scope creep)"
  - "Widened ERROR_TRACKER default from 'noop' to 'pino' per D-06"
metrics:
  duration: "~8 minutes"
  completed: "2026-04-23"
  tasks: 3
  tests_added: 17
  commits: 5
---

# Phase 18 Plan 01: Config Bootstrap + Dependency Install Summary

## One-liner

Widened `ERROR_TRACKER` env enum to `noop|pino|sentry|glitchtip` with `pino` default, added five new observability env fields (`SENTRY_DSN`, `GLITCHTIP_DSN`, `RELEASE`, `SENTRY_ENVIRONMENT`, `OBS_PII_DENY_EXTRA_KEYS`), filled the crash-hard branches of `validateObservabilityEnv()` mirroring `validatePaymentProviderEnv` byte-for-byte, and installed `@sentry/bun` + `@sentry/core` + `@sentry/cli` with zero direct `@sentry/node` references.

## What Was Built

### Task 1: Widen `ERROR_TRACKER` enum + add new env fields

**File:** `packages/config/src/env.ts`

- `ERROR_TRACKER` enum widened from `z.enum(["noop"])` to `z.enum(["noop", "pino", "sentry", "glitchtip"])`, with the `.default("pino")` widening the Phase-17 `'noop'` default per D-06.
- Added five new schema fields: `SENTRY_DSN` (URL-typed, optional), `GLITCHTIP_DSN` (URL-typed, optional), `RELEASE` (optional string), `SENTRY_ENVIRONMENT` (optional string), `OBS_PII_DENY_EXTRA_KEYS` (optional string).
- Updated the header JSDoc comment block to reflect that Phase 18 now widens `ERROR_TRACKER` and adds DSN + release + environment + PII-override fields.
- TRACER and METRICS_PROVIDER enums remain `noop`-only with their original Phase-21 insertion comments untouched.

**Commits:** `7366aa4` (test/RED), `85a0b14` (feat/GREEN)

### Task 2: Fill crash-hard branches in `validateObservabilityEnv()`

**File:** `packages/config/src/env.ts`

- Replaced the empty `case "noop": break;` body of the ERROR_TRACKER switch with a full four-arm `switch`:
  - `case "noop":` and `case "pino":` fall through (no required env).
  - `case "sentry":` throws `SENTRY_DSN is required when ERROR_TRACKER=sentry. Set SENTRY_DSN in your environment.` when missing in non-test, `console.warn`s in test.
  - `case "glitchtip":` symmetric (GLITCHTIP_DSN).
- Uses the `isTest = env.NODE_ENV === "test"` gate pattern lifted byte-for-byte from `validatePaymentProviderEnv` (D-09).
- Updated function JSDoc to past tense ("Phase 18 filled in...") to reflect completion.
- TRACER and METRICS_PROVIDER switches unchanged — `Phase 21 inserts case "otel"` comments preserved (grep confirms `Phase 21 inserts` appears 2 times).

**Commits:** `235740c` (test/RED — 4 failing assertions), `ba28b36` (feat/GREEN)

### Task 3: Install `@sentry/bun` + `@sentry/cli`

**Files:** `packages/observability/package.json`, `package.json`, `bun.lock`

- Added `@sentry/bun ^10.49.0` as a dependency of `@baseworks/observability`. Bun-native SDK per D-05 / STACK.md (explicitly NOT `@sentry/node`).
- Added `@sentry/cli ^3.4.0` as a root devDependency per D-17. Verified `bun x sentry-cli --version` returns `sentry-cli 3.4.0`.
- Added `@sentry/core ^10.49.0` as an explicit observability dependency to resolve the A2 concern from RESEARCH — the `createTransport` factory needed by the downstream test-transport helper (Plan 18-05) was not resolvable as a transitive-only dep.
- Zero direct references to `@sentry/node` or `@sentry/profiling-node` in any workspace `package.json` file (grep verified).
- `bun install --frozen-lockfile` exits 0 after the install.

**Commit:** `e33c6ff`

## Decisions Made

### Explicit `@sentry/core` dependency (A2 resolution)

The plan's Task 3 `action` block anticipated this: *"If Bun reports 'Cannot find module @sentry/core', add it explicitly to observability as a dep."* Attempted a transitive-only resolution first via `bun -e 'import { createTransport } from "@sentry/core"'` from within `packages/observability`; Bun reported `Cannot find module '@sentry/core'`. Added `@sentry/core ^10.49.0` to `packages/observability/package.json` dependencies block — the plan explicitly permitted this path. Does NOT add `@sentry/node` (remains transitive-only of `@sentry/bun`).

### Preserved Phase 21 insertion comments

The `TRACER` and `METRICS_PROVIDER` switches in `validateObservabilityEnv()` retain their `Phase 21 inserts case "otel"` comments verbatim — Task 2 explicitly forbade touching them, and the verification grep confirms `Phase 21 inserts` still matches twice.

### ERROR_TRACKER default widened from `noop` to `pino`

Per D-06 the default adapter when `ERROR_TRACKER` is unset becomes `pino` — a meaningful default (writes through the existing pino logger at ERROR level with full structured scope per D-07) rather than the silent `noop` from Phase 17. Encoded in the Zod schema's `.default("pino")` and mirrored in the validator's `?? "pino"` fallback.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Explicit `@sentry/core` dependency for createTransport resolution**

- **Found during:** Task 3 verification (A2 from RESEARCH)
- **Issue:** `bun -e 'import { createTransport } from "@sentry/core"'` executed from `packages/observability/` failed with `Cannot find module '@sentry/core'`. `@sentry/core` was installed as a transitive of `@sentry/bun` into Bun's flat cache (`node_modules/.bun/@sentry+core@10.49.0/`) but not hoisted for direct resolution. Downstream Plan 18-05 (`test-transport.ts`) requires `createTransport` — leaving it transitive-only would block that plan.
- **Fix:** Added `"@sentry/core": "^10.49.0"` to `packages/observability/package.json` `dependencies` block. Re-ran `bun install` (already had the lock entry; no new downloads). Verification now passes: `bun -e 'import { createTransport } from "@sentry/core"; console.log(typeof createTransport);'` prints `function`.
- **Plan alignment:** Task 3's `action` block explicitly anticipated this case: *"If Bun reports 'Cannot find module @sentry/core', add it explicitly to observability as a dep. DO NOT add `@sentry/node` under any circumstance."* Both clauses honored.
- **Files modified:** `packages/observability/package.json`, `bun.lock`
- **Commit:** `e33c6ff` (folded into the main Task 3 commit)

### Out-of-scope observations (not fixed)

- `biome.json` has a `$schema` version mismatch against the installed Biome 2.4.10 CLI and contains an unknown `organizeImports` key. Running Biome on Task 1 files exits non-zero due to this pre-existing config problem. Not fixed — out of scope (affects repo-wide linting, not introduced by this plan). Deferred to a future cleanup quick task.

## Verification

All plan-level verification checks pass:

- [x] `grep -E 'z.enum.*noop.*pino.*sentry.*glitchtip' packages/config/src/env.ts` matches (line 36).
- [x] `grep -c "SENTRY_DSN" packages/config/src/env.ts` returns 6 (>= 3 required).
- [x] `grep -c "GLITCHTIP_DSN" packages/config/src/env.ts` returns 6 (>= 3 required).
- [x] `grep '@sentry/bun' packages/observability/package.json` matches `^10.49.0`.
- [x] `grep '@sentry/cli' package.json` matches `^3.4.0`.
- [x] `grep -R '"@sentry/node"' package.json packages/observability/package.json` returns nothing (forbidden).
- [x] `bun install --frozen-lockfile` exits 0.
- [x] `bun test packages/config` exits 0 (34 pass / 0 fail across 2 files, 68 expect() calls; +17 new tests on top of 17 pre-existing).
- [x] `bun x sentry-cli --version` prints `sentry-cli 3.4.0`.
- [x] `bun -e 'import { init } from "@sentry/bun"'` resolves from `packages/observability`.
- [x] `bun -e 'import { createTransport } from "@sentry/core"'` resolves from `packages/observability`.

## Success Criteria

- [x] Env schema accepts `pino|sentry|glitchtip` values (ERR-01, ERR-02, ERR-03 precondition).
- [x] `validateObservabilityEnv()` throws with the offending DSN env key name when the selected adapter lacks its DSN (D-09 crash-hard).
- [x] `@sentry/bun` resolvable from `packages/observability`.
- [x] `@sentry/cli` resolvable from repo root.
- [x] Zero `@sentry/node` or `@sentry/profiling-node` direct references introduced.

## Must-haves Delivered

- [x] Operator can set `ERROR_TRACKER=pino|sentry|glitchtip`; Zod accepts the value (plus legacy `noop`).
- [x] Operator running `ERROR_TRACKER=sentry` without `SENTRY_DSN` sees `validateObservabilityEnv()` throw with the key name at startup (non-test).
- [x] Operator running `ERROR_TRACKER=glitchtip` without `GLITCHTIP_DSN` sees `validateObservabilityEnv()` throw with the key name at startup (non-test).
- [x] Default `ERROR_TRACKER` when unset is `'pino'` (widened from Phase 17's `'noop'`).
- [x] `@sentry/bun` is a dependency of `@baseworks/observability`; `@sentry/cli` is a root devDependency.

## Tests Added

17 new tests across two describe blocks in `packages/config/src/__tests__/validate-observability-env.test.ts`:

- **Enum widening (5 tests):** Accept `pino`, accept `sentry`, accept `glitchtip`, reject `bogus`, default to `pino` when unset.
- **New env fields (9 tests):** `SENTRY_DSN` URL-accepting + URL-rejecting, `GLITCHTIP_DSN` URL-accepting + URL-rejecting, `RELEASE` optional-undefined + string-value, `SENTRY_ENVIRONMENT` optional-undefined, `OBS_PII_DENY_EXTRA_KEYS` optional-undefined + string-value.
- **Crash-hard validator (7 tests):** Sentry throws without DSN in prod, GlitchTip throws without DSN in prod, pino doesn't throw, noop doesn't throw, Sentry warns-not-throws in test, GlitchTip warns-not-throws in test, Sentry passes with DSN set.

Each subprocess test uses `Bun.spawn` with a minimal `baseEnv` plus scoped overrides — mirrors the pre-existing `validatePaymentProviderEnv` test pattern. Deliberately no `mock.module` usage (not needed for env validation).

## Known Stubs

None. All schema fields are real config values with real downstream consumers in Plans 18-02 through 18-07.

## Commits

| Task | Phase | Commit | Description |
| ---- | ----- | ------ | ----------- |
| 1 | RED | `7366aa4` | Failing tests for widened ERROR_TRACKER enum + new env fields (10 failing) |
| 1 | GREEN | `85a0b14` | Widen ERROR_TRACKER enum + add Phase 18 env fields |
| 2 | RED | `235740c` | Failing tests for validateObservabilityEnv crash-hard branches (4 failing) |
| 2 | GREEN | `ba28b36` | Fill crash-hard branches in validateObservabilityEnv (D-09) |
| 3 | — | `e33c6ff` | Install @sentry/bun + @sentry/cli + @sentry/core |

## Self-Check: PASSED

- [x] `packages/config/src/env.ts` exists and contains widened enum + 5 new fields + filled validator arms.
- [x] `packages/observability/package.json` exists and contains `@sentry/bun` + `@sentry/core`.
- [x] `package.json` (root) exists and contains `@sentry/cli` in `devDependencies`.
- [x] `bun.lock` exists and is in sync (`bun install --frozen-lockfile` exits 0).
- [x] All 5 commits (`7366aa4`, `85a0b14`, `235740c`, `ba28b36`, `e33c6ff`) exist in `git log`.
- [x] All 34 config tests pass.

## TDD Gate Compliance

Plan type: `execute` (per frontmatter). Tasks 1 and 2 used `tdd="true"` and followed full RED/GREEN discipline with separate commits for failing tests and implementation. Task 3 was a dependency install (no behavior to test in isolation).
