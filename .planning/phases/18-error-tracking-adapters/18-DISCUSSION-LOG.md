# Phase 18: Error Tracking Adapters - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-22
**Phase:** 18-error-tracking-adapters
**Areas discussed:** Capture wiring surface, Adapter matrix & defaults, PII scrubbing design, Source-map upload pipeline

---

## Capture wiring surface

### Q1 — CQRS handler error capture

| Option | Description | Selected |
|--------|-------------|----------|
| Thin Phase-18 wrapCqrsBus | External wrapper around bus.execute/query; captureException with commandName; no cqrs.ts edits. Phase 19 extends with ALS. | ✓ |
| Rely on Elysia onError only | Let throws bubble to route handler; capture at app.onError. Defer CQRS-scoped capture to Phase 19. Success Criterion #1 partial. | |
| Edit CQRS bus directly | try/catch inside CqrsBus.execute/query. Violates "no cqrs.ts edits" invariant. | |

**User's choice:** Thin Phase-18 wrapCqrsBus (Recommended)
**Notes:** Surfaces `commandName` / `queryName` immediately for ERR-04 context; Phase 19 augments the same wrapper with ALS-derived tenant/user/request_id without rework.

### Q2 — Global process handler install site

| Option | Description | Selected |
|--------|-------------|----------|
| In each entrypoint | Explicit `installGlobalErrorHandlers()` in index.ts and worker.ts after `import './telemetry'` and `validateObservabilityEnv()`. | ✓ |
| Inside telemetry.ts | After sdk.start(); handlers wired by shared line-1 import. Couples OTEL bootstrap with error wiring. | |
| Inside the ErrorTracker factory | Auto-install on first `getErrorTracker()` call. Magic; test-isolation hazard. | |

**User's choice:** In each entrypoint (Recommended)
**Notes:** Readable, easy to role-gate, symmetric with Phase 17's line-1 discipline.

### Q3 — Elysia HTTP error capture

| Option | Description | Selected |
|--------|-------------|----------|
| app.onError lifecycle hook | Single onError block tagging { route, method, code }. Breadcrumbs deferred to Phase 19. | ✓ |
| Dedicated Elysia plugin with beforeHandle breadcrumbs | Richer context but PII-risk on route params before ALS lands. | |
| Capture via process-level only | Skip Elysia-specific capture. Loses route/method context; breaks for handled-and-reported errors. | |

**User's choice:** app.onError lifecycle hook (Recommended)

### Q4 — Worker job failure capture

| Option | Description | Selected |
|--------|-------------|----------|
| Extend the existing `worker.on('failed')` in-place | One-liner `captureException` next to `logger.error` at `apps/api/src/worker.ts:57`. Single call-site. | ✓ |
| Move capture into the try/catch that already rethrows | Double-reporting risk with the 'failed' hook. | |
| Add createWorker wrapper in @baseworks/queue | Adds queue → observability dep edge; one consumer today. | |

**User's choice:** Extend the existing failed handler in-place (Recommended)

---

## Adapter matrix & defaults

### Q5 — Sentry + GlitchTip adapter shape

| Option | Description | Selected |
|--------|-------------|----------|
| Single SentryErrorTracker, DSN routes behavior | One class for both targets; internal `kind: 'sentry' \| 'glitchtip'` tag. | ✓ |
| Two adapter classes sharing a base | Separate concrete classes extending `SentryLikeErrorTracker`. | |
| Single class, DSN alone (no `kind` tag) | One class, no tag. Becomes a hack if providers diverge. | |

**User's choice:** Single SentryErrorTracker, DSN routes behavior (Recommended)
**Notes:** Matches STACK.md "DSN swap only"; makes ERR-02 parity test trivial.

### Q6 — ERROR_TRACKER default behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit ERROR_TRACKER required, no auto-detect | Unset → pino. SENTRY_DSN alone does NOT opt into Sentry; must set ERROR_TRACKER=sentry. | ✓ |
| Auto-detect: DSN presence picks the adapter | Silent mode-switch based on DSN definition. Diverges from billing precedent. | |
| Keep noop as default, pino only when explicit | Contradicts Phase 17 D-03 and ERR-03. | |

**User's choice:** Explicit ERROR_TRACKER required, no auto-detect (Recommended)

### Q7 — pino-sink adapter feature set

| Option | Description | Selected |
|--------|-------------|----------|
| Full port surface, pino-native mapping | captureException → logger.error; captureMessage level 1:1; breadcrumb ring buffer (size 10); withScope → pino child; flush always true. | ✓ |
| Minimal: captureException → logger.error, rest noop | Smallest surface; weakens ERR-03 context. | |
| captureException + withScope + captureMessage; breadcrumbs dropped | Middle ground; scope works but breadcrumbs silently discarded. | |

**User's choice:** Full port surface, pino-native mapping (Recommended)

### Q8 — Adapter directory layout

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror billing: adapters/{noop,pino,sentry}/ | Each adapter as its own subdir; shared conformance test in adapters/__tests__/. | ✓ |
| Flat: adapters/*.ts | One directory for all adapter files; drifts from billing; won't scale for Phase 21. | |
| Per-port subfolder: adapters/error-tracker/{pino,sentry} | Group by port. No existing sibling works this way. | |

**User's choice:** Mirror billing (Recommended)

### Q9 — Env schema shape

| Option | Description | Selected |
|--------|-------------|----------|
| DSNs optional, validator enforces per selection | SENTRY_DSN / GLITCHTIP_DSN as `z.string().url().optional()`; validator crash-hard when selected. Add RELEASE + SENTRY_ENVIRONMENT. | ✓ |
| DSNs are string().min(1), no URL check | Looser; accommodates non-HTTPS internal deployments. | |
| Single ERROR_TRACKER_DSN env var | Collapse both DSN keys. Loses at-a-glance disambiguation. | |

**User's choice:** DSNs optional, validator enforces per selection (Recommended)

### Q10 — Flush on process exit

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, only in global handlers; 2s timeout | uncaughtException/unhandledRejection `await flush(2000)` before exit. No flush on Elysia onError or worker failed. | ✓ |
| Always flush on exit, regardless of path | Wrap process.exit; conflates drop vs crash; adds latency. | |
| Never flush; rely on adapter's internal send cadence | Sentry loses queued events on abrupt exit. | |

**User's choice:** Yes, only in global handlers; 2s timeout (Recommended)

### Q11 — pino-sink captureMessage level mapping

| Option | Description | Selected |
|--------|-------------|----------|
| Map level 1:1 to pino method | `error → logger.error`, `warn → logger.warn`, etc. | ✓ |
| Always at ERROR level | Over-elevates info/warn events. | |
| Drop non-error levels | Loses message-on-warn pattern. | |

**User's choice:** Map level 1:1 to pino method (Recommended)

### Q12 — Conformance test Sentry gating

| Option | Description | Selected |
|--------|-------------|----------|
| Always-run with MockTransport | Offline, no env skip, no CI secrets. | ✓ |
| Skip Sentry when SENTRY_DSN unset | Matches billing's stripe skip. MockTransport avoids the skip. | |
| Require real Sentry test project in CI | Flaky, costly. | |

**User's choice:** Always-run with MockTransport (Recommended)

---

## PII scrubbing design

### Q13 — Scrub layer placement

| Option | Description | Selected |
|--------|-------------|----------|
| Defense in depth: shared scrubber + SDK beforeSend | `scrubPii()` in `packages/observability/src/lib/`; wired into both Sentry SDK hooks and pino-sink capture path. Server-side scrubbing documented in a runbook. | ✓ |
| SDK hook only | Leaves pino-sink unscrubbed; ERR-04 parity breaks. | |
| Per-adapter scrubbers | Triples surface; violates ERR-02 parity. | |

**User's choice:** Defense in depth: shared scrubber + SDK beforeSend (Recommended)

### Q14 — Denylist composition

| Option | Description | Selected |
|--------|-------------|----------|
| Keys + regex + route rule, env-configurable | Deny-keys, regex patterns (email, CPF, CNPJ, Stripe keys, bearer), webhook-route data drop, env override for extra keys. | ✓ |
| Keys-only denylist | Misses free-text PII in error.message — #1 leak vector per Pitfall 6. | |
| Regex-first (no explicit key list) | Misses structured-key leaks; false-positives in stack traces. | |

**User's choice:** Keys + regex + route rule, all configurable from env (Recommended)

### Q15 — Conformance PII fixtures

| Option | Description | Selected |
|--------|-------------|----------|
| Comprehensive PII fixture suite | 12–15 fixtures: password, tokens, email in message, Stripe webhook, Pagar.me CPF/CNPJ, nested email, bearer header, tenantId pass-through, plain stack pass-through, webhook-route data drop, CQRS commandName survival. | ✓ |
| Minimal fixtures (4-5 cases) | Leaves Brazilian PII and nested-object traps partially covered. | |
| Property-based fuzzing with fast-check | Great as follow-up; adds test-only dep. | |

**User's choice:** Comprehensive PII fixture suite (Recommended)

### Q16 — @sentry/bun init options

| Option | Description | Selected |
|--------|-------------|----------|
| Hard-coded safe defaults | `sendDefaultPii: false` (not env-toggleable); beforeSend + beforeBreadcrumb both scrubPii; release + environment from env. | ✓ |
| Env-toggleable sendDefaultPii | Trip-wire env var risk. | |
| Follow @sentry/bun defaults | No explicit safety comment in adapter. | |

**User's choice:** Hard-coded safe defaults (Recommended)

---

## Source-map upload pipeline

### Q17 — Phase 18 CI scope

| Option | Description | Selected |
|--------|-------------|----------|
| Full release.yml for source-map upload only | Creates repo's first `.github/workflows/release.yml`, triggered by `v*.*.*` tag push; only builds + uploads; no test/deploy. Broader PR CI deferred. | ✓ |
| Source-map upload as a reusable composite action only | Ships action + script; no workflow. Leaves EXT-01 unfulfilled. | |
| Full CI: build + test + source-map upload | Balloons scope. | |

**User's choice:** Full release.yml for source-map upload only (Recommended)

### Q18 — Upload tool

| Option | Description | Selected |
|--------|-------------|----------|
| sentry-cli Debug ID variant | `sentry-cli sourcemaps inject` + `upload --release=$GIT_SHA`. Research-recommended 2026 guidance; resilient to CDN renames. | ✓ |
| getsentry/action-release (official GitHub Action) | Wraps sentry-cli; adds its own release cadence + GITHUB_TOKEN. | |
| Custom bun script calling Sentry API directly | Reinvents Debug ID; drifts from evolving upload format. | |

**User's choice:** sentry-cli Debug ID variant (Recommended)

### Q19 — Upload targets

| Option | Description | Selected |
|--------|-------------|----------|
| All four: api + worker + admin + web | Every prod app gets maps uploaded; web is server-side only per Pitfall 9; Success Criterion #4 targets an apps/api endpoint. | ✓ |
| api + worker only (backend-first) | Leaves admin + web minified in Sentry. | |
| api only, minimal proof | Worker errors (major capture surface) stay minified. | |

**User's choice:** All four: api + worker + admin + web (Recommended)

### Q20 — Release identifier

| Option | Description | Selected |
|--------|-------------|----------|
| Short git SHA, set in CI, read at runtime | CI `git rev-parse --short HEAD`; passed build-time + runtime; same value to `sentry-cli` and `Sentry.init({ release })`. | ✓ |
| Git tag name | Rebuilds without a tag share the previous version. | |
| package.json version | Forgotten bumps collide previous versions in Sentry. | |

**User's choice:** Short git SHA, set in CI, read at runtime via env (Recommended)

---

## Claude's Discretion

- Exact `sentry-cli` version pin and install method.
- Whether `release.yml` stores built artifacts as workflow artifacts.
- pino-sink breadcrumb ring-buffer size (starting at 10).
- Redaction marker format (`'[redacted:email]'` vs `'[REDACTED]'`).
- Whether the denylist is a constant or constructed at module init.
- Whether `wrapCqrsBus` is applied once at registry boot or per-module at registration.
- Exact Sentry integrations list (default empty; research NodeClient base integrations during planning).

## Deferred Ideas

- PR-time CI (lint/typecheck/unit test) — separate phase.
- Elysia beforeHandle breadcrumbs — Phase 19 with ALS.
- Property-based PII fuzzing — follow-up.
- Server-side Sentry/GlitchTip project-level scrubbing runbook — Phase 23.
- Alert rules referencing captured errors — Phase 23.
- OTEL exporter integration for Sentry spans — Phase 21.
- `sendDefaultPii` env override — deliberately rejected.
- Frontend (browser) Sentry SDK for apps/web / apps/admin — future phase.
- `wrapEventBus` sibling to `wrapCqrsBus` — Phase 19.
