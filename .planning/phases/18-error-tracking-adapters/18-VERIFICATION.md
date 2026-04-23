---
phase: 18-error-tracking-adapters
verified: 2026-04-23T12:00:00Z
status: human_needed
score: 4/4 must-haves verified (SC-1, SC-2, SC-3 fully; SC-4 partial — file authoring complete, operator config + post-deploy demangled trace pending)
overrides_applied: 0
re_verification: null
human_verification:
  - test: "Configure GitHub repo secrets (SENTRY_AUTH_TOKEN with project:releases + project:write, SENTRY_ORG, SENTRY_PROJECT) — verify via `gh secret list`"
    expected: "All three secrets present in the repo; workflow can authenticate against Sentry/GlitchTip"
    why_human: "Secrets are operator-controlled credentials that cannot be provisioned by automation; deferred by design per 18-HUMAN-UAT.md (committed as a548c79)"
  - test: "Push a test tag `v0.0.1-phase18-test` and observe `.github/workflows/release.yml` run green in GitHub Actions"
    expected: "Workflow completes successfully; `sentry-cli sourcemaps upload` step exits 0 for apps/api + worker + admin"
    why_human: "Requires valid Sentry/GlitchTip backend + real network + live GitHub Actions run — cannot be exercised offline"
  - test: "Deploy apps/api with ERROR_TRACKER=sentry, SENTRY_DSN, and matching RELEASE; hit a deliberate-failure endpoint; verify demangled stack trace in Sentry Stack Trace tab"
    expected: "Frames show real source paths (e.g., `apps/api/src/index.ts:142`), not minified (`index-abc.js:1:2432`) — Success Criterion #4 authoritative gate"
    why_human: "Requires staging deployment + real Sentry project + live network call — the definitive verification of the whole source-map pipeline"
  - test: "Run `curl -I https://admin.your-fork.example.com/assets/<hash>.js.map` against the admin deployment"
    expected: "404 — public `.map` files never served to browsers (Pitfall 5 discipline)"
    why_human: "Requires live admin deployment; productionBrowserSourceMaps=FALSE invariant holds in next.config.ts as a precondition, but the CDN/static-asset layer is operator-controlled"
---

# Phase 18: Error Tracking Adapters Verification Report

**Phase Goal:** Operator can capture errors with rich context and zero PII leakage, swapping Sentry ↔ GlitchTip ↔ Pino-sink via DSN, with prod stack traces readable by release.
**Verified:** 2026-04-23T12:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth (Success Criterion) | Status | Evidence |
|---|---------------------------|--------|----------|
| 1 | Operator setting `SENTRY_DSN` → uncaught exceptions + CQRS handler errors + BullMQ job failures captured in Sentry with release+env tags; same DSN pointed at GlitchTip produces identical events (adapter-conformance test proves parity) | ✓ VERIFIED | `SentryErrorTracker` at `packages/observability/src/adapters/sentry/sentry-error-tracker.ts` serves both targets via `kind: 'sentry' \| 'glitchtip'` (D-05 — single class); `buildInitOptions` in `init-options.ts` passes `release` + `environment` via `Sentry.init`; `installGlobalErrorHandlers(getErrorTracker())` wired in both `apps/api/src/index.ts:25` and `apps/api/src/worker.ts:25`; `wrapCqrsBus(registry.getCqrs(), getErrorTracker())` wired in both entrypoints; `worker.on("failed", ...)` at `worker.ts:70-82` calls `getErrorTracker().captureException(err, { tags: { queue }, extra: { jobId, jobName } })`; `errorMiddleware` at `error.ts:37` captures HTTP errors with `tags: { method, code }` + `extra: { path }`; factory extends switch with sentry + glitchtip cases (`factory.ts:174, 189`). `bun test packages/observability` exits 0 with 180/180 pass including the 13×3=39 cross-adapter conformance tests. Parity is structural: same class, same code path. |
| 2 | No DSN configured → Pino-sink fallback adapter logs errors at ERROR level with full structured context and zero external calls | ✓ VERIFIED | `PinoErrorTracker` at `packages/observability/src/adapters/pino/pino-error-tracker.ts` implements full `ErrorTracker` port (captureException, captureMessage, addBreadcrumb, withScope, flush); factory default widened from `noop` to `pino` (D-06) — `factory.ts:160` shows `process.env.ERROR_TRACKER ?? "pino"`; captureException writes `logger.error(scrubbed, "captured exception")` at ERROR (pino level 50); 12 unit tests verify port methods + PII + ring-buffer + concurrent `withScope` + `flush`. Zero external calls — pino is a local sink. `bun test packages/observability` exits 0. |
| 3 | Every captured error enriched with `tenant_id`, `user_id`, `request_id`, and command/query name; conformance test feeds known-PII fixtures (passwords, tokens, emails, CPF/CNPJ, Stripe/Pagar.me webhook bodies) and asserts redaction before send | ✓ VERIFIED | `scrubPii` at `packages/observability/src/lib/scrub-pii.ts` implements 17-key case-insensitive deny list + 5 regex patterns (email, CPF, CNPJ, Stripe sk_, Bearer) + `/api/webhooks/` URL route rule dropping `request.data`; applied inside `PinoErrorTracker.captureException` BEFORE `logger.error` (defense-in-depth) AND via Sentry `beforeSend`/`beforeBreadcrumb` hooks in `buildInitOptions`; `wrapCqrsBus` attaches `commandName`/`queryName` + `tenantId` to captured exceptions; worker.on('failed') attaches `jobId`/`queue`/`jobName`; errorMiddleware attaches `method`/`code`/`path`. Cross-adapter conformance test at `packages/observability/src/adapters/__tests__/error-tracker-conformance.test.ts` runs all 13 PII fixtures through pino + sentry + noop (39 tests) — asserts `shouldNotAppear` absent + `shouldSurvive` present. `PII_FIXTURES.length === 13`. tenantId is NOT in denylist (positive fixture verifies). Note: request_id/user_id enrichment from ALS is Phase 19's job — Phase 18 provides the `tenantId` field on CaptureScope and the `extra` plumbing that Phase 19 populates. |
| 4 | Developer pushing a release git tag → GitHub Actions step uploads source maps to Sentry/GlitchTip for API + worker + admin; demangled stack trace shown for deliberately-failing endpoint post-deploy | ⚠️ PARTIAL (file authoring complete; operator setup + demangled-trace verification pending) | `.github/workflows/release.yml` exists (104 lines) — triggers on `push.tags: [v*.*.*]`; computes `RELEASE=$(git rev-parse --short HEAD)` once; builds apps/api + worker + admin with `bun build --sourcemap=external` (Debug ID variant — no `//# sourceMappingURL` comment — Pitfall 5); runs `sentry-cli sourcemaps inject` + `upload --release=$RELEASE --org --project` for all three dirs; no `pull_request`/`schedule` triggers; no test/lint/deploy jobs (D-16 narrow scope); no hardcoded SENTRY_AUTH_TOKEN in source; `--define process.env.RELEASE=$RELEASE` on both api + worker builds (Pitfall 6 single-source); `fetch-depth: 0` on checkout; `oven-sh/setup-bun@v2`. `apps/web` intentionally deferred (Next.js 15 server-map surface unstable without `@sentry/nextjs`) — documented in workflow comment + CONTEXT Deferred Ideas. `productionBrowserSourceMaps` stays FALSE in `apps/web/next.config.ts` (default, not set). **Operator-dependent part (requires human — see 18-HUMAN-UAT.md committed as a548c79):** 3 GitHub secrets (SENTRY_AUTH_TOKEN scopes, SENTRY_ORG, SENTRY_PROJECT), live tag-push run, staging deploy with matching RELEASE, deliberate-failure endpoint hit, and Sentry Stack Trace tab showing demangled frames. |

**Score:** 3/4 fully verified + 1 partial (workflow file authored; operator gate pending)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/config/src/env.ts` | ERROR_TRACKER enum widened to `noop\|pino\|sentry\|glitchtip` + 5 new fields + validator crash-hard arms | ✓ VERIFIED | grep for `z.enum(["noop", "pino", "sentry", "glitchtip"])` matches; `SENTRY_DSN`, `GLITCHTIP_DSN`, `RELEASE`, `SENTRY_ENVIRONMENT`, `OBS_PII_DENY_EXTRA_KEYS` all present; `case "sentry":`/`case "glitchtip":` with DSN-missing throw present; default widened to `"pino"` |
| `packages/observability/src/lib/scrub-pii.ts` | Pure `scrubPii(event)` + DEFAULT_DENY_KEYS (17 keys) + 5 regex patterns + webhook-route rule + env additive extension | ✓ VERIFIED | 4890 bytes; exports `scrubPii`, `DEFAULT_DENY_KEYS`, `PiiEvent` type; DENY_SET IIFE reads `env.OBS_PII_DENY_EXTRA_KEYS` additively; 55 unit tests pass |
| `packages/observability/src/adapters/__tests__/pii-fixtures.ts` | 13 hand-crafted PII fixtures with `shouldSurvive` + `shouldNotAppear` per D-14 | ✓ VERIFIED | 7283 bytes; exports `PII_FIXTURES: PiiFixture[]` with length 13; 13 unique fixture names |
| `packages/observability/src/lib/install-global-error-handlers.ts` | Registers `uncaughtException` + `unhandledRejection`; calls captureException, flush(2000), exit(1); WeakSet idempotence | ✓ VERIFIED | 1744 bytes; `WeakSet<ErrorTracker>` guard; inner try/catch with `finally { process.exit(1) }`; 5 subprocess tests pass (including throwing-tracker path) |
| `packages/observability/src/wrappers/wrap-cqrs-bus.ts` | External CqrsBus wrapper catching throws only (A5), rethrow preserves identity, attaches commandName/queryName + tenantId | ✓ VERIFIED | 2826 bytes; 2 try/catch blocks (execute + query); 2 `throw err;` rethrows; 8 tests pass including A5 Result.err negative and identity assertion |
| `packages/observability/src/adapters/sentry/__tests__/test-transport.ts` | `makeTestTransport()` using `createTransport` from `@sentry/core` (A2) | ✓ VERIFIED | imports `createTransport` from `@sentry/core`; no `MockTransport` string; no `@sentry/bun` import; not exported from barrel (T-18-13 — grep confirms) |
| `packages/observability/src/adapters/pino/pino-error-tracker.ts` | Full ErrorTracker port; scrubPii inside captureException; ring buffer cap 10 oldest-first eviction; closure-scoped withScope | ✓ VERIFIED | 7171 bytes; `readonly name = "pino"`; imports scrubPii; `BREADCRUMB_BUFFER_SIZE = 10`; `splice(0, ...)` eviction; no instance state for scope (grep `this\.(tags\|user\|tenantId\|extra)\s*=` returns nothing); 12 tests pass |
| `packages/observability/src/adapters/sentry/init-options.ts` | Pure buildInitOptions with sendDefaultPii:false + defaultIntegrations:false + scrubPii hooks + 4 Option-C safe integrations | ✓ VERIFIED | 3646 bytes; all invariants present; `Integration()` calls count = 4 (inboundFilters, dedupe, linkedErrors, functionToString); scrubPii wired to beforeSend + beforeBreadcrumb |
| `packages/observability/src/adapters/sentry/sentry-error-tracker.ts` | Single class serving both kinds; delegates port methods to @sentry/bun; tenantId-to-tag translation | ✓ VERIFIED | 6226 bytes; `kind: "sentry" \| "glitchtip"` option; `Sentry.init(buildInitOptions(opts))` in ctor; all 5 port methods delegate; tenantId translated to tags |
| `packages/observability/src/adapters/__tests__/error-tracker-conformance.test.ts` | 13 PII_FIXTURES × 3 adapters = 39 tests; makeTestTransport for offline sentry | ✓ VERIFIED | 5081 bytes; 3 per-adapter describes (pino, sentry, noop); `for (const fixture of PII_FIXTURES)` appears 3x; `Sentry.close(100)` in afterEach (T-18-32); 39 tests pass |
| `packages/observability/src/factory.ts` | Extended switch: pino/sentry/glitchtip + default widened to pino (D-06); no `@baseworks/config` import | ✓ VERIFIED | `case "pino"`, `case "sentry"`, `case "glitchtip"` at lines 165, 174, 189; `process.env.ERROR_TRACKER ?? "pino"` at line 160; 26 factory tests pass |
| `packages/observability/src/index.ts` | Barrel exports all Phase 18 artifacts + preserves Phase 17 exports | ✓ VERIFIED | All 8 Phase-18 exports present (scrubPii, DEFAULT_DENY_KEYS, PiiEvent, installGlobalErrorHandlers, wrapCqrsBus, BusLike, PinoErrorTracker, SentryErrorTracker+Options); Phase 17 NoopTracker/NoopMetricsProvider/NoopErrorTracker/factory trio all still present |
| `apps/api/src/index.ts` | Line-1 telemetry preserved; validateObservabilityEnv + installGlobalErrorHandlers + wrapCqrsBus wired | ✓ VERIFIED | Line 1 = `import "./telemetry";`; 6 combined grep hits for the three calls across index.ts + worker.ts |
| `apps/api/src/worker.ts` | Same three + worker.on('failed') D-04 one-liner | ✓ VERIFIED | Line 1 = `import "./telemetry";`; `getErrorTracker().captureException` at line 78 inside worker.on('failed') block at line 70; inner try/catch at lines 62-65 is log-only (D-04) |
| `apps/api/src/core/middleware/error.ts` | Single `.onError` (A4); no `request.route` (A3); captureException before status switch | ✓ VERIFIED | Single `.onError(` at line 21; no `request.route` references; captureException at line 37 with `tags: { method, code }` + `extra: { path }` |
| `apps/api/src/__tests__/worker-failed-capture.test.ts` | 3 tests asserting D-04 shape + inner try/catch log-only guard | ✓ VERIFIED | File exists; 3 tests pass; Test 3 reads worker.ts source and asserts inner region does not contain `captureException` |
| `.github/workflows/release.yml` | Tag-push trigger; Debug ID sourcemap=external; sentry-cli inject+upload; RELEASE single-source; no browser source maps; no PR/test/deploy jobs | ✓ VERIFIED | YAML valid; `push.tags: [v*.*.*]`; `git rev-parse --short HEAD`; `sentry-cli sourcemaps inject` + `upload --release`; `--sourcemap=external` (2 build steps); no `sourcemap=linked`/`inline`; `fetch-depth: 0`; `oven-sh/setup-bun@v2`; no `pull_request:`/`schedule:` triggers; secrets only via `${{ secrets.* }}` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `packages/config/src/env.ts` | `validateObservabilityEnv()` | switch statement on env.ERROR_TRACKER | ✓ WIRED | `case "sentry":` with SENTRY_DSN throw; `case "glitchtip":` with GLITCHTIP_DSN throw |
| `packages/observability/src/lib/scrub-pii.ts` | `@baseworks/config` env | module-init IIFE reads `env.OBS_PII_DENY_EXTRA_KEYS` | ✓ WIRED | grep confirms `OBS_PII_DENY_EXTRA_KEYS` inside DENY_SET IIFE |
| `packages/observability/src/index.ts` | `scrub-pii` + handlers + wrappers + pino + sentry | barrel re-exports | ✓ WIRED | All 8 Phase-18 named exports present |
| `packages/observability/src/lib/install-global-error-handlers.ts` | `process.on` | signal registration for `uncaughtException` + `unhandledRejection` | ✓ WIRED | 2 `process.on(...)` calls; WeakSet guard |
| `packages/observability/src/wrappers/wrap-cqrs-bus.ts` | ErrorTracker port | try/catch → `tracker.captureException` | ✓ WIRED | 2 `tracker.captureException(...)` calls (execute + query); A5 compliance (throws-only) tested |
| `packages/observability/src/adapters/sentry/init-options.ts` | `scrubPii` | `beforeSend` + `beforeBreadcrumb` Sentry hooks | ✓ WIRED | Both hooks call scrubPii with bridge cast to PiiEvent |
| `packages/observability/src/adapters/pino/pino-error-tracker.ts` | `packages/observability/src/lib/scrub-pii.ts` | `scrubPii(raw)` called inside captureException before logger.error | ✓ WIRED | `const scrubbed = scrubPii(raw) ?? raw; this.logger.error(scrubbed, "captured exception");` |
| `packages/observability/src/factory.ts` | PinoErrorTracker + SentryErrorTracker | ERROR_TRACKER switch extension | ✓ WIRED | case "pino" constructs local pino + PinoErrorTracker; case "sentry"/"glitchtip" construct SentryErrorTracker with matching kind |
| `apps/api/src/index.ts` | `installGlobalErrorHandlers` + `wrapCqrsBus` | import from @baseworks/observability + calls in boot sequence | ✓ WIRED | Import + 3 call sites (validateObservabilityEnv, installGlobalErrorHandlers, wrapCqrsBus) |
| `apps/api/src/worker.ts` line 70 | `getErrorTracker().captureException` | additional call inside existing worker.on('failed') handler | ✓ WIRED | Single call at line 78; logger.error at 71 preserved; inner try/catch at 62-65 log-only |
| `apps/api/src/core/middleware/error.ts` | `getErrorTracker().captureException` | inserted before switch(code) inside existing errorMiddleware.onError | ✓ WIRED | At line 37; single `.onError(` on line 21 (A4); no `request.route` (A3) |
| `.github/workflows/release.yml` | `@sentry/cli` | `bun x sentry-cli sourcemaps inject/upload` | ✓ WIRED | `sentry-cli sourcemaps inject` + `sentry-cli sourcemaps upload --release=$RELEASE` in loop; lockfile-pinned `@sentry/cli ^3.4.0` |
| `.github/workflows/release.yml` | RELEASE identifier | `git rev-parse --short HEAD` → `$GITHUB_OUTPUT` → `--define`/`--release` | ✓ WIRED | Single source at workflow top; consumed by `--define process.env.RELEASE` on 2 builds + `--release=$RELEASE` on upload step |

### Data-Flow Trace (Level 4)

For adapters that render/emit dynamic data, verify real data flows end-to-end:

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| PinoErrorTracker.captureException | `err` + `scope` | Parameters from caller (wrapCqrsBus, worker.on('failed'), errorMiddleware, installGlobalErrorHandlers) | Yes — real Error instances + real CaptureScope from four wired boundaries | ✓ FLOWING |
| SentryErrorTracker.captureException | `err` + `scope` | Same four boundaries; delegates to Sentry.captureException which enqueues to transport | Yes — `makeTestTransport` captures envelopes in conformance tests; in prod the real transport ships to DSN | ✓ FLOWING |
| scrubPii | event tree | Called from adapter captureException paths with real captured events + Sentry beforeSend events | Yes — 13-fixture conformance test feeds real PII shapes and asserts redaction on emission | ✓ FLOWING |
| wrapCqrsBus → captureException | `err` from throw | Real CqrsBus.execute/query throws caught + passed to tracker | Yes — 8 tests cover throw + Result.err + identity preservation | ✓ FLOWING |
| worker.on('failed') → captureException | `err` from BullMQ job failure | Real BullMQ Worker `failed` event | Yes — unit test mirrors the exact handler body; production code wired to real worker instance | ✓ FLOWING |
| errorMiddleware.onError → captureException | `error` from Elysia HTTP handler | Real Elysia onError context | Yes — extended in place; 60+ existing apps/api tests still green | ✓ FLOWING |
| release.yml → sourcemaps upload | `.map` files from bun build | `bun build --sourcemap=external` outputs per dir | Depends on operator deploy — bun build produces .map files locally (verifiable); sentry-cli upload requires operator secrets | ⚠️ STATIC until operator triggers workflow (covered by human verification test #2) |

All dynamic-data flows verified in offline test suite (180 observability + 63 apps/api + 34 config = 277 tests pass). The release workflow is the one artifact whose data-production is operator-dependent and deferred to human verification.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Observability package tests | `bun test packages/observability` | 180 pass / 0 fail / 303 expects across 12 files | ✓ PASS |
| Apps/api tests | `bun test apps/api` | 63 pass / 0 fail / 109 expects across 11 files | ✓ PASS |
| Config tests | `bun test packages/config` | 34 pass / 0 fail / 68 expects across 2 files | ✓ PASS |
| Barrel exports importable | Inspecting `packages/observability/src/index.ts` for scrubPii, installGlobalErrorHandlers, wrapCqrsBus, PinoErrorTracker, SentryErrorTracker | All 8 Phase-18 exports present | ✓ PASS |
| D-01 invariant (no Phase 18 commits on cqrs.ts) | `git log --oneline -- apps/api/src/core/cqrs.ts apps/api/src/core/event-bus.ts` | Only `55d0869` (Phase 13-04 JSDoc) + `f53df1b` (Phase 01-02 initial impl) — NO Phase 18 commits | ✓ PASS |
| A4 invariant (single .onError in error.ts) | `grep -c ".onError(" apps/api/src/core/middleware/error.ts` | Single match at line 21 | ✓ PASS |
| A3 invariant (no request.route in error.ts) | Inspected error.ts | No references; uses `request.method` + `String(code)` + `request.url` | ✓ PASS |
| Pitfall 5 (web next.config) | Inspected `apps/web/next.config.ts` | `productionBrowserSourceMaps` not set; no source-map leak opt-in | ✓ PASS |
| Line-1 invariant both entrypoints | `head -n 1 apps/api/src/index.ts apps/api/src/worker.ts` | Both lines are `import "./telemetry";` | ✓ PASS |
| Live GitHub Actions workflow run | Would need `git tag && git push` + Sentry secrets | Cannot run offline — operator-gated | ? SKIP → human_verification #2 |
| Demangled stack trace post-deploy | Would need staging deploy + real Sentry project | Cannot run offline — operator-gated | ? SKIP → human_verification #3 |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| ERR-01 | 18-01, 18-03, 18-05, 18-06 | Sentry error capture via `SENTRY_DSN`, `@sentry/bun`, captures uncaughts + CQRS + BullMQ + source maps | ✓ SATISFIED | `SentryErrorTracker`, `installGlobalErrorHandlers`, `wrapCqrsBus`, `worker.on('failed')` capture all wired — verified above |
| ERR-02 | 18-01, 18-05 | GlitchTip via DSN swap; adapter-conformance test proves parity | ✓ SATISFIED | Single `SentryErrorTracker` class with `kind: 'glitchtip'` construction path in factory; identical code path = structural parity; cross-adapter conformance test exercises glitchtip kind via the same code path |
| ERR-03 | 18-01, 18-04 | Pino-sink fallback active when no DSN; writes errors to pino at ERROR | ✓ SATISFIED | `PinoErrorTracker` + default widened to `pino` in factory (D-06); 12 adapter tests + 39 conformance tests pass |
| ERR-04 | 18-02, 18-03, 18-04, 18-05, 18-06 | Context enrichment + PII scrubbing + adapter conformance | ✓ SATISFIED | `scrubPii` pure function + 13 fixtures + Sentry `beforeSend`/`beforeBreadcrumb` hooks + pino-sink inline call + `wrapCqrsBus` attaches commandName/queryName + tenantId; cross-adapter conformance test (39 tests) asserts every known-PII fixture redacted. Partial: user_id/request_id enrichment is Phase 19's job (ALS) — Phase 18 provides the plumbing (extra/scope/tenantId) on which Phase 19 rides; REQUIREMENTS.md ERR-04 says "tenant_id, user_id, request_id, and command/query name" — tenant_id and command/query name are covered; user_id/request_id land in Phase 19. This is acknowledged in 18-CONTEXT.md: "Phase 19 wires the external ALS context into wrapCqrsBus". |
| EXT-01 | 18-07 | GitHub Actions source-map upload on release tag — stack traces readable by release | ⚠️ PARTIAL (file-authoring complete; operator gate pending) | `.github/workflows/release.yml` shipped with correct Debug ID variant + single-source RELEASE; operator must configure 3 secrets and trigger verification per 18-HUMAN-UAT.md |

**Requirements completed:** 4/5 fully + 1 file-authored pending operator gate
**Orphaned requirements:** None — REQUIREMENTS.md maps Phase 18 to ERR-01..04 + EXT-01, and all 5 are claimed across the 7 plans.

### Anti-Patterns Found

No blocker or warning anti-patterns introduced by Phase 18. Informational notes:

| File | Note | Severity |
|------|------|----------|
| `packages/observability/src/adapters/pino/pino-error-tracker.ts` | `this.breadcrumbs = []` on ctor AND after capture — intentional reset; not a stub | ℹ️ Info |
| `packages/observability/src/adapters/sentry/init-options.ts` | Type bridge casts `as unknown as PiiEvent` for Sentry ErrorEvent — documented as adapter boundary seam in SUMMARY | ℹ️ Info |
| `.github/workflows/release.yml` | `if [ -d "$DIR" ]` guard on upload loop — defensive; skips missing build output rather than fail the whole workflow | ℹ️ Info |
| `packages/observability/src/lib/__tests__/fixtures/crash-harness.ts` | `setInterval(() => {}, 1_000)` + 5s safety-net `setTimeout` — test-only keep-alive documented in 18-03-SUMMARY as required for Bun rejection-handling semantics | ℹ️ Info |

No TODO/FIXME/PLACEHOLDER markers in Phase 18 production code. No `return null`/`return {}`/`return []` stub returns. All handlers have real implementations.

### Human Verification Required

See YAML frontmatter `human_verification` section. Four items require operator action:

1. **Configure GitHub repo secrets** (operator + `gh secret list` verification)
2. **Trigger release workflow with test tag** (live GitHub Actions run)
3. **Deploy + verify demangled stack trace in Sentry** (Success Criterion #4 authoritative gate)
4. **Verify no public .map files on admin deployment** (Pitfall 5 live check)

All four are documented in `.planning/phases/18-error-tracking-adapters/18-HUMAN-UAT.md` (committed as `a548c79`) with step-by-step operator instructions. The Phase 18 codebase is ready; only operator-controlled Sentry/GitHub config + live deploy remain.

### Gaps Summary

No automated gaps. All code artifacts exist, are substantive (minimum lines exceeded per plan frontmatter), are wired into the boundaries, and produce real data in the 277-test offline suite. All locked invariants hold:

- D-01 (no cqrs.ts edits) — confirmed via `git log`
- A4 (single `.onError` in errorMiddleware) — grep-verified
- A5 (wrapCqrsBus captures throws only, not Result.err) — 8 unit tests
- A3 (no `request.route` in error.ts) — grep-verified
- Pitfall 5 (no public browser source maps) — `productionBrowserSourceMaps` unset in next.config.ts; release.yml uses `--sourcemap=external` only
- Pitfall 6 (RELEASE single-source) — `git rev-parse --short HEAD` → `--define process.env.RELEASE` (build) + `--release=$RELEASE` (upload) + runtime reads `env.RELEASE`
- T-18-32 (Sentry.init process-global pollution) — `Sentry.close(100)` in afterEach for every describe constructing SentryErrorTracker
- T-18-13 (test helpers not in production bundle) — `makeTestTransport` not exported from barrel

The only non-automated item is Success Criterion #4's post-deploy demangled-stack-trace verification, which by its nature requires a live Sentry/GlitchTip project + staging deploy. This was explicitly recognized as a human gate during execute-phase (18-07 Task 2 is a `checkpoint:human-action` per design) and recorded in `18-HUMAN-UAT.md`. Status `human_needed` reflects that automated verification is complete and awaiting operator sign-off.

---

_Verified: 2026-04-23T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
