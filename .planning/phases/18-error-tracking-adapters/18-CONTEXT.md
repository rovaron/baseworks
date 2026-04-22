# Phase 18: Error Tracking Adapters - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship three adapters behind the Phase-17 `ErrorTracker` port — `pino-sink` (the new default when `ERROR_TRACKER` is unset), `SentryErrorTracker` (used for both Sentry and GlitchTip via DSN swap, powered by `@sentry/bun`), and the existing `NoopErrorTracker` (test escape hatch). Add the corresponding env schema (`ERROR_TRACKER` enum widens to `['noop','pino','sentry','glitchtip']`, new `SENTRY_DSN` / `GLITCHTIP_DSN` / `RELEASE` / `SENTRY_ENVIRONMENT` keys) plus a crash-hard branch in `validateObservabilityEnv()` per selected adapter. Wire error capture at four boundaries — global `uncaughtException` / `unhandledRejection` handlers in both entrypoints, an `app.onError` hook in the Elysia app, the existing `worker.on('failed')` handler in `apps/api/src/worker.ts:57`, and a thin external `wrapCqrsBus(bus, tracker)` that surfaces thrown exceptions from `execute()` / `query()` with the command/query name attached (no edits to `apps/api/src/core/cqrs.ts`). Enforce PII-zero emissions via a shared `scrubPii()` utility wired into both the Sentry SDK `beforeSend` / `beforeBreadcrumb` hooks and the pino-sink adapter's `captureException` path, backed by a comprehensive conformance test that feeds 12–15 hand-crafted PII fixtures through every adapter. Ship `.github/workflows/release.yml` (the repo's first GitHub Actions workflow) that triggers on `v*.*.*` tag push and uploads source maps for `api` + `worker` + `admin` + `web` via `sentry-cli sourcemaps upload --release=$RELEASE` using the Debug ID variant.

Phase 19 wires the external ALS context into `wrapCqrsBus` (tenant/user/request_id enrichment) and adds breadcrumb capture via a safer Elysia plugin. Phase 21 ships the OTEL adapters. Phase 23 writes the server-side Sentry scrubbing runbook and alert templates.

</domain>

<decisions>
## Implementation Decisions

### Capture wiring surface

- **D-01:** Phase 18 ships a thin external `wrapCqrsBus(bus, tracker)` in `packages/observability/src/wrappers/` that intercepts `throw` from `execute()` / `query()` and calls `tracker.captureException(err, { extra: { commandName, queryName } })` before re-throwing. No edits to `apps/api/src/core/cqrs.ts` — Phase 19 extends the same wrapper with ALS-derived tenant/user/request_id without rework.
- **D-02:** An explicit `installGlobalErrorHandlers(tracker)` call lives in both `apps/api/src/index.ts` and `apps/api/src/worker.ts`, invoked after the existing line-1 `import './telemetry'` and after `validateObservabilityEnv()`. Registers `process.on('uncaughtException', ...)` and `process.on('unhandledRejection', ...)`; each handler calls `tracker.captureException(err)` then `await tracker.flush(2000)` then `process.exit(1)` (see D-10).
- **D-03:** Elysia HTTP errors are captured via a single `app.onError(({ error, request, code, set }) => tracker.captureException(error, { tags: { route: request.route, method: request.method, code: String(code) } }))` registration. The request itself is not flushed — the next captureException or a periodic drain handles it. Breadcrumb enrichment (per-request beforeHandle) is deferred to Phase 19 once ALS is available as a safer source.
- **D-04:** Worker job failures are captured by extending the existing `worker.on('failed', (job, err) => { ... })` handler in `apps/api/src/worker.ts:57` in place — a one-line addition next to the existing `logger.error(...)` call: `getErrorTracker().captureException(err, { tags: { queue: jobDef.queue }, extra: { jobId: job?.id, jobName } })`. Single call-site, all modules inherit it through the central `createWorker` loop. The inner try/catch at line 45 stays log-only; capture-and-rethrow at both layers would double-report.

### Adapter matrix & defaults

- **D-05:** A single `SentryErrorTracker` class is instantiated by both `case 'sentry'` and `case 'glitchtip'` in the `getErrorTracker()` switch. An internal `kind: 'sentry' | 'glitchtip'` tag drives per-target quirks (release tagging, event-name conventions, server-side scrubbing docs). ERR-02's "DSN-swap parity" becomes trivially true — the code path is identical.
- **D-06:** `ERROR_TRACKER` selection is explicit — no auto-detection from DSN presence. If `ERROR_TRACKER=sentry` is set but `SENTRY_DSN` is missing, `validateObservabilityEnv()` throws at startup (D-09 crash-hard). If `ERROR_TRACKER` is unset entirely, the default becomes `pino` (widening Phase-17 D-03's noop default). `SENTRY_DSN` without `ERROR_TRACKER=sentry` does NOT opt the process into Sentry — prevents surprise mode-switches when stale env vars leak across environments.
- **D-07:** The `pino-sink` adapter implements the full port surface rather than a minimal subset:
  - `captureException(err, scope)` → `logger.error({ err, ...scope, tenantId, userId, requestId, command, breadcrumbs }, 'captured exception')` at ERROR level.
  - `captureMessage(msg, level)` → `logger[level](msg)` with 1:1 level mapping (`'error' → logger.error`, `'warn' → logger.warn`, `'info' → logger.info`, `'debug' → logger.debug`, default `info`).
  - `addBreadcrumb(b)` → append to a per-instance ring buffer (size 10, oldest-first eviction); the buffer is serialized into the next `captureException`'s `extra.breadcrumbs` array and then cleared.
  - `withScope(fn)` → merges scope fields into a pino child logger for the callback's lifetime; scope mutations do not leak across concurrent calls (matches the port contract).
  - `flush(timeoutMs)` → always resolves `true` (pino is synchronous from the adapter's POV).
  Satisfies ERR-03's "full structured context, zero external dependency" and keeps the adapter useful for local development.
- **D-08:** Disk layout mirrors billing 1:1 — `packages/observability/src/adapters/{noop,pino,sentry}/` with each adapter as its own subdirectory containing the adapter file, any private helpers (e.g., `sentry/init-options.ts`), and a local `__tests__/` folder. The shared conformance test lives at `packages/observability/src/adapters/__tests__/error-tracker-conformance.test.ts` — the exact mirror of `packages/modules/billing/src/adapters/__tests__/payment-provider-conformance.test.ts`. The one `SentryErrorTracker` class file serves both Sentry and GlitchTip.
- **D-09:** Env schema additions in `packages/config/src/env.ts`:
  - Widen `ERROR_TRACKER: z.enum(['noop','pino','sentry','glitchtip']).optional().default('pino')`.
  - Add `SENTRY_DSN: z.string().url().optional()`, `GLITCHTIP_DSN: z.string().url().optional()`.
  - Add `RELEASE: z.string().optional()` (CI populates it with the short git SHA; runtime reads it for `Sentry.init({ release })`).
  - Add `SENTRY_ENVIRONMENT: z.string().optional()` (defaults to `env.NODE_ENV` when unset).
  - Extend `validateObservabilityEnv()` with `case 'sentry'` and `case 'glitchtip'` arms that require the matching DSN — throw with the offending key name, non-zero exit, per D-09 from Phase 17.
- **D-10:** Flush-on-exit is scoped narrowly — only the global `uncaughtException` / `unhandledRejection` handlers call `await tracker.flush(2000)` before `process.exit(1)`. Elysia `onError` (request stays alive) and `worker.on('failed')` (next job triggers natural flush) do NOT gate on flush. Prevents event loss on crash without adding latency to the hot path.
- **D-11:** Conformance tests always run against Sentry's `MockTransport` — no env-dependent skips, no real network, no CI secrets. `new SentryErrorTracker({ dsn: 'http://public@example.com/1', transport: MockTransport })` exercises the full pipeline offline; the parity assertion reads captured events from `MockTransport` and diffs them against the pino-sink's log calls (normalized to the same shape). Every CI run exercises both adapters.

### PII scrubbing

- **D-12:** Defense in depth — a single `scrubPii(event): event` pure function lives in `packages/observability/src/lib/scrub-pii.ts` and is called both (a) via `Sentry.init({ beforeSend: scrubPii, beforeBreadcrumb: scrubPii })` in the Sentry adapter AND (b) inside pino-sink's `captureException` before `logger.error(...)`. Phase 23 adds a runbook step for configuring server-side scrubbing in Sentry/GlitchTip project settings as the third layer (documentation only, no code).
- **D-13:** `scrubPii`'s denylist combines keys + regex + route rule:
  - **Deny keys** (exact match, case-insensitive, recursive through nested objects): `password`, `passwd`, `secret`, `token`, `authorization`, `cookie`, `x-api-key`, `sessionId`, `session`, `csrf`, `stripeCustomerId`, `stripe_secret`, `pagarme_secret`, `apiKey`, `email`, `cpf`, `cnpj`. Redact value to `'[redacted:<key>]'`.
  - **Regex patterns** applied to all string leaves: email (`/[\w.+-]+@[\w-]+\.[\w.-]+/g`), CPF (`/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g`), CNPJ, Stripe key prefixes (`/sk_(live|test)_[\w]+/g`), bearer tokens (`/Bearer\s+[\w.-]+/gi`). Replace match with `'[redacted]'`.
  - **Route rule:** drop `event.request.data` entirely when `event.request.url` matches `/api/webhooks/**` — webhook bodies are NEVER forwarded upstream (Pitfall 6).
  - **Env override:** `OBS_PII_DENY_EXTRA_KEYS` (comma-separated string) extends the default key list without patching source — lets downstream forks add project-specific denylist entries.
  - `tenantId`, `user_id`, `request_id`, `command`, `queryName`, `jobId`, `queue`, `route`, `method`, `code` — NOT denied; these are the legitimate context fields ERR-04 requires on every event.
- **D-14:** The conformance PII fixture suite lives at `packages/observability/src/adapters/__tests__/pii-fixtures.ts` and exports 12–15 hand-crafted events covering: plain password in `request.data`, bearer token in `request.headers.authorization`, email inside `error.message` string (e.g., `'failed for user alice@example.com'`), Stripe webhook body with `card_last4` and customer email, Pagar.me webhook with CPF + CNPJ, better-auth session object nested in `extra.session`, email at depth 3 in a nested object, Authorization header with stale Bearer, a tenantId value (must NOT be redacted — positive fixture), a plain stack trace with no PII (pass-through check), a webhook-route request to `/api/webhooks/stripe` (entire `request.data` dropped), and a CQRS-error event with `extra.commandName` (command must survive). Each adapter runs every fixture and asserts the emitted event is redacted per expected shape.
- **D-15:** Sentry init options are hard-coded safe defaults — not env-toggleable:
  ```ts
  Sentry.init({
    dsn: env.SENTRY_DSN ?? env.GLITCHTIP_DSN,
    release: env.RELEASE,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    sendDefaultPii: false,   // hard-coded; comment cites Pitfall 6
    beforeSend: scrubPii,
    beforeBreadcrumb: scrubPii,
    integrations: [],        // opt-in per need; no default browser/IP integrations
  });
  ```
  No `OBS_SEND_DEFAULT_PII` escape hatch — a trip-wire env var that lets someone accidentally ship PII to Sentry in prod does not exist.

### Source-map upload pipeline

- **D-16:** Phase 18 creates the repo's first `.github/workflows/release.yml`, scoped narrowly: triggers on `push.tags: ['v*.*.*']`, builds each app with source maps, runs `sentry-cli sourcemaps upload`, and exits. No test jobs, no deploy jobs, no PR-time CI. A broader `ci.yml` (PR-time lint/typecheck/test) is explicitly deferred to a future phase — including it here would balloon scope beyond ERR/EXT.
- **D-17:** Source-map upload uses `sentry-cli` in Debug ID mode:
  ```yaml
  - run: bun x sentry-cli sourcemaps inject ./apps/api/dist
  - run: bun x sentry-cli sourcemaps upload --release=$RELEASE --org=$SENTRY_ORG --project=$SENTRY_PROJECT ./apps/api/dist
  ```
  Pin `sentry-cli` version in root `package.json` devDependencies. Debug ID variant is the 2026 Sentry-recommended approach — matches minified JS to source maps by embedded ID rather than filename, resilient to CDN renames. Works against both Sentry and GlitchTip (identical wire protocol per STACK.md).
- **D-18:** All four apps upload maps on release tag: `apps/api` + `apps/api` worker bundle (both produced by `bun build --sourcemap=external`), `apps/admin` (Vite emits `.map` files next to `.js`), `apps/web` (Next.js produces server-side source maps — explicitly NOT published to the browser per Pitfall 9; only uploaded to Sentry). Success Criterion #4's demangled-stack-trace acceptance test targets a deliberately-failing `apps/api` endpoint — the simplest surface to verify post-deploy.
- **D-19:** The `RELEASE` identifier is the short git SHA, shared across build-time, runtime, and upload:
  - CI step: `RELEASE=$(git rev-parse --short HEAD)` — first step of the workflow, exports to subsequent steps.
  - Build: `bun build --define process.env.RELEASE=\"$RELEASE\"` (or equivalent for Vite / Next.js) so the adapter reads a baked-in value even if the deploy environment forgets to set `RELEASE`.
  - Upload: `sentry-cli sourcemaps upload --release=$RELEASE ...`.
  - Runtime: `env.RELEASE` is read in `Sentry.init({ release })`.
  Same value at all three points; `git tag` name and `package.json version` are not used as release identifiers (too easy to collide on hotfix builds).

### Claude's Discretion

- Exact `sentry-cli` version pin and whether it installs via devDependency or GitHub Action marketplace.
- Whether `release.yml` also stores built artifacts as a workflow artifact for rollback inspection (nice-to-have, not required by EXT-01).
- Ring-buffer size for pino-sink breadcrumbs (starting at 10; easy to tune later).
- Redaction marker text format (`'[redacted:email]'` vs `'[REDACTED]'`) — any consistent marker works; pick one in the scrubber file.
- Whether the denylist lives as a hard-coded constant or is constructed once at module init from `env.OBS_PII_DENY_EXTRA_KEYS`.
- Whether `wrapCqrsBus` is applied once at registry boot (`registry.setBus(wrapCqrsBus(registry.getBus(), tracker))`) or per-module at registration time — planner picks based on how `loadAll()` currently wires the bus.
- Exact Sentry integrations list (default empty in D-15; may want `NodeClient` base integrations for unhandled rejection dedupe — research it during planning).

### Folded Todos

None — no todos were surfaced against Phase 18 at discussion time.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone & requirements
- `.planning/milestones/v1.3-ROADMAP.md` §"Phase 18: Error Tracking Adapters" — Goal, Depends on (Phase 17), requirements (ERR-01..04, EXT-01), and the 4 Success Criteria. Every Phase 18 plan must trace back to those.
- `.planning/REQUIREMENTS.md` — ERR-01 (Sentry), ERR-02 (GlitchTip parity), ERR-03 (pino fallback), ERR-04 (context + PII scrubbing), EXT-01 (source-map CI).
- `.planning/PROJECT.md` — Vision and hard constraints (Bun-only; `@sentry/bun` not `@sentry/node`).

### Research & pitfalls
- `.planning/research/PITFALLS.md` §"Pitfall 6: Sentry / GlitchTip PII leaks" — denylist design, `beforeSend`/`beforeBreadcrumb` hook pattern, server-side-scrubbing defense-in-depth.
- `.planning/research/PITFALLS.md` §"Pitfall 9" (source maps) — Debug ID variant, `bun build --sourcemap=external`, release = git SHA discipline.
- `.planning/research/STACK.md` — `@sentry/bun ^10.32+` chosen over `@sentry/node`; GlitchTip uses Sentry wire protocol (same SDK); OTEL + BullMQ adapter versions for context.
- `.planning/research/FEATURES.md` — error-tracking table-stakes vs differentiators.
- `.planning/research/ARCHITECTURE.md` — port/adapter layering Phase 18 extends.

### Phase 17 handoff (locked precedents)
- `.planning/phases/17-observability-ports-otel-bootstrap/17-CONTEXT.md` — D-01..D-12 and `<code_context>`; the factory/port/layout template Phase 18 mirrors.
- `packages/observability/src/ports/error-tracker.ts` — locked port interface (`captureException`, `captureMessage`, `addBreadcrumb`, `withScope`, `flush`, `setTenant`). Do NOT widen the interface in Phase 18 — adapters implement it as-is.
- `packages/observability/src/factory.ts` — `getErrorTracker()` switch to extend with `'pino' | 'sentry' | 'glitchtip'` cases; `setErrorTracker` / `resetErrorTracker` test trio stays unchanged.
- `packages/observability/src/adapters/noop/noop-error-tracker.ts` — template noop semantics the pino-sink adapter overrides method-by-method.

### Existing patterns to mirror (byte-for-byte where applicable)
- `packages/modules/billing/src/provider-factory.ts` — factory shape Phase 18 extends.
- `packages/modules/billing/src/adapters/__tests__/payment-provider-conformance.test.ts` — conformance-test template for `error-tracker-conformance.test.ts` (same structure; different fixtures).
- `packages/modules/billing/src/adapters/{stripe,pagarme}/` — per-adapter subdirectory layout Phase 18 copies for `{pino,sentry}/`.
- `packages/config/src/env.ts` — `validateObservabilityEnv()` already has empty arms ready for the new branches; `validatePaymentProviderEnv()` is the crash-hard template.

### Wiring surfaces (capture points)
- `apps/api/src/worker.ts:57` — existing `worker.on('failed')` handler to extend in place (D-04).
- `apps/api/src/core/cqrs.ts` — `CqrsBus.execute` / `.query` — do NOT edit; wrap externally via `wrapCqrsBus` (D-01).
- `apps/api/src/index.ts`, `apps/api/src/worker.ts` — entrypoints that gain an `installGlobalErrorHandlers(tracker)` call after telemetry import (D-02).
- `apps/api/src/lib/logger.ts` — pino logger the pino-sink adapter writes through (D-07).

### External docs (worth bookmarking during implementation)
- Sentry JS SDK Debug ID source maps guide (2026) — referenced in PITFALLS §9.
- `@sentry/bun` README — transport-swap + `MockTransport` usage for the conformance test (D-11).
- `@appsignal/opentelemetry-instrumentation-bullmq` — NOT used in Phase 18; carried forward to Phase 20.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/observability/src/factory.ts` — three `get/reset/set` trios already in place; Phase 18 adds cases to the `ERROR_TRACKER` switch and leaves the others untouched.
- `packages/observability/src/ports/error-tracker.ts` — port interface is locked by Phase 17; adapters implement it verbatim.
- `packages/observability/src/adapters/noop/noop-error-tracker.ts` — behavioral template for the pino-sink adapter; the Noop stays as the test escape hatch via `setErrorTracker(new NoopErrorTracker())`.
- `packages/config/src/env.ts` — `validateObservabilityEnv()` already has prepared `case 'noop'` arms for all three ports with comments flagging "Phase 18 will add pino/sentry/glitchtip cases here" — fill them in.
- `apps/api/src/worker.ts` — central `createWorker` loop is the single surface for job-failure capture; one edit to the `worker.on('failed')` handler at line 57 covers every module.
- `apps/api/src/lib/logger.ts` — existing pino logger the pino-sink adapter writes through.
- `packages/modules/billing/src/adapters/__tests__/payment-provider-conformance.test.ts` — conformance-test pattern `error-tracker-conformance.test.ts` mirrors.

### Established Patterns
- **Port/adapter with env-selected factory** — billing is the precedent; Phase 17 extended it to observability; Phase 18 extends it to three error-tracker adapters.
- **Crash-hard env validation at startup** — `validatePaymentProviderEnv()` and (so far empty) `validateObservabilityEnv()` both throw on missing required keys; Phase 18 fills in the missing-DSN branches.
- **Single-file adapter per provider under `adapters/<name>/`** — billing's `stripe/` and `pagarme/` directory layout is reused for `pino/` and `sentry/`.
- **Conformance tests with hand-crafted fixtures** — billing's Stripe vs Pagar.me parity test is the template; Phase 18 widens it to three adapters with PII fixtures as the primary assertion dimension.
- **No edits to cqrs.ts / event-bus.ts** — Phase 17 codified this as an invariant; Phase 18 honors it via external `wrapCqrsBus`.

### Integration Points
- `packages/observability/src/factory.ts` — add cases `'pino' | 'sentry' | 'glitchtip'` to the `ERROR_TRACKER` switch; widen default from `'noop'` to `'pino'`.
- `packages/observability/src/adapters/pino/pino-error-tracker.ts` — new file.
- `packages/observability/src/adapters/sentry/sentry-error-tracker.ts` — new file (serves both `'sentry'` and `'glitchtip'` per D-05).
- `packages/observability/src/adapters/sentry/init-options.ts` — new helper holding the hard-coded safe Sentry.init options (D-15).
- `packages/observability/src/lib/scrub-pii.ts` — new shared PII-scrubber (D-12).
- `packages/observability/src/wrappers/wrap-cqrs-bus.ts` — new external wrapper (D-01).
- `packages/observability/src/lib/install-global-error-handlers.ts` — new utility (D-02).
- `packages/observability/src/adapters/__tests__/error-tracker-conformance.test.ts` — new shared conformance test (D-11, D-14).
- `packages/observability/src/adapters/__tests__/pii-fixtures.ts` — new fixtures file (D-14).
- `packages/config/src/env.ts` — widen `ERROR_TRACKER` enum; add `SENTRY_DSN` / `GLITCHTIP_DSN` / `RELEASE` / `SENTRY_ENVIRONMENT`; fill the `'sentry' | 'glitchtip'` arms of `validateObservabilityEnv()`; export the new env keys from `packages/config/src/index.ts`.
- `apps/api/src/index.ts` line N (after `import './telemetry'`) → `installGlobalErrorHandlers(getErrorTracker())`; same in `apps/api/src/worker.ts`.
- `apps/api/src/app.ts` (or wherever the Elysia instance is assembled) → `app.onError(...)` hook (D-03).
- `apps/api/src/worker.ts:57` → extend existing `worker.on('failed')` with `getErrorTracker().captureException(...)` one-liner (D-04).
- `apps/api/src/core/cqrs.ts` → NO edits; bus is wrapped externally at registry wire-up time via `wrapCqrsBus` (D-01).
- `package.json` (root) → add `sentry-cli` devDependency; add `@sentry/bun` to `packages/observability/package.json`.
- `.github/workflows/release.yml` — NEW FILE, repo's first GitHub Actions workflow (D-16).

</code_context>

<specifics>
## Specific Ideas

- **Mirror billing precedent, byte-for-byte.** User reaffirmed Phase 17's stance: factory shape, adapter subdirectory layout, conformance test structure, env validator shape, and crash-hard discipline all come from `packages/modules/billing/`. Any divergence should have a named reason.
- **Single SentryErrorTracker for both targets.** One class, `kind: 'sentry' | 'glitchtip'` tag. This is the code expression of "DSN swap proves parity" — the same code path processes both, so ERR-02 becomes an assertion not an engineering question.
- **PII-zero is non-negotiable.** `sendDefaultPii: false` is hard-coded, never env-toggleable. The scrubber is applied in two places (SDK hooks + pino-sink path) with server-side scrubbing documented in a Phase 23 runbook as the third layer. Anyone adding a new field needs to run the conformance fixture suite.
- **Short git SHA as the single release identifier.** CI sets it; build bakes it in; runtime reads it; sentry-cli uploads against it. Any drift between these three breaks Success Criterion #4.
- **Conformance tests run offline.** `MockTransport` replaces the wire transport for Sentry in tests — no env-dependent skips, no CI secrets, no flaky network calls. Every CI run exercises both pino and Sentry paths through the same PII fixtures.
- **`.github/workflows/release.yml` is narrowly scoped.** This is the first workflow the repo has ever had, and it does exactly one thing: upload source maps on tag push. The temptation to bundle PR-time lint/test into the same phase is explicitly resisted — that work is its own phase.

</specifics>

<deferred>
## Deferred Ideas

- **PR-time CI** (lint / typecheck / unit test on pull request) — a separate future phase. EXT-01 only asks for the release-tag source-map upload; a broader `ci.yml` is out of scope for Phase 18.
- **Elysia beforeHandle breadcrumbs** — Phase 19 wires them once ALS is available. Route params in breadcrumbs before ALS land carries PII-leak risk that isn't worth a temporary solution.
- **Property-based PII fuzzing with fast-check** — follow-up enhancement to `error-tracker-conformance.test.ts`. The 12–15 hand-crafted fixtures cover the documented leak vectors; fast-check could catch shapes humans miss but adds a test-only dependency.
- **Server-side Sentry/GlitchTip project-level scrubbing runbook** — Phase 23 (`docs/runbooks/`). The SDK-level scrubbing in Phase 18 is the primary defense; project-level scrubbing is documentation + operator action, not code.
- **Alert rules referencing captured errors** — Phase 23 ships the Sentry/GlitchTip alert config templates.
- **OTEL exporter integration for Sentry spans** — Phase 21, not Phase 18. Sentry's OTEL-bridge integration (if enabled) requires the OTEL adapters from Phase 21.
- **`sendDefaultPii` env override for local debugging** — deliberately NOT added. The trip-wire risk outweighs the debugging convenience.
- **Frontend (browser) Sentry SDK for `apps/web` / `apps/admin`** — Phase 18 focuses on server-side `@sentry/bun`; a browser Sentry adapter would need `@sentry/browser` or `@sentry/react`, its own bundle-size discipline, and its own DSN/release flow. Not in ERR requirements. Can land in a future frontend-error phase.
- **`wrapEventBus` for `apps/api/src/core/event-bus.ts`** — event bus errors currently propagate to the emitter's try/catch. If Phase 18's global handler or wrapCqrsBus doesn't capture an event-bus-internal error, a small `wrapEventBus` helper is a natural sibling to `wrapCqrsBus` — deferred to Phase 19 where ALS context makes it more valuable.

### Reviewed Todos (not folded)
None — no todo matches were surfaced for Phase 18.

</deferred>

---

*Phase: 18-error-tracking-adapters*
*Context gathered: 2026-04-22*
