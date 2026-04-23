---
phase: 19-context-logging-http-cqrs-tracing
plan: 02
subsystem: config
tags: [config, env, observability, trust-policy, cidr, ipaddr, zod, phase-19, ctx-02]

# Dependency graph
requires:
  - phase: 17-observability-ports-otel-bootstrap
    provides: validateObservabilityEnv() + per-adapter crash-hard/soft-warn switch pattern
  - phase: 18-observability-adapters
    provides: ERROR_TRACKER branch shape mirrored by the new D-08 CIDR branch
provides:
  - "OBS_TRUST_TRACEPARENT_FROM env key (comma-separated CIDR allow-list, IPv4 + IPv6)"
  - "OBS_TRUST_TRACEPARENT_HEADER env key (operator-chosen header name carrying the trusted source signal)"
  - "Crash-hard CIDR syntax validation at startup (D-08) with actionable error message naming the bad entry"
  - "Canonical-IPv4 enforcement guarding the silent '10.0/8 → 0.0.0.10/8' rewrite in ipaddr.js v2"
  - "ipaddr.js@^2.3.0 as an explicit @baseworks/config dependency"
affects:
  - 19-05-plan-inbound-trace-helper
  - 19-06-plan-http-wrapper
  - phase-23-docs-runbook

# Tech tracking
tech-stack:
  added: [ipaddr.js@^2.3.0]
  patterns:
    - "Per-env-key crash-hard/soft-warn branch mirrors Phase 17/18 ERROR_TRACKER discipline"
    - "Defence-in-depth pre/post validation: library parse + canonical-form check for trust-policy inputs"

key-files:
  created: []
  modified:
    - packages/config/src/env.ts
    - packages/config/package.json
    - packages/config/src/__tests__/env.test.ts

key-decisions:
  - "Default undefined for both env keys → never-trust policy by default (D-07)"
  - "Three-dot IPv4 canonicality check added on top of ipaddr.parseCIDR() to close the '10.0/8 → 0.0.0.10/8' silent rewrite footgun"
  - "ESM static import of ipaddr.js (no dynamic require) to match CLAUDE.md Bun-first constraints"
  - "Soft-warn in NODE_ENV=test mirrors validatePaymentProviderEnv() and the Phase 18 ERROR_TRACKER branch"

patterns-established:
  - "Trust-policy env keys default to undefined; validator enforces syntax crash-hard at boot, not at first request"
  - "Library leniency is guarded with an explicit canonical-form check when the library's outputs are used for security-critical decisions"

requirements-completed: [CTX-02]

# Metrics
duration: 4 min
completed: 2026-04-23
---

# Phase 19 Plan 02: Trust-Policy Env Keys + CIDR Crash-Hard Validation Summary

**Two new observability env keys (OBS_TRUST_TRACEPARENT_FROM, OBS_TRUST_TRACEPARENT_HEADER) backed by ipaddr.js parseCIDR with a canonical-IPv4 guard, wired into validateObservabilityEnv() crash-hard at boot.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-23T21:45:18Z
- **Completed:** 2026-04-23T21:48:55Z
- **Tasks:** 1 (TDD: RED → GREEN, no REFACTOR needed)
- **Files modified:** 3 (plus bun.lock for the new dep)

## Accomplishments

- `OBS_TRUST_TRACEPARENT_FROM` and `OBS_TRUST_TRACEPARENT_HEADER` added to `serverSchema` as `z.string().optional()` — defaults to `undefined` so the effective trust policy is never-trust per D-07.
- `ipaddr.js@^2.3.0` declared under `packages/config/package.json` dependencies (lockfile updated; hoisted into `packages/config/node_modules/ipaddr.js`).
- `validateObservabilityEnv()` extended with a Phase 19 D-08 branch: splits the CIDR list on commas, trims whitespace, filters empty entries, calls `ipaddr.parseCIDR(entry)` inside a try/catch, and on failure emits `Invalid CIDR in OBS_TRUST_TRACEPARENT_FROM: "<entry>". Expected IPv4 (e.g., 10.0.0.0/8) or IPv6 (e.g., ::1/128) notation.` Crash-hard in non-test, soft-warn under `NODE_ENV=test` (mirrors ERROR_TRACKER shape).
- Canonical-IPv4 guard added because ipaddr.js v2 silently parses short-form inputs (`"10.0/8"` → `0.0.0.10/8`, `"10/8"` → `0.0.0.10/8`). Operator intent would be silently inverted for a trust-policy field; we reject any IPv4-classified entry whose host part does not have exactly three dots.
- 9 new behaviour tests added alongside the existing `env.test.ts` subprocess pattern — all pass plus the 34 pre-existing config tests remain green (43/43 total).

## Task Commits

1. **Task 1 (RED): Add failing CIDR trust-policy tests** — `2abaf34` (test)
2. **Task 1 (GREEN): Extend serverSchema + validator + dep** — `6ce9aff` (feat)

_Note: No REFACTOR commit — the GREEN implementation was already shape-aligned with the existing ERROR_TRACKER branch and needed no post-green cleanup._

## Files Created/Modified

- `packages/config/src/env.ts` — Added `import ipaddr from "ipaddr.js"`; added `OBS_TRUST_TRACEPARENT_FROM` + `OBS_TRUST_TRACEPARENT_HEADER` to `serverSchema`; appended Phase 19 D-08 CIDR parse + canonical-form guard branch to `validateObservabilityEnv()`.
- `packages/config/package.json` — Added `"ipaddr.js": "^2.3.0"` under `dependencies`.
- `packages/config/src/__tests__/env.test.ts` — Added `describe("validateObservabilityEnv — CIDR trust policy (Phase 19 / D-07 / D-08)")` with 9 subprocess tests (never-trust default, IPv4/IPv6/mixed valid CIDR, malformed-crashes-production, whitespace tolerance, empty-entry filtering, header plain-string, test-mode soft-warn).
- `bun.lock` — Updated for `ipaddr.js@2.3.0`.

## Decisions Made

- **Canonical-IPv4 requirement (beyond plan):** The plan called for `ipaddr.parseCIDR` as the gate. In practice, ipaddr.js v2 is lenient about short-form IPv4 (it accepts `10.0/8` and silently rewrites it to `0.0.0.10/8`). For a trust-policy field this is a security-critical behaviour mismatch — an operator writing `10.0/8` almost certainly means `10.0.0.0/8`, and silently trusting `0.0.0.10/8` instead is far worse than failing boot. Added a three-dot canonicality check on IPv4-classified entries to enforce the behaviour the plan's Test 5 asserts.
- **No dynamic re-import test helper:** The existing Phase 17/18 pattern (subprocess with fresh `Bun.spawn`) already handles `@t3-oss/env-core`'s module-import-time evaluation cleanly. Mirrored it rather than introducing the cache-bust query-string variant mentioned as an alternative in the plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Rejected short-form IPv4 silent rewrite**
- **Found during:** Task 1 GREEN verification (Test 5 still failing after initial implementation).
- **Issue:** `ipaddr.parseCIDR("10.0/8")` does not throw — it returns `[IPv4(0.0.0.10), 8]`. Using only the library's error signal would cause an operator typing `10.0/8` (intending `10.0.0.0/8`) to trust `0.0.0.10/8` silently, which is a worse failure mode than rejecting the input.
- **Fix:** After a successful `parseCIDR`, inspect the parsed `addr.kind()`. If `"ipv4"`, require the host portion of the original string to contain exactly three dots (four canonical octets). Otherwise route into the same `reportInvalid()` helper that handles library-throw cases. IPv6 does not need a similar guard because ipaddr.js already rejects colon-less IPv6 strings (e.g., `fd00/8` throws).
- **Files modified:** `packages/config/src/env.ts` (Phase 19 D-08 branch).
- **Verification:** All 9 new tests pass, including Test 5 (`10.0/8` → crash) and Test 9 (`10.0/8` in NODE_ENV=test → soft-warn). Malformed IPv6 (`::xyzzy`) still fails via the library path.
- **Committed in:** `6ce9aff` (GREEN commit).

---

**Total deviations:** 1 auto-fixed (1 bug fix via Rule 1).
**Impact on plan:** Plan's behaviour expectations preserved exactly — the deviation is an internal-implementation fix that closes a library-leniency gap the plan's test matrix already required to be closed. No scope creep.

## Issues Encountered

- Initial belief that `ipaddr.parseCIDR` would reject `"10.0/8"` (the plan's example bad entry) was wrong. Confirmed the library's behaviour via a one-off Bun eval run, added the canonical-form guard, re-ran tests green. Captured the quirk in both the code comment (so future readers see the rationale) and the SUMMARY (so Plan 05's inbound-trace helper author knows what shape of CIDR has already been validated).

## ipaddr.js Quirks Documented for Plan 05

- **Short-form IPv4 is accepted and silently normalised.** `parseCIDR("10.0/8")` returns `[0.0.0.10, 8]`. We reject this via a three-dot check on IPv4 entries. Plan 05's inbound-trace helper can assume `OBS_TRUST_TRACEPARENT_FROM` entries that reach it are canonical 4-octet IPv4 or RFC 5952 IPv6 — no further normalisation required.
- **IPv4 prefix range:** Validated implicitly by the library (a `/33` threw in our probe). Plan 05 can skip bit-width sanity checks.
- **IPv6 short form is accepted as canonical.** `"::1/128"`, `"fd00::/8"`, and `"::1/128,fd00::/8"` all parse cleanly. Plan 05 should use the library's own `match(addr, bits)` rather than string-comparing against the raw env, since the operator may have typed any RFC 5952 variant.
- **No IPv4-mapped IPv6 handling** was tested in this plan. If Plan 05 wants to treat `::ffff:10.0.0.1` entries specially, it should probe that path explicitly — our tests cover only IPv4 and native IPv6 CIDR literals.

## Exact Error Message Format (For Plan 05 Alignment)

Production (`throw new Error(...)`) and test-mode (`console.warn`) share the same message body:

```
Invalid CIDR in OBS_TRUST_TRACEPARENT_FROM: "<entry>". Expected IPv4 (e.g., 10.0.0.0/8) or IPv6 (e.g., ::1/128) notation.
```

The test-mode variant is prefixed with `[env] WARNING: `. The bad entry is always quoted verbatim (before trim? no — after trim; empty entries are filtered, so empty string is never the entry). Plan 05 can rely on these strings being stable.

## User Setup Required

None — this plan only adds validation on already-documented env keys. Operators who do not set `OBS_TRUST_TRACEPARENT_FROM` are unaffected (default never-trust per D-07).

## Next Phase Readiness

- **Plan 05 unblocked:** The inbound-trace helper can now import `env.OBS_TRUST_TRACEPARENT_FROM` and `env.OBS_TRUST_TRACEPARENT_HEADER` knowing both are `string | undefined` with crash-hard syntax guarantees at boot. Plan 05 can call `ipaddr.parseCIDR(entry)` on each comma-split entry without re-validating syntax; it only needs to compare the inbound client address against the parsed allow-list.
- **No blockers** for the rest of Wave 1 or downstream waves.

## Self-Check: PASSED

Verified:
- `packages/config/src/env.ts` — FOUND (contains `OBS_TRUST_TRACEPARENT_FROM`, `ipaddr.parseCIDR`, static `import ipaddr from "ipaddr.js"`, no CommonJS `require`).
- `packages/config/package.json` — FOUND (`"ipaddr.js": "^2.3.0"` under `dependencies`).
- `packages/config/src/__tests__/env.test.ts` — FOUND (new describe block with 9 tests; 43 tests green across the config package).
- Commit `2abaf34` — FOUND in git log (RED: failing tests).
- Commit `6ce9aff` — FOUND in git log (GREEN: implementation).
- `ipaddr.js@2.3.0` — materialised in `packages/config/node_modules/ipaddr.js/` and `node_modules/.bun/ipaddr.js@2.3.0/`.

---
*Phase: 19-context-logging-http-cqrs-tracing*
*Plan: 02*
*Completed: 2026-04-23*
