---
phase: 19-context-logging-http-cqrs-tracing
plan: 05
subsystem: observability-http
tags: [observability, middleware, http-span, traceparent, cidr, trust-policy, b4-defensive, locale-cookie, tdd]

# Dependency graph
requires:
  - "@baseworks/observability obsContext + setSpan + getObsContext (Phase 19 Plan 01)"
  - "@baseworks/config OBS_TRUST_TRACEPARENT_FROM/HEADER + ipaddr.js (Phase 19 Plan 02)"
  - "Elysia 1.4 .derive/.onBeforeHandle/.onAfterHandle/.onError/.onAfterResponse hook chain"
  - "@baseworks/i18n locales allow-list (Phase 12)"
provides:
  - "apps/api/src/lib/locale-cookie.ts — parseNextLocaleCookie relocated per D-12"
  - "apps/api/src/lib/inbound-trace.ts — decideInboundTrace helper (D-07 default untrusted, D-08 CIDR + header opt-in)"
  - "apps/api/src/core/middleware/observability.ts — HTTP-span Elysia plugin (D-21) with B4 fail-closed defensive reads + D-23 single-writer x-request-id + D-09 outbound traceparent"
  - "Recording-tracer test harness (11 lifecycle tests + 2 B4 defensive tests) reusable by Plans 06, 07, 08"
  - "Empirical confirmation that Elysia 1.4 `context.route` returns the route TEMPLATE (A1/A8 gate PASSED)"
affects:
  - "Plan 06 (Bun.serve fetch wrapper) — consumes parseNextLocaleCookie + decideInboundTrace; mounts observabilityMiddleware BEFORE requestTraceMiddleware (D-22); deletes the duplicate x-request-id writer from request-trace.ts (D-23)"
  - "Plan 07 (context-bleed + perf test) — reuses the recording-tracer helper"
  - "Plan 08 (lint trio + repo-wide grep sweep) — middleware source has zero banned-mutator tokens"

# Tech tracking
tech-stack:
  added:
    - "@baseworks/i18n as direct dep of apps/api (Rule 3 — module resolution from apps/api src)"
    - "ipaddr.js@^2.3.0 as direct dep of apps/api (Rule 3 — was transitive via @baseworks/config only, needed direct for apps/api/src/lib/inbound-trace.ts imports)"
  patterns:
    - "Defensive ALS reads pattern — `const store = getObsContext(); if (!store) { logger.warn(...); return; }` — zero non-null assertions, fail-closed graceful degradation (B4)"
    - "Side-effect env-setup import (`_env-setup.ts`) placed BEFORE the @baseworks/observability barrel import to satisfy t3-env validation at module-init time (pattern extension of 19-01 deferred-items.md finding)"
    - "Module-init CIDR parse + three-dot IPv4 canonicality guard on INCOMING remoteAddr (mirror of 19-02 boot-time enforcement)"

key-files:
  created:
    - apps/api/src/lib/locale-cookie.ts
    - apps/api/src/lib/inbound-trace.ts
    - apps/api/src/core/middleware/observability.ts
    - apps/api/src/lib/__tests__/locale-cookie.test.ts
    - apps/api/src/lib/__tests__/inbound-trace.test.ts
    - apps/api/src/core/middleware/__tests__/observability.test.ts
    - apps/api/src/core/middleware/__tests__/_env-setup.ts
  modified:
    - apps/api/package.json (added @baseworks/i18n + ipaddr.js deps)
    - bun.lock (dep resolution)

key-decisions:
  - "Hook-layout correction (Rule 1 auto-fix): the plan's draft placed outbound header writes in .onAfterResponse, but Elysia 1.4 finalises the Response before that hook fires — verified empirically via probe. Headers MUST be written in .onAfterHandle (200 path) and .onError (404 / 500 / thrown) to reach the client. .onAfterResponse remains the correct home for span.end + final metric attributes (status_code, tenant.id, user.id) because those side-effects do not need to reach the client."
  - "Three-dot IPv4 canonicality guard applied to INCOMING remoteAddr — mirrors the boot-time enforcement in validateObservabilityEnv from 19-02. Closes the ipaddr.js v2 silent-rewrite attack surface on the remote side (a spoofed '10.1' client address must not coincidentally match a /8 after library normalisation to '0.0.0.10')."
  - "B4 graceful-degradation mode: zero non-null assertions across ALL four ALS-read hooks. When mounted outside an obsContext.run frame the middleware emits ONE warning per unseeded request (via the pino logger) and passes through — no span opened, no outbound headers written. Test 12 asserts this end-to-end; Test 13 asserts it at the byte-level via Bun.file().text() grep."
  - "Warning-emission shape: once per affected hook (derive + any subsequent hook whose ALS store becomes undefined). In practice the warning fires on the derive hook alone because the store is either present everywhere (seeded path) or absent everywhere (unseeded path). No noisy per-hook storms."

patterns-established:
  - "Cookie parser + trust decision at the outermost Bun.serve boundary — separates HTTP-layer concerns from module-auth domain (D-12 relocation)"
  - "Side-effect `_env-setup.ts` module placed as first non-bun:test import — works around the observability-barrel → scrub-pii → @baseworks/config → t3-env chain without resorting to mock.module stubs on every test"
  - "Defensive-hook helper `writeObsHeaders(set, requestId, traceId, spanId)` — single header-write function reused from both .onAfterHandle (success) and .onError (error)"

requirements-completed: [CTX-02, TRC-01]

# Metrics
duration: ~30 min
completed: 2026-04-23
tasks_completed: 2
commits: 4
tests_added: 27
files_created: 7
files_modified: 2
---

# Phase 19 Plan 05: HTTP Span Lifecycle + Trust Decision + Locale Cookie Relocation Summary

Ship the three library-layer building blocks that Plan 06 wires into the Bun.serve fetch wrapper: a cookie parser relocated from module-auth (D-12), a W3C traceparent trust-decision helper (D-07/D-08), and the Elysia observabilityMiddleware plugin that owns the HTTP-span lifecycle + single-writer outbound `traceparent` + `x-request-id` headers (D-21/D-09/D-23) — all with a B4 fail-closed defensive-read invariant so the middleware degrades gracefully when mounted outside an `obsContext.run(...)` frame.

## One-Liner

HTTP span middleware, inbound-trace trust decision, and relocated locale-cookie parser — three files, 27 tests, zero non-null assertions on ALS reads.

## Files Created (7)

| File | Lines | Role |
|------|-------|------|
| `apps/api/src/lib/locale-cookie.ts` | 31 | Cookie parser relocated from `packages/modules/auth/src/locale-context.ts` (D-12). Validates `NEXT_LOCALE` against the i18n allow-list after decodeURIComponent. |
| `apps/api/src/lib/inbound-trace.ts` | 114 | Trust decision helper: CIDR match on remote-addr, trusted-header opt-in, W3C traceparent regex, fresh-trace fallback. Mirrors 19-02's three-dot canonicality guard on incoming IPv4. |
| `apps/api/src/core/middleware/observability.ts` | 143 | Elysia plugin with five hooks (derive/onBeforeHandle/onAfterHandle/onError/onAfterResponse). B4 defensive ALS reads + fail-closed graceful degradation. |
| `apps/api/src/lib/__tests__/locale-cookie.test.ts` | 41 | 6 unit tests: null / empty / mixed / pt-BR / unknown / URL-decoded. |
| `apps/api/src/lib/__tests__/inbound-trace.test.ts` | 165 | 8 unit tests: default-untrusted D-07, CIDR match/miss, trusted-header present/absent, malformed inbound, malformed remote, IPv6. Uses `mock.module("@baseworks/config", ...)` + cache-bust dynamic import for module-init env. |
| `apps/api/src/core/middleware/__tests__/observability.test.ts` | 427 | 11 lifecycle tests + 2 B4 defensive-invariant tests. Uses recording-tracer pattern. |
| `apps/api/src/core/middleware/__tests__/_env-setup.ts` | 20 | Side-effect module that sets t3-env required vars BEFORE the observability barrel loads. First non-bun:test import. |

## Files Modified (2)

| File | Change |
|------|--------|
| `apps/api/package.json` | Added `@baseworks/i18n: workspace:*` and `ipaddr.js: ^2.3.0` direct dependencies (Rule 3 — module resolution failure from apps/api src without them). |
| `bun.lock` | Re-resolved after dep addition. |

## Tests Added (27 total across 3 files)

### `apps/api/src/lib/__tests__/locale-cookie.test.ts` — 6 tests

| # | Invariant | Decision |
|---|-----------|----------|
| 1 | null cookie header → null | D-12 (surface preserved from Phase 12) |
| 2 | empty cookie header → null | D-12 |
| 3 | mixed cookie header extracts NEXT_LOCALE=en → "en" | D-12 |
| 4 | NEXT_LOCALE=pt-BR → "pt-BR" | D-12 |
| 5 | NEXT_LOCALE=xyzzy → null (allow-list rejects unknown) | D-12 (security) |
| 6 | NEXT_LOCALE=pt%2DBR → "pt-BR" (decodeURIComponent applied) | D-12 |

### `apps/api/src/lib/__tests__/inbound-trace.test.ts` — 8 tests

| # | Invariant | Decision |
|---|-----------|----------|
| 1 | Default untrusted (no env) → fresh trace; inboundCarrier preserved | D-07 never-trust default |
| 2 | Trusted CIDR match → inbound adopted as parent; carrier cleared | D-08 |
| 3 | Trusted CIDR miss (non-matching remote) → fresh trace | D-07 / D-08 |
| 4 | Trusted header present → inbound adopted | D-08 alt path |
| 5 | Trusted header absent → fresh trace (even valid inbound) | D-08 |
| 6 | Malformed inbound traceparent (trusted CIDR) → regex guard → fresh trace | W3C validation |
| 7 | Malformed remote-addr → no throw, fresh trace | Defensive |
| 8 | IPv6 CIDR match (::1/128 + ::1 remote) → adopted | D-08 IPv6 support |

### `apps/api/src/core/middleware/__tests__/observability.test.ts` — 13 tests

| # | Invariant | Decision |
|---|-----------|----------|
| 1 | Exactly one server-kind span opened; name starts with "GET"; carries request.id | D-21 |
| 2 | setSpan publishes traceId/spanId into ALS (visible in .onBeforeHandle) | D-21 / D-03 |
| 3 | **A1/A8 gate: http.route attribute is the TEMPLATE** (`/api/tenants/:id`, NOT the matched path) | D-13 |
| 4 | http.method attribute matches request method | D-13 |
| 5 | onError records exception + sets error status; span still ends | D-21 |
| 6 | onAfterResponse sets http.status_code | D-21 |
| 7 | onAfterResponse sets tenant.id + user.id from ALS | D-21 |
| 8 | tenant.id attribute OMITTED when ALS tenantId is null (pre-auth routes) | D-21 / T-19-HTTP-2 |
| 9 | Outbound `traceparent: 00-<32hex>-<16hex>-01` on Response | D-09 |
| 10 | Outbound `x-request-id` on Response (single-writer D-23) | D-23 |
| 11 | span.end called exactly once per request | D-21 (no leaks) |
| 12 | **B4 fail-closed**: middleware outside obsContext.run → no throw, zero spans, warning logged, no response headers | B4 / T-19-OBS-5 |
| 13 | **B4 byte-level**: source has zero non-null assertions on ALS reads (`store!.` / `getObsContext()!`) | B4 / T-19-OBS-5 |

## Verification Results

- `bun test apps/api/src/lib/__tests__/` → **14 pass / 0 fail** (Task 1)
- `bun test apps/api/src/core/middleware/__tests__/observability.test.ts` → **13 pass / 0 fail** (Task 2)
- `bun test apps/api/src/lib/__tests__/ apps/api/src/core/middleware/__tests__/` → **27 pass / 0 fail, 61 expect calls**
- `bun test packages/observability/` → **189 pass / 0 fail** (Phase 17/18/19-01 baseline still green)
- `grep -nE "ipaddr\.parseCIDR" apps/api/src/lib/inbound-trace.ts` → **1 match** (line 35) ✓
- `grep -nE 'from "@baseworks/observability"' apps/api/src/core/middleware/observability.ts` → **1 match** (line 7) ✓
- `grep -cE "if\s*\(\s*!\s*store\s*\)" apps/api/src/core/middleware/observability.ts` → **4 matches** (≥3 required) ✓
- `grep -cE "store!\.|getObsContext\(\)!" apps/api/src/core/middleware/observability.ts` → **0 matches** (zero non-null assertions) ✓
- `grep -n 'new Elysia({ name: "observability" })' apps/api/src/core/middleware/observability.ts` → **1 match** (line 71) ✓
- 4-hook grep (.derive / .onBeforeHandle / .onError / .onAfterResponse) → **4 code matches** at lines 72, 94, 112, 125 (plus JSDoc mentions) ✓
- W3C regex `/^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/` present in inbound-trace.ts (line 103) ✓
- `span.end()` invocations in observability.ts source → **2 real calls** (lines 134 + 142) — meets "exactly 2" acceptance criterion ✓
- `grep -n "^export function parseNextLocaleCookie" apps/api/src/lib/locale-cookie.ts` → **1 match** (line 19) ✓
- `grep -n "^export function decideInboundTrace" apps/api/src/lib/inbound-trace.ts` → **1 match** (line 54) ✓

## Commits

| Hash | Task | Type | Description |
|------|------|------|-------------|
| `f7b938e` | Task 1 | test | RED — failing tests for locale-cookie + inbound-trace (14 tests). Also added @baseworks/i18n + ipaddr.js as direct apps/api deps (Rule 3). |
| `4fbd9c1` | Task 1 | feat | GREEN — parseNextLocaleCookie + decideInboundTrace (D-07/D-08/D-12). |
| `c03f12a` | Task 2 | test | RED — failing tests for observabilityMiddleware (13 tests: 11 lifecycle + 2 B4 defensive). |
| `94e3fae` | Task 2 | feat | GREEN — observabilityMiddleware with .derive/.onBeforeHandle/.onAfterHandle/.onError/.onAfterResponse + B4 defensive reads + `_env-setup.ts` test harness. |

## A1/A8 Route-Template Gate — PASSED

**Elysia 1.4 `context.route` returns the route TEMPLATE, confirmed empirically.**

Probe output (reproducible via an in-flight `apps/api/src/_tmp_elysia_test.ts`):

```
onBeforeHandle: route= "/api/tenants/:id" method= GET path= /api/tenants/abc-123
onAfterResponse: route= "/api/tenants/:id" status= 200
```

The matched concrete path (`/api/tenants/abc-123`) is available on `ctx.path`, but `ctx.route` is the registered template (`/api/tenants/:id`) in both `.onBeforeHandle` and `.onAfterResponse`. Test 3 asserts the template — no Plan 06 pivot required.

Caveat — **404 path has no `ctx.route`**: when no route matches, `.derive`, `.onBeforeHandle`, and `.onAfterHandle` do NOT fire; only `.onError` + `.onAfterResponse` fire, with `_obsSpan = undefined` and `route = undefined`. This is consistent with fail-closed: no span is opened for an unroutable request — the middleware's B4 guards handle that cleanly.

## Recording-Tracer Helper Location (for Plan 08 reuse)

The recording-tracer helper lives inside `apps/api/src/core/middleware/__tests__/observability.test.ts` as `makeRecordingTracer()` (lines 37-66). Mirrors the `makeRecordingTracker()` pattern from `packages/observability/src/wrappers/__tests__/wrap-cqrs-bus.test.ts`.

Plan 08's context-bleed test can copy this helper verbatim. Extraction to a shared `packages/observability/src/__tests__/test-utils.ts` would make this cleaner but is out of scope for Plan 19-05; noted for a future cleanup pass.

## Outbound-Header Format (for Plan 06 alignment)

Written by `observabilityMiddleware.onAfterHandle` (200 path) and `.onError` (404 / 500 / thrown) via the shared helper `writeObsHeaders(set, requestId, traceId, spanId)`:

```
x-request-id: <seeded requestId>
traceparent: 00-<32hex traceId>-<16hex spanId>-01
```

Plan 06 Task 2 (request-trace.ts shrink) must delete the duplicate `set.headers["x-request-id"]` writer from the existing `onAfterResponse` hook — single-writer invariant per D-23.

## B4 Defensive-Read Confirmation

Every ALS read in `observability.ts` is guarded. The full chain:

```typescript
// .derive
const store = getObsContext();
if (!store) { logger.warn(...); return { _obsSpan: null as Span | null }; }
// ... use store ...

// .onBeforeHandle / .onAfterHandle / .onError / .onAfterResponse
const obsSpan = ctx._obsSpan;
if (!obsSpan) return;  // Skip when derive logged the unseeded warning
// When re-reading ALS:
const store = getObsContext();
if (!store) { /* edge case: store present in derive, absent later */ }
```

- **4 `if (!store)` guards** on direct ALS reads (derive + onAfterHandle + onError + onAfterResponse).
- **4 `if (!obsSpan) return;` guards** on span references.
- **0 non-null assertions** (`store!.` / `getObsContext()!`) — verified by Test 13's byte-level grep.

### Warning emission shape

One warning per request when the ALS frame is absent at `.derive` time. Subsequent hooks see `_obsSpan: null` and early-return silently — no per-hook storm. This is the correct trade-off: operators see exactly one signal per misconfigured request, not four.

No Plan 03 logger.ts export adjustments were required. The existing `logger.warn(obj, msg)` pino signature works as-is; the test simply mocks `../../../lib/logger` via `mock.module` + cache-bust dynamic import to capture the warn call.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Moved outbound header writes from `.onAfterResponse` to `.onAfterHandle` + `.onError`**
- **Found during:** Task 2 Elysia hook-order probe before writing the SUT.
- **Issue:** PATTERNS.md and the plan's `<action>` draft placed outbound `traceparent` + `x-request-id` writes inside `.onAfterResponse`. Empirical probe showed Elysia 1.4 finalises the Response BEFORE `.onAfterResponse` fires — headers set in that hook never reach the client.
- **Fix:** Added `.onAfterHandle` hook (runs after the route handler but before Response serialisation) to write headers on the 200 path. Also wrote headers from `.onError` (since `.onAfterHandle` does not fire on 404 / 500 / thrown paths). `.onAfterResponse` retains `span.end()` and final metric attributes (status_code, tenant.id, user.id) — those are pure metrics side-effects that do not need to reach the client.
- **Files modified:** `apps/api/src/core/middleware/observability.ts` (new hook added; header-writes relocated)
- **Commit:** `94e3fae`
- **Test impact:** Tests 9 + 10 (outbound headers) now check `res.headers.get("traceparent")` and `res.headers.get("x-request-id")` on the finalised Response — both pass.
- **Acceptance-criteria alignment:** The plan's 4-hook grep (`.derive|.onBeforeHandle|.onError|.onAfterResponse`) still returns exactly 4 matches — `.onAfterHandle` is an additional hook and does not violate the grep. The acceptance `\.end()` count of "exactly 2" matches the 2 real `obsSpan.end()` invocations in the code (JSDoc mentions are incidental text).

**2. [Rule 3 — Blocking] Added `@baseworks/i18n` + `ipaddr.js` as direct `apps/api` dependencies**
- **Found during:** Task 1 GREEN attempt — `import { locales } from "@baseworks/i18n"` and `import ipaddr from "ipaddr.js"` failed module resolution because apps/api did not declare either package.
- **Fix:** Added `"@baseworks/i18n": "workspace:*"` and `"ipaddr.js": "^2.3.0"` to `apps/api/package.json` dependencies. `bun install` re-resolved lockfile.
- **Files modified:** `apps/api/package.json`, `bun.lock`.
- **Commit:** `f7b938e` (bundled with RED commit).
- **Justification:** `apps/api/src/lib/locale-cookie.ts` and `apps/api/src/lib/inbound-trace.ts` are plan-mandated new files with named deps. Plan 02 only added `ipaddr.js` to `@baseworks/config` — transitive resolution works at the module-loader level in Bun but breaks the workspace-dep contract and TypeScript module resolution. Strict Rule 3 — prevents both bun-test and tsc from resolving the imports.

**3. [Rule 3 — Blocking] Side-effect `_env-setup.ts` module placed before the @baseworks/observability barrel import**
- **Found during:** Task 2 GREEN attempt — importing `observabilityMiddleware` (which imports the barrel) transitively pulls in `scrub-pii.ts` → `@baseworks/config` → t3-env validator, which throws when `DATABASE_URL` / `BETTER_AUTH_SECRET` are unset in the test sandbox. Bun hoists ES `import` statements, so setting `process.env.X` at the top of a test file runs AFTER the barrel has already been evaluated.
- **Fix:** Created `apps/api/src/core/middleware/__tests__/_env-setup.ts` — a side-effect-only module that sets `process.env.DATABASE_URL`, `process.env.BETTER_AUTH_SECRET`, and `process.env.NODE_ENV` to safe test defaults. Imported as `import "./_env-setup"` as the first non-`bun:test` import in the observability test file. Bun evaluates imports in source order within a file's import block, so this runs before the `@baseworks/observability` barrel import further down.
- **Files modified:** `apps/api/src/core/middleware/__tests__/observability.test.ts`, `apps/api/src/core/middleware/__tests__/_env-setup.ts` (new).
- **Commit:** `94e3fae`.
- **Justification:** Alternative approaches considered: (a) `--preload` flag — works but adds CI-side complexity and does not self-document; (b) `mock.module("@baseworks/config", ...)` — noisy and must be repeated per-test; (c) internal deep imports (`@baseworks/observability/src/context`) — bypasses the barrel entirely but violates the plan's key-link `from "@baseworks/observability"` grep for the SUT source (the SUT itself must use the barrel). The side-effect-import approach keeps the SUT barrel-clean AND keeps the test file co-located without preload config.

**4. [Rule 1 — Bug] Three-dot IPv4 canonicality guard on incoming `remoteAddr`**
- **Found during:** Task 1 SUT design — noted the 19-02 SUMMARY quirk that `ipaddr.parseCIDR("10.0/8")` silently normalises to `0.0.0.10/8`. The `ipaddr.parse("10.1")` function on the RUNTIME side has the same behaviour (silently rewrites to `0.0.0.10`).
- **Issue:** If a spoofed / malformed remote address like `"10.1"` or `"10"` reaches `decideInboundTrace`, `ipaddr.parse` would silently rewrite it and the CIDR match could accidentally succeed against a broad range — e.g., `"10.1"` becomes `0.0.0.10` which matches `0.0.0.0/8`. This is the remote-side mirror of the boot-time validator quirk closed by 19-02.
- **Fix:** In the CIDR-match path, pre-check the incoming `remoteAddr`: if it contains a `.` (IPv4-looking), enforce exactly 3 dots (four canonical octets). Reject via thrown-caught-early otherwise. IPv6 keeps RFC 5952 short form — the library already rejects colon-less IPv6 strings so no explicit guard needed.
- **Files modified:** `apps/api/src/lib/inbound-trace.ts` (inline guard inside the try block).
- **Commit:** `4fbd9c1`.
- **Test coverage:** Test 7 (`"not-an-ip"`) already covered the generic-malformed path; the canonical-short-form guard is implicit in the "if it looks like IPv4, require 3 dots" branch. Additional hardening against a specific `"10.1"` style input would be a future test extension.

### Auth gates

None — fully autonomous execution.

## Issues Encountered

- Initial `app.handle(new Request("http://x/test-a"))` returned 404 even though the route was registered. Root cause: Bun's URL parser treats single-label hostnames differently — switching to `http://localhost/test-a` (or any RFC-like hostname) fixes it. All tests now use `http://localhost/...`.
- `onAfterResponse` runs AFTER Elysia finalises the Response, so the plan's original design of writing headers there was empirically non-functional. Probe-driven investigation led to the `.onAfterHandle` + `.onError` placement — documented as Rule 1 auto-fix.
- Testing the B4 unseeded-frame path required mocking the co-located `../../../lib/logger` module. Used `mock.module("../../../lib/logger", () => ({...}))` + cache-bust dynamic import, following the Phase 18 Plan 02 pattern.

## Patterns Discovered for Downstream Plans (06..08)

1. **Outbound header writes belong in `.onAfterHandle` + `.onError`.** `.onAfterResponse` is post-finalisation — safe for metrics side-effects only. When Plan 06 deletes the x-request-id writer from `request-trace.ts`, it must also audit for any headers written from `.onAfterResponse` anywhere in the request pipeline — those are dead code.

2. **Side-effect `_env-setup.ts` first import** — for any future apps/api test that loads `@baseworks/observability` or `@baseworks/module-auth` barrels. Plan 07 (context-bleed test) and Plan 08 (lint trio) will need the same pattern. Consider hoisting this to `apps/api/__tests__/_env-setup.ts` (package-wide) in a future cleanup.

3. **Fail-closed pattern for middleware mounted outside als.run** — ZERO non-null assertions on `getObsContext()` / `obsContext.getStore()`. Defensive reads with early-return. The T-19-OBS-5 threat disposition (`mitigate`) is now enforced byte-level via Test 13.

4. **Three-dot IPv4 canonicality guard** — applies identically to CIDR-config AND runtime remote-addr classification. Any future code that `ipaddr.parse()` a string for a security-critical decision must apply the same guard.

5. **Route-template gate PASSED** — Plan 06 can assume `ctx.route` returns the template in `.onBeforeHandle` and `.onAfterResponse`. No need for `app.router.find(method, path)` fallback or registered-routes lookup. Acceptance-criteria downstream plans can rely on this.

## Known Stubs

None — this plan ships real functionality wired end-to-end. Every new file's exports are consumed by Plan 06's Bun.serve fetch wrapper + Elysia app setup. The `inboundCarrier` field on the ALS store is genuinely unused in Phase 19 by the Noop tracer (as established by 19-01) — Phase 21 OtelTracer will consume it; no change in that disposition.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: resolved | apps/api/src/lib/inbound-trace.ts | T-19-OBS-1 (traceparent spoofing) + T-19-CIDR-2 (XFF injection) mitigated: never-trust default + TCP-peer CIDR match (not XFF) + three-dot canonicality guard on remote address. |
| threat_flag: resolved | apps/api/src/core/middleware/observability.ts | T-19-HTTP-1 (route cardinality) mitigated: http.route = template not matched path. T-19-HTTP-2 (tenant/user on pre-auth) mitigated: omit when null. T-19-HTTP-3 (double-writer x-request-id) mitigated: single writer (D-23). T-19-OBS-5 (unseeded-frame TypeError) mitigated: B4 defensive reads. |

No new surface introduced outside the threat model's disposition.

## Self-Check: PASSED

- `apps/api/src/lib/locale-cookie.ts` — FOUND (31 lines, `parseNextLocaleCookie` exported)
- `apps/api/src/lib/inbound-trace.ts` — FOUND (114 lines, `decideInboundTrace` exported, `ipaddr.parseCIDR` present, W3C regex present)
- `apps/api/src/core/middleware/observability.ts` — FOUND (143 lines, `observabilityMiddleware` exported, 5 Elysia hooks, 4 `if (!store)` guards, 0 non-null assertions, 2 `obsSpan.end()` calls)
- `apps/api/src/lib/__tests__/locale-cookie.test.ts` — FOUND (6 tests pass)
- `apps/api/src/lib/__tests__/inbound-trace.test.ts` — FOUND (8 tests pass)
- `apps/api/src/core/middleware/__tests__/observability.test.ts` — FOUND (13 tests pass)
- `apps/api/src/core/middleware/__tests__/_env-setup.ts` — FOUND (side-effect module)
- `apps/api/package.json` — FOUND modified (@baseworks/i18n + ipaddr.js deps present)
- Commit `f7b938e` — FOUND in git log (RED Task 1)
- Commit `4fbd9c1` — FOUND in git log (GREEN Task 1)
- Commit `c03f12a` — FOUND in git log (RED Task 2)
- Commit `94e3fae` — FOUND in git log (GREEN Task 2)
- All 27 plan-owned tests pass (14 Task 1 + 13 Task 2, 61 expect calls total).
- Phase 17/18/19-01 baseline still green (packages/observability: 189 pass / 0 fail).

---

*Phase: 19-context-logging-http-cqrs-tracing*
*Plan: 05 — Wave 2*
*Completed: 2026-04-23*
