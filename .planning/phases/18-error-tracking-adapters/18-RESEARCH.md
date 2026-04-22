# Phase 18: Error Tracking Adapters - Research

**Researched:** 2026-04-22
**Domain:** Error tracking adapters (Sentry / GlitchTip / pino-sink / Noop) behind the Phase 17 `ErrorTracker` port, with PII scrubbing, four-boundary capture wiring, and a source-map CI pipeline.
**Confidence:** HIGH for @sentry/bun API surface, sentry-cli, bun build sourcemaps, conformance-test pattern; MEDIUM for Elysia `onError` route-template extraction and Next.js 15 server-side source-map emission (confirmed limitations, documented workarounds).

## Summary

Phase 18 adds three adapters to the locked Phase 17 `ErrorTracker` port: `pino-sink` (the new default when `ERROR_TRACKER` is unset), a single `SentryErrorTracker` that backs both Sentry and GlitchTip via DSN swap, and the existing `NoopErrorTracker` (kept as test escape hatch). CONTEXT.md locks 19 decisions (D-01..D-19); research confirms almost all of them line up with current SDK reality. Three SDK-level gaps need planner attention before PLANs are written (see `<critical_flags>` below).

Primary recommendation: pin `@sentry/bun@^10.49.0` and `@sentry/cli@^3.4.0`, adopt Debug-ID-variant source map uploads via `bun build --sourcemap external` → `sentry-cli sourcemaps inject` → `sentry-cli sourcemaps upload`, and mirror `packages/modules/billing/src/adapters/{stripe,pagarme}/` layout byte-for-byte for `packages/observability/src/adapters/{pino,sentry}/`. Resolve the three flagged gaps (D-02 / D-15 default-integrations overlap; D-11 MockTransport non-existence; D-03 Elysia `request.route` non-existence) at plan-writing time — they are fixable with small, concrete changes, not structural rework.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Capture wiring surface**
- **D-01:** Thin external `wrapCqrsBus(bus, tracker)` in `packages/observability/src/wrappers/` intercepts `throw` from `execute()` / `query()`, calls `tracker.captureException(err, { extra: { commandName, queryName } })`, re-throws. No edits to `apps/api/src/core/cqrs.ts`.
- **D-02:** Explicit `installGlobalErrorHandlers(tracker)` call in both `apps/api/src/index.ts` and `apps/api/src/worker.ts`, after `import './telemetry'` and after `validateObservabilityEnv()`. Registers `process.on('uncaughtException' | 'unhandledRejection')`; handlers call `tracker.captureException(err)` → `await tracker.flush(2000)` → `process.exit(1)`.
- **D-03:** Elysia errors captured via single `app.onError(({ error, request, code, set }) => tracker.captureException(error, { tags: { route: request.route, method: request.method, code: String(code) } }))`. Breadcrumb enrichment deferred to Phase 19.
- **D-04:** Worker job failures captured by extending the existing `worker.on('failed', ...)` in `apps/api/src/worker.ts:57` — one-line addition next to the existing `logger.error(...)`: `getErrorTracker().captureException(err, { tags: { queue: jobDef.queue }, extra: { jobId: job?.id, jobName } })`. Inner try/catch at line 45 stays log-only (no double-report).

**Adapter matrix & defaults**
- **D-05:** Single `SentryErrorTracker` class instantiated by both `case 'sentry'` and `case 'glitchtip'` in the `getErrorTracker()` switch. Internal `kind: 'sentry' | 'glitchtip'` tag for per-target quirks.
- **D-06:** `ERROR_TRACKER` selection explicit — no auto-detection from DSN presence. `ERROR_TRACKER=sentry` + missing `SENTRY_DSN` → crash-hard. Unset `ERROR_TRACKER` defaults to `'pino'` (widens Phase 17 D-03).
- **D-07:** `pino-sink` adapter implements full port surface: `captureException` → `logger.error(...)` at ERROR level with structured scope; `captureMessage` → `logger[level](msg)` with 1:1 mapping; `addBreadcrumb` → per-instance ring buffer size 10 (oldest-first eviction), serialized to `extra.breadcrumbs` on next `captureException`, then cleared; `withScope(fn)` → merges scope fields into pino child logger for callback lifetime, no cross-call leakage; `flush(timeoutMs)` → always resolves `true`.
- **D-08:** Disk layout mirrors billing 1:1 — `packages/observability/src/adapters/{noop,pino,sentry}/` with each adapter as its own subdirectory. Shared conformance test at `packages/observability/src/adapters/__tests__/error-tracker-conformance.test.ts`.
- **D-09:** Env schema additions in `packages/config/src/env.ts`:
  - `ERROR_TRACKER: z.enum(['noop','pino','sentry','glitchtip']).optional().default('pino')`
  - `SENTRY_DSN: z.string().url().optional()`, `GLITCHTIP_DSN: z.string().url().optional()`
  - `RELEASE: z.string().optional()` (CI sets to short git SHA)
  - `SENTRY_ENVIRONMENT: z.string().optional()` (defaults to `env.NODE_ENV` when unset)
  - `validateObservabilityEnv()` gains `case 'sentry'` / `case 'glitchtip'` arms requiring matching DSN (crash-hard per Phase 17 D-09).
- **D-10:** Flush-on-exit scoped narrowly — only global `uncaughtException` / `unhandledRejection` handlers call `await tracker.flush(2000)`. Elysia `onError` and `worker.on('failed')` do NOT gate on flush.
- **D-11:** Conformance tests run offline against Sentry's `MockTransport` — no env skips, no real network, no CI secrets. `new SentryErrorTracker({ dsn: 'http://public@example.com/1', transport: MockTransport })`.

**PII scrubbing**
- **D-12:** Defense in depth — single `scrubPii(event): event` in `packages/observability/src/lib/scrub-pii.ts` called by (a) `Sentry.init({ beforeSend: scrubPii, beforeBreadcrumb: scrubPii })` AND (b) pino-sink `captureException` before `logger.error(...)`.
- **D-13:** Denylist = keys + regex + route rule:
  - Deny keys (exact, case-insensitive, recursive): `password`, `passwd`, `secret`, `token`, `authorization`, `cookie`, `x-api-key`, `sessionId`, `session`, `csrf`, `stripeCustomerId`, `stripe_secret`, `pagarme_secret`, `apiKey`, `email`, `cpf`, `cnpj`. Redact value to `'[redacted:<key>]'`.
  - Regex on string leaves: email, CPF `/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g`, CNPJ, Stripe `/sk_(live|test)_[\w]+/g`, bearer `/Bearer\s+[\w.-]+/gi`. Replace match with `'[redacted]'`.
  - Route rule: drop `event.request.data` entirely when `event.request.url` matches `/api/webhooks/**`.
  - Env override: `OBS_PII_DENY_EXTRA_KEYS` (comma-separated) extends default key list.
  - Legitimate context NOT denied: `tenantId`, `user_id`, `request_id`, `command`, `queryName`, `jobId`, `queue`, `route`, `method`, `code`.
- **D-14:** Conformance fixture suite at `packages/observability/src/adapters/__tests__/pii-fixtures.ts` — 12–15 hand-crafted events covering: plain password in request.data; bearer token in request.headers.authorization; email inside error.message string; Stripe webhook body with card_last4 + customer email; Pagar.me webhook with CPF + CNPJ; better-auth session nested in extra.session; email at depth 3; Authorization with stale Bearer; tenantId positive fixture (must NOT be redacted); plain stack trace with no PII (pass-through); webhook-route request to /api/webhooks/stripe (entire request.data dropped); CQRS-error event with extra.commandName (command survives).
- **D-15:** Sentry init options hard-coded, not env-toggleable:
  ```ts
  Sentry.init({
    dsn: env.SENTRY_DSN ?? env.GLITCHTIP_DSN,
    release: env.RELEASE,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    sendDefaultPii: false,
    beforeSend: scrubPii,
    beforeBreadcrumb: scrubPii,
    integrations: [],
  });
  ```
  **⚠️ See `<critical_flags>` A1 — `integrations: []` does NOT disable defaults; must add `defaultIntegrations: false` to match intent.**
  No `OBS_SEND_DEFAULT_PII` escape hatch.

**Source-map upload pipeline**
- **D-16:** `.github/workflows/release.yml` scoped narrowly — triggers on `push.tags: ['v*.*.*']`, builds each app with source maps, runs `sentry-cli sourcemaps upload`, exits. No test/deploy/PR jobs. Broader `ci.yml` deferred.
- **D-17:** Source-map upload uses `sentry-cli` Debug ID mode:
  ```yaml
  - run: bun x sentry-cli sourcemaps inject ./apps/api/dist
  - run: bun x sentry-cli sourcemaps upload --release=$RELEASE --org=$SENTRY_ORG --project=$SENTRY_PROJECT ./apps/api/dist
  ```
  Pin `@sentry/cli` in root `devDependencies`.
- **D-18:** All four apps upload maps: `apps/api` + `apps/api` worker bundle (both `bun build --sourcemap=external`), `apps/admin` (Vite `.map` files next to `.js`), `apps/web` (Next.js server-side maps — NOT published to browser per Pitfall 9; uploaded to Sentry only). Success Criterion #4 test targets a deliberately-failing `apps/api` endpoint.
- **D-19:** `RELEASE` = short git SHA, shared across build-time, runtime, upload:
  - CI: `RELEASE=$(git rev-parse --short HEAD)` (workflow first step).
  - Build: `bun build --define process.env.RELEASE=\"$RELEASE\"`.
  - Upload: `sentry-cli sourcemaps upload --release=$RELEASE ...`.
  - Runtime: `env.RELEASE` in `Sentry.init({ release })`.

### Claude's Discretion

- Exact `sentry-cli` version pin and install mechanism (devDependency vs GitHub Action marketplace).
- Whether `release.yml` also stores built artifacts as workflow artifact.
- Ring-buffer size for pino-sink breadcrumbs (starts at 10).
- Redaction marker format (`'[redacted:email]'` vs `'[REDACTED]'`).
- Denylist as hard-coded constant vs module-init construction from `env.OBS_PII_DENY_EXTRA_KEYS`.
- Whether `wrapCqrsBus` applied once at registry boot vs per-module at registration time.
- Exact Sentry integrations list (may want NodeClient base integrations for unhandled rejection dedupe — see critical_flags A1).

### Deferred Ideas (OUT OF SCOPE)

- PR-time CI (lint / typecheck / unit test on PR) — separate future phase.
- Elysia `beforeHandle` breadcrumbs — Phase 19 (ALS-safe source).
- Property-based PII fuzzing with `fast-check` — follow-up enhancement.
- Server-side Sentry/GlitchTip project-level scrubbing runbook — Phase 23.
- Alert rules referencing captured errors — Phase 23.
- OTEL exporter integration for Sentry spans — Phase 21.
- `sendDefaultPii` env override for local debugging — deliberately NOT added.
- Frontend (browser) Sentry SDK for `apps/web` / `apps/admin` — future frontend-error phase.
- `wrapEventBus` for `apps/api/src/core/event-bus.ts` — Phase 19.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ERR-01 | Sentry error capture via `SENTRY_DSN`, `@sentry/bun`, captures uncaught exceptions + CQRS errors + BullMQ failures, source maps uploaded on release tag | `@sentry/bun@^10.49.0` verified on npm (published 2026-04-16); `Sentry.init({ dsn, release, environment, ... })`; source-map pipeline section below |
| ERR-02 | GlitchTip parity via DSN swap; conformance test proves parity | Single `SentryErrorTracker` class with `kind` tag per D-05; GlitchTip 6 (Feb 2026) implements Sentry wire protocol — DSN swap is the intended path |
| ERR-03 | pino-sink fallback active when no DSN configured; writes to pino at ERROR level with full structured context; zero external calls | pino-sink adapter per D-07; default `ERROR_TRACKER=pino` per D-06 |
| ERR-04 | Errors enriched with `tenant_id`, `user_id`, `request_id`, command/query name; webhook/auth/payment payloads scrubbed; adapter-conformance test feeds known-PII fixtures | `scrubPii` per D-12/D-13; PII fixture suite per D-14 |
| EXT-01 | GitHub Actions step uploading source maps to Sentry/GlitchTip on release tag push — stack traces readable by release | `.github/workflows/release.yml` per D-16..D-19; sentry-cli Debug ID mode per D-17 |

## Project Constraints (from CLAUDE.md)

Actionable directives that constrain implementation:

- **Runtime: Bun only.** Use `@sentry/bun`, NOT `@sentry/node`. Verified by STACK.md and already locked via CLAUDE.md "Runtime: Bun — all packages must be Bun-compatible".
- **TypeScript strict.** All new adapter files must pass strict mode.
- **ORM: Drizzle only** (not relevant to Phase 18 but noted).
- **Queue: BullMQ + Redis only** — worker failure capture path uses existing BullMQ `Worker` instance; no queue-system swap.
- **Styling: Tailwind 4 + shadcn/ui only** (not relevant to Phase 18).
- **Linter: Biome only** — all new files must pass `biome check`. No ESLint/Prettier.
- **Testing: `bun test` (backend) + Vitest (frontend).** Phase 18 tests all run under `bun test` since `packages/observability` and `apps/api` are backend.
- **Explicitly forbidden:** `@sentry/node`, `@sentry/profiling-node`, Prisma, NextAuth, `pg` (node-postgres), Jest.
- **Bun build, not `--compile`:** Do not use `--compile` for production API image (breaks OTEL + Sentry auto-instrumentation per STACK.md Bun Compatibility Scorecard).

<critical_flags>

## ⚠️ Critical SDK Gaps — Resolve Before Writing PLANs

Three CONTEXT.md decisions conflict with current `@sentry/bun@^10.49.0` / Elysia 1.x reality. None are structural — all have concrete small-change fixes.

### A1: D-15 `integrations: []` does NOT disable default integrations [VERIFIED: Sentry docs]

**The gap:** CONTEXT.md D-15 specifies `Sentry.init({ integrations: [] })` with the stated intent "opt-in per need; no default browser/IP integrations". Per Sentry's configuration documentation, `integrations` is an *additional* integrations list that is merged with `defaultIntegrations`. An empty array adds nothing — **it does not remove defaults**. The option to disable defaults is `defaultIntegrations: false`.

**What gets auto-registered today** (from `@sentry/bun` `getDefaultIntegrations()` source, develop branch):
- `inboundFiltersIntegration`, `functionToStringIntegration`, `linkedErrorsIntegration`, `requestDataIntegration`
- `consoleIntegration`, `httpIntegration`, `nativeNodeFetchIntegration`
- **`onUncaughtExceptionIntegration`** — registers `process.on('uncaughtException')`
- **`onUnhandledRejectionIntegration`** — registers `process.on('unhandledRejection')`
- `contextLinesIntegration`, `nodeContextIntegration`, `modulesIntegration`, `processSessionIntegration`
- `bunServerIntegration` — auto-wraps `Bun.serve` (Baseworks uses Elysia on Bun → this auto-patches Elysia's HTTP entry)

**Two downstream consequences for Phase 18 decisions:**

**A1a (D-02 double-registration):** With default integrations enabled, Sentry already installs global uncaught/unhandled handlers. D-02 adds a second layer calling `tracker.captureException(err) → flush(2000) → exit(1)`. Both fire → event duplicated → exit behavior racy (Sentry's handler may not exit).

**A1b (D-15 `request.data`):** `requestDataIntegration` auto-captures request bodies on errors captured via `httpIntegration` / `bunServerIntegration`. CONTEXT.md's webhook-route rule in D-13 drops `event.request.data` when URL matches `/api/webhooks/**`, but the scrubber runs inside `beforeSend`, so this IS defense-in-depth — just note that if any integration is re-enabled that adds additional event fields, the scrubber must cover them.

**Resolution options (planner picks one):**
1. **Recommended — Option A (close the hole completely):** `Sentry.init({ defaultIntegrations: false, integrations: [] })`. Disables all defaults; re-adds nothing. D-02's explicit global handlers are then the sole source. Matches the stated intent of "no default browser/IP integrations" and avoids double-registration.
2. **Option B (keep Sentry's handlers, remove D-02's):** Keep defaults enabled; drop D-02 entirely and rely on `onUncaughtExceptionIntegration` + `onUnhandledRejectionIntegration`. Trade-off: loses control over the flush-and-exit-1 sequence and may leave the process running after `uncaughtException`.
3. **Option C (surgical):** `defaultIntegrations: false`, then selectively add back safe integrations:
   ```ts
   integrations: [
     Sentry.inboundFiltersIntegration(),
     Sentry.dedupeIntegration(),
     Sentry.linkedErrorsIntegration(),
     Sentry.functionToStringIntegration(),
   ]
   ```
   Keeps noise reduction + error chaining without the global-handler overlap or HTTP/request-body integrations.

**My recommendation:** Option C. It matches the intent (PII-zero, no Bun.serve auto-patching, no global-handler overlap) while keeping Sentry's dedupe + error-chain-traversal which are expensive to re-implement. [CITED: docs.sentry.io/platforms/javascript/guides/bun/configuration/integrations/]

---

### A2: D-11 `MockTransport` is NOT a named export of `@sentry/bun` [VERIFIED: source inspection]

**The gap:** CONTEXT.md D-11 specifies `new SentryErrorTracker({ dsn: 'http://public@example.com/1', transport: MockTransport })`. Inspection of `@sentry/bun`'s published `index.ts` (develop branch) shows exports `BunClient`, `getDefaultIntegrations`, `init`, `bunServerIntegration`, `bunRuntimeMetricsIntegration`, `makeFetchTransport` — plus everything re-exported from `@sentry/node` and `@sentry/core`. **There is no `MockTransport` export.**

**The standard pattern** (from sentry-javascript Issue #6826 "Testing an integration"): tests construct a custom transport via `createTransport` from `@sentry/core`:
```ts
import { createTransport } from '@sentry/core';
import { resolvedSyncPromise } from '@sentry/core/utils';

const captured: Envelope[] = [];
const makeTestTransport = () => createTransport(
  { recordDroppedEvent: () => {}, textEncoder: new TextEncoder() },
  (req) => {
    captured.push(req.body as Envelope);
    return resolvedSyncPromise({ statusCode: 200 });
  }
);

Sentry.init({ dsn: 'http://public@example.com/1', transport: makeTestTransport, ... });
```

**Resolution:** Ship the test helper in `packages/observability/src/adapters/sentry/__tests__/test-transport.ts` exporting `makeTestTransport()` that returns the `Transport` factory plus a `captured` array (or a small class wrapping both). Name it `InMemoryTransport` or `TestTransport` — NOT `MockTransport` to avoid implying a package export.

**Why this matters for the planner:** a plan that says "import `MockTransport` from `@sentry/bun`" will not compile. The correct plan is "build `test-transport.ts` helper and pass its factory to `Sentry.init({ transport })`."

---

### A3: D-03 `request.route` does NOT exist on Elysia Context [VERIFIED: Elysia docs]

**The gap:** CONTEXT.md D-03 specifies `tags: { route: request.route, method: request.method, code: String(code) }` inside the `app.onError` callback. Elysia's Context does NOT expose a `route` property. Available fields on Context: `body`, `query`, `params`, `headers`, `path` (concrete request path, not template), `request` (Web Standard Request — has `method` and `url`, no `route`), `set`, `store`, `cookie`, `server`. The `error` and `code` additions for `onError` are on top of this base.

**Why it matters:** the original intent of `route` as a tag is cardinality-safe filtering (per STACK.md Pitfall 4 — never use raw path as a metric label; route template is safe). With only `path` available, tagging the concrete pathname leaks high-cardinality values (`/users/abc123` vs `/users/:id`).

**Resolution options:**
1. **Recommended:** Tag with `method` and `code` only; DROP the `route` tag in Phase 18. Phase 19's observability middleware will have the matched route template (it wraps routes after registration) — add `route` tag there when ALS lands.
2. **Alternative:** Extract route template from `request.url` with manual normalization (e.g., replace UUID-like segments with `:id`). Fragile, easy to miss shapes, not recommended.
3. **Investigation:** Check if `app.onError` receives additional Elysia-internal fields beyond documented Context — requires reading Elysia 1.x source at plan time. If a `route.template` or equivalent exists, use it. Phase 17's `requestTraceMiddleware` uses `request.method` + `new URL(request.url).pathname` — same pattern applies.

**My recommendation:** Option 1. Ship with `tags: { method: request.method, code: String(code) }` in Phase 18, and extra context via `extra: { path: new URL(request.url).pathname }` — pathname goes on `extra` (not a metric dimension) so cardinality isn't a concern. Phase 19 adds `route` when the route template is available via the observability middleware. This honors D-03's PII-safe intent without inventing a nonexistent API.

---

### A4 (INFO, not a gap): Existing `errorMiddleware` already uses `onError`

`apps/api/src/core/middleware/error.ts` already registers `.onError({ as: "global" }, ...)` for VALIDATION / NOT_FOUND / UNAUTHORIZED mapping. D-03 should NOT add a second `app.onError` — it should EXTEND `errorMiddleware` with a `tracker.captureException(error, ...)` call before the status-mapping switch. One file edit, zero new middleware plugins. Keeps the "single on-error site" invariant Phase 17 implicitly relied on. [VERIFIED: codebase]

---

### A5 (INFO, not a gap): `CqrsBus.execute/.query` return `Result<T>`, do NOT throw expected errors

`apps/api/src/core/cqrs.ts` inspection: `execute` returns `Promise<Result<T>>` with `err("COMMAND_NOT_FOUND")` for missing handlers. Handlers themselves return `Result<T>` via `@baseworks/shared`'s `err`/`ok`. D-01's `wrapCqrsBus` captures *thrown exceptions* (unexpected errors inside a handler — DB failure, programmer bug), NOT `Result.err` values. The wrapper must `try { return await bus.execute(...) } catch (err) { tracker.captureException(err, ...); throw err; }` — and must NOT inspect the returned Result's `.success` to call captureException. Only exceptional control flow. [VERIFIED: codebase]

</critical_flags>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Port interface definition | `packages/observability` (shared) | — | Single definition consumed by API + worker |
| Sentry client init + SDK lifecycle | `packages/observability` → `adapters/sentry/` | Consumed by `apps/api` (index.ts + worker.ts) | Adapter owns SDK boot; app owns when to boot |
| pino-sink adapter | `packages/observability` → `adapters/pino/` | Consumes `@baseworks/shared` logger type | No transport, structured logs only |
| PII scrub (pure function) | `packages/observability` → `lib/scrub-pii.ts` | Called by both Sentry + pino adapters | Defense-in-depth, single source of truth |
| `wrapCqrsBus` wrapper | `packages/observability` → `wrappers/` | Applied in `apps/api` registry boot | External — no edits to `core/cqrs.ts` |
| `installGlobalErrorHandlers` | `packages/observability` → `lib/` | Called in both entrypoints | Shared utility, role-agnostic |
| `app.onError` capture wiring | `apps/api` → `src/core/middleware/error.ts` | Extend existing middleware — A4 | Single on-error site invariant |
| Worker `on('failed')` wiring | `apps/api` → `src/worker.ts:57` | Single edit site per CONTEXT | One call site covers all modules |
| Env schema + crash-hard validator | `packages/config` → `src/env.ts` | Imported by both entrypoints | Billing precedent — single env source |
| Source-map CI workflow | `.github/workflows/release.yml` | Consumes `apps/*/dist/` build output | Repo's first workflow; tag-push only |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@sentry/bun` | `^10.49.0` | Sentry/GlitchTip client SDK | First-party Bun SDK (latest stable published 2026-04-16); `@sentry/node` profiling doesn't run under Bun. [VERIFIED: npm registry] |
| `@sentry/cli` | `^3.4.0` | CLI for source map upload | Debug-ID variant requires >=2.17.0; 3.4.0 is current stable (latest tag). [VERIFIED: npm registry] |
| `pino` | already installed `^9` | pino-sink adapter logger | Canonical logger per CLAUDE.md; adapter writes through `apps/api/src/lib/logger.ts`'s exported instance. [VERIFIED: codebase] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@sentry/core` | `^10.49.0` (transitive via `@sentry/bun`) | `createTransport` for test transport helper (A2) | Import only in `test-transport.ts`; not a direct dependency on adapter |
| `@sentry/node` | `^10.49.0` (transitive via `@sentry/bun`) | Integrations like `dedupeIntegration`, `inboundFiltersIntegration` re-exports | Only if Option C in A1 is adopted |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@sentry/bun` | `@sentry/node` | ❌ FORBIDDEN: `@sentry/profiling-node` breaks under Bun (oven-sh/bun#19230); STACK.md lockdown. |
| `@sentry/cli` via `bun x` | `getsentry/action-release` GitHub Action | Marketplace action wraps same CLI; extra layer for minimal benefit. Use direct `bun x sentry-cli` per D-17. |
| Single `MockTransport` export | Custom `createTransport` helper (A2) | No MockTransport exists; custom factory is the only viable path. |

**Installation:**
```bash
# Adapter dependency (packages/observability/package.json)
bun add --filter @baseworks/observability @sentry/bun

# CLI devDependency (root package.json)
bun add -D @sentry/cli
```

**Version verification:**
```bash
npm view @sentry/bun version    # 10.49.0 as of 2026-04-22
npm view @sentry/cli version    # 3.4.0 as of 2026-04-22
```

## Architecture Patterns

### System Architecture Diagram

```
                                       ┌─────────────────────────────┐
     request/job/tag push              │  packages/observability     │
           │                           │  ┌─────────────────────┐    │
           ▼                           │  │  ErrorTracker port  │    │
┌──────────────────────┐  captureException  │  (locked Phase 17)  │    │
│  Capture boundary    │◀──────────────┼─▶│                     │    │
│  (4 sites, D-02..04) │                │  └──────────┬──────────┘    │
└──────────┬───────────┘                │             │               │
           │                            │  ┌──────────┴──────────┐    │
           │  tracker.captureException  │  │     Factory switch  │    │
           ▼                            │  │   ERROR_TRACKER=... │    │
┌──────────────────────┐                │  └──────┬──────┬───────┘    │
│  scrubPii (shared)   │                │         │      │            │
│  (D-12 defense layer)│                │    ┌────┴──┐ ┌─┴────┐ ┌───┐ │
└──────────┬───────────┘                │    │ pino  │ │sentry│ │noop│ │
           │                            │    │(dflt) │ │(2tgt)│ │    │ │
           ├────▶ pino-sink adapter ───▶│    └───────┘ └──┬───┘ └────┘ │
           │                            └───────────────┬─┼────────────┘
           ├────▶ sentry adapter ─── Sentry.init ───────┘ │
           │                                              │
           │                              ┌───────────────┴───────┐
           │                              │  @sentry/bun SDK      │
           │                              │  beforeSend=scrubPii  │
           │                              │  beforeBreadcrumb=    │
           │                              │        scrubPii       │
           │                              │  defaultIntegrations  │
           │                              │        controlled A1  │
           │                              └─────────┬─────────────┘
           │                                        │
           │                              ┌─────────┴─────────────┐
           │                              │   Transport           │
           │                              │   (prod: fetch→DSN)   │
           │                              │   (test: in-memory    │
           │                              │          capture A2)  │
           │                              └───────────────────────┘
           │
           └─── GlitchTip wire protocol (same SDK via DSN swap) ───▶

4 CAPTURE BOUNDARIES (D-01..D-04):
  1. process.on('uncaughtException' | 'unhandledRejection')  → installGlobalErrorHandlers()
  2. app.onError (Elysia)                                   → extend error.ts middleware (A4)
  3. worker.on('failed')                                    → worker.ts:57 one-line add
  4. CqrsBus thrown exceptions                              → wrapCqrsBus() external wrapper

CI PIPELINE (D-16..D-19):
  git tag v1.2.3 → push
     │
     ▼
  .github/workflows/release.yml
     │  RELEASE=$(git rev-parse --short HEAD)
     │
     ├─▶ bun build apps/api/src/index.ts   --sourcemap external --outdir apps/api/dist/
     ├─▶ bun build apps/api/src/worker.ts  --sourcemap external --outdir apps/api/dist/worker/
     ├─▶ bun --cwd apps/admin run build     (Vite: build.sourcemap = true)
     └─▶ bun --cwd apps/web   run build     (Next.js: productionBrowserSourceMaps NOT enabled;
                                             server maps captured via custom config if needed)

  for dir in apps/api/dist apps/admin/dist apps/web/.next:
    bun x sentry-cli sourcemaps inject   $dir
    bun x sentry-cli sourcemaps upload --release=$RELEASE --org=$ORG --project=$PROJ $dir
```

### Recommended Project Structure

```
packages/observability/
├── package.json                        # add @sentry/bun dependency
├── src/
│   ├── index.ts                        # re-export adapters + factories + scrubPii
│   ├── factory.ts                      # extend ERROR_TRACKER switch: pino|sentry|glitchtip
│   ├── ports/
│   │   └── error-tracker.ts            # LOCKED (Phase 17) — no edits
│   ├── adapters/
│   │   ├── noop/
│   │   │   └── noop-error-tracker.ts   # LOCKED — kept as test escape hatch
│   │   ├── pino/
│   │   │   ├── pino-error-tracker.ts   # NEW: full port surface (D-07)
│   │   │   └── __tests__/
│   │   │       └── pino-error-tracker.test.ts
│   │   ├── sentry/
│   │   │   ├── sentry-error-tracker.ts # NEW: serves sentry + glitchtip (D-05)
│   │   │   ├── init-options.ts         # NEW: hard-coded safe Sentry.init (D-15)
│   │   │   └── __tests__/
│   │   │       ├── sentry-error-tracker.test.ts
│   │   │       └── test-transport.ts    # NEW: createTransport helper (A2)
│   │   └── __tests__/
│   │       ├── error-tracker-conformance.test.ts  # NEW: runs fixtures through all 3 (D-11)
│   │       └── pii-fixtures.ts          # NEW: 12-15 fixtures (D-14)
│   ├── lib/
│   │   ├── scrub-pii.ts                 # NEW: single pure function (D-12, D-13)
│   │   └── install-global-error-handlers.ts  # NEW: uncaughtException + unhandledRejection (D-02)
│   └── wrappers/
│       └── wrap-cqrs-bus.ts             # NEW: external CqrsBus wrapper (D-01)

packages/config/src/
└── env.ts                               # EDIT: widen ERROR_TRACKER enum; add SENTRY_DSN/GLITCHTIP_DSN/RELEASE/SENTRY_ENVIRONMENT; fill 'sentry'|'glitchtip' arms of validateObservabilityEnv

apps/api/src/
├── index.ts                             # EDIT: add installGlobalErrorHandlers(getErrorTracker()) after validateObservabilityEnv()
├── worker.ts                            # EDIT: add installGlobalErrorHandlers(...) + extend worker.on('failed') at line 57
└── core/middleware/error.ts             # EDIT: add tracker.captureException(error, ...) before status switch (A4)

apps/api/src/
└── core/cqrs.ts                         # NO EDITS — D-01 invariant

.github/workflows/
└── release.yml                          # NEW FILE — repo's first workflow (D-16)

package.json (root)                      # EDIT: add @sentry/cli to devDependencies
```

### Pattern 1: SentryErrorTracker adapter (single class, two backends)

**What:** One class, ctor takes `{ dsn, kind: 'sentry' | 'glitchtip', ...Sentry.InitOptions }`. Calls `Sentry.init(initOptions(opts))` in ctor. Port methods delegate to Sentry's top-level functions.

**When to use:** For both Sentry and GlitchTip targets. The factory constructs one instance per configured kind.

**Example:**
```ts
// packages/observability/src/adapters/sentry/sentry-error-tracker.ts
import * as Sentry from '@sentry/bun';
import type { ErrorTracker, CaptureScope, ErrorTrackerScope, Breadcrumb } from '../../ports/error-tracker';
import type { LogLevel } from '../../ports/types';
import { buildInitOptions } from './init-options';

export interface SentryErrorTrackerOptions {
  dsn: string;
  kind: 'sentry' | 'glitchtip';
  release?: string;
  environment?: string;
  transport?: Sentry.TransportFactory;  // for tests (A2)
}

export class SentryErrorTracker implements ErrorTracker {
  readonly name: string;

  constructor(private opts: SentryErrorTrackerOptions) {
    this.name = opts.kind;
    Sentry.init(buildInitOptions(opts));
  }

  captureException(err: unknown, scope?: CaptureScope): void {
    // Per Sentry docs: captureException(exception, captureContext?) where
    // captureContext: { user?, level?, extra?, tags?, contexts?, fingerprint? }
    Sentry.captureException(err, scope as Sentry.CaptureContext | undefined);
  }

  captureMessage(message: string, level?: LogLevel): void {
    // Port LogLevel matches Sentry's SeverityLevel ('warning'/'error'/'fatal'/'info'/'debug')
    Sentry.captureMessage(message, level as Sentry.SeverityLevel | undefined);
  }

  addBreadcrumb(breadcrumb: Breadcrumb): void {
    Sentry.addBreadcrumb(breadcrumb);
  }

  withScope<T>(fn: (scope: ErrorTrackerScope) => T): T {
    let result!: T;
    Sentry.withScope((sentryScope) => {
      const portScope: ErrorTrackerScope = {
        setUser: (user) => sentryScope.setUser(user),
        setTag: (key, value) => sentryScope.setTag(key, value),
        setExtra: (key, value) => sentryScope.setExtra(key, value),
        setTenant: (tenantId) => sentryScope.setTag('tenantId', tenantId ?? ''),
      };
      result = fn(portScope);
    });
    return result;
  }

  flush(timeoutMs?: number): Promise<boolean> {
    return Sentry.flush(timeoutMs);
  }
}
```
[CITED: docs.sentry.io/platforms/javascript/guides/bun/configuration/apis/]

### Pattern 2: pino-sink with ring-buffer breadcrumbs

**What:** Pino adapter that accumulates breadcrumbs in a bounded ring buffer per adapter instance; on `captureException`, scrub + serialize buffer to `extra.breadcrumbs`, emit single `logger.error(...)`, clear buffer.

**Key invariant:** `withScope(fn)` creates a pino child with scope fields merged — the child lives for the callback's lifetime only. Concurrent `withScope` calls must not leak each other's scope fields (match port contract). Implementation: the adapter maintains per-call scope by passing an `ErrorTrackerScope` that writes to a local `Record<string, unknown>`, which is passed to `logger.child(...)` only when captures happen inside the callback.

**Example skeleton:**
```ts
// packages/observability/src/adapters/pino/pino-error-tracker.ts
import { scrubPii } from '../../lib/scrub-pii';
import type { Logger } from 'pino';

const BREADCRUMB_BUFFER_SIZE = 10;

export class PinoErrorTracker implements ErrorTracker {
  readonly name = 'pino';
  private breadcrumbs: Breadcrumb[] = [];

  constructor(private logger: Logger) {}

  captureException(err: unknown, scope?: CaptureScope): void {
    const event = scrubPii({
      err: err instanceof Error ? { message: err.message, stack: err.stack, name: err.name } : String(err),
      user: scope?.user, tags: scope?.tags, extra: { ...scope?.extra, breadcrumbs: [...this.breadcrumbs] },
      tenantId: scope?.tenantId,
    });
    this.logger.error(event, 'captured exception');
    this.breadcrumbs = [];
  }

  // captureMessage, addBreadcrumb (with ring eviction), withScope, flush...
}
```

### Pattern 3: PII scrubber — shared pure function

**What:** Recursive deep-walk of an event-shaped object. Three-stage: (1) key denylist replaces values with marker; (2) string regex patterns applied to surviving string leaves; (3) route rule drops `event.request.data` for webhook paths.

**Key decision (discretion):** Whether denylist is constant or constructed at module init from env. RECOMMEND: module-init construction — reads `env.OBS_PII_DENY_EXTRA_KEYS` once, builds a `Set<string>` of lowercased keys, exports a `scrubPii` closed over that set. Zero runtime env reads, simple memoization, easy test (reset module between tests).

**Example signature:**
```ts
// packages/observability/src/lib/scrub-pii.ts
export type PiiEvent = Record<string, unknown>;

export function scrubPii(event: PiiEvent): PiiEvent {
  // Deep-clone-and-transform; never mutate input
  // 1. Walk all keys recursively; if key matches denylist → replace value with '[redacted:<key>]'
  // 2. On string leaves → apply regex patterns
  // 3. If event.request?.url matches /\/api\/webhooks\//, delete event.request.data
  // Returns the scrubbed event (or null to drop — not used in D-13, but Sentry supports it)
}
```

Must return `null | PiiEvent` to satisfy Sentry's `beforeSend: (event, hint) => Event | null` signature. D-13 does not currently use null-to-drop; if added, document it.

### Pattern 4: wrapCqrsBus external wrapper (A5-aware)

**What:** A function that takes `bus: CqrsBus` and `tracker: ErrorTracker`, returns a new object with the same shape but `execute`/`query` wrapped in try/catch.

**Key invariant (A5):** Only catch *thrown exceptions*, not `Result.err`. The current `bus.execute` returns `Promise<Result<T>>` — a `Result.err("COMMAND_NOT_FOUND")` is normal flow, not an error.

**Example:**
```ts
// packages/observability/src/wrappers/wrap-cqrs-bus.ts
import type { ErrorTracker } from '../ports/error-tracker';

// Narrow type to avoid cross-package type cycles; CqrsBus type imported at use site.
export interface BusLike {
  execute<T>(command: string, input: unknown, ctx: any): Promise<any>;
  query<T>(queryName: string, input: unknown, ctx: any): Promise<any>;
}

export function wrapCqrsBus<B extends BusLike>(bus: B, tracker: ErrorTracker): B {
  const origExecute = bus.execute.bind(bus);
  const origQuery = bus.query.bind(bus);

  (bus as any).execute = async (command: string, input: unknown, ctx: any) => {
    try {
      return await origExecute(command, input, ctx);
    } catch (err) {
      tracker.captureException(err, { extra: { commandName: command }, tenantId: ctx?.tenantId });
      throw err;
    }
  };
  (bus as any).query = async (queryName: string, input: unknown, ctx: any) => {
    try {
      return await origQuery(queryName, input, ctx);
    } catch (err) {
      tracker.captureException(err, { extra: { queryName }, tenantId: ctx?.tenantId });
      throw err;
    }
  };

  return bus;
}
```

**Wire-up site (Claude's discretion):** single call at registry boot vs per-module. RECOMMEND: single call in `apps/api/src/index.ts` + `apps/api/src/worker.ts` after `registry.loadAll()`:
```ts
const cqrs = wrapCqrsBus(registry.getCqrs(), getErrorTracker());
```
This is simpler, catches all modules including future additions, matches Phase 19's "single external wrapper" plan for ALS context.

### Anti-Patterns to Avoid

- **Importing `@sentry/node` anywhere in the repo:** CLAUDE.md forbids it; STACK.md locks on `@sentry/bun`. Even transitive imports through tests are a code review red flag.
- **Inlining `Sentry.init` inside `SentryErrorTracker` ctor without `init-options.ts`:** the factory function in `init-options.ts` is what lets tests override options (e.g., transport, defaultIntegrations). Keep ctor dumb; keep options calculable.
- **Shared mutable state in `scrubPii`:** the scrubber must be pure (input → output). Any cached "recently redacted" state leaks across calls and breaks test isolation.
- **Using `Sentry.close()` in `flush-on-exit`:** `close` permanently disables the SDK. D-02 calls `flush(2000)` then `process.exit(1)` — correct; don't accidentally substitute `close`.
- **Tagging `route` with raw pathname in `app.onError`:** cardinality explosion per STACK.md Pitfall 4. See A3.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stack-trace capture / normalization | Custom error serializer | `@sentry/bun` `captureException` | Handles cause chains, CJS/ESM stack parsing, async stack traces. Re-implementing misses frame-resolution edge cases. |
| Deduplication of identical errors in close succession | Rolling hash of error.message | Sentry `dedupeIntegration` | Built-in, battle-tested, dedupes by fingerprint (not message). If using Option C in A1, add it back explicitly. |
| Debug-ID source-map matching | Manual `.map` ↔ `.js` sha256 keyed filename scheme | `sentry-cli sourcemaps inject` + `upload` | Debug ID is a Sentry/source-map-spec standard since 2024; hand-rolling means no compatibility with Sentry's demangler. |
| Stripping PII from arbitrary nested objects | Tuple-iteration deep walker ad-hoc | Write one `scrubPii` module, add extensive tests | HAND-ROLL EXPECTED here because no off-the-shelf library covers Baseworks' key denylist (CPF/CNPJ, Brazilian PII). But centralize it; don't scatter inline redactions. |
| Breadcrumb ring buffer | Unbounded array pushed to, manually trimmed | Small `CappedArray<T>` helper in `lib/ring-buffer.ts` | Boundedness is load-bearing — unbounded breadcrumbs leak memory in long-running workers. Ten lines; don't inline. |
| Structured error event shape | Ad-hoc object keys per call-site | Port's `CaptureScope` type | Contract is locked by Phase 17; stay inside the types. |

**Key insight:** The only genuinely custom code in Phase 18 is the domain-specific PII denylist (`scrubPii`) and the port-to-SDK adapters. Everything else leans on `@sentry/bun` + `sentry-cli`.

## Runtime State Inventory

Not a rename/refactor phase — no runtime state migration required. Phase 18 adds new code paths; does not rename or move existing state.

- Stored data: None — no existing error records to migrate.
- Live service config: Sentry/GlitchTip project-level scrubbing rules are explicitly deferred to Phase 23 (documentation only, no code in Phase 18).
- OS-registered state: None.
- Secrets/env vars: New env vars (`SENTRY_DSN`, `GLITCHTIP_DSN`, `RELEASE`, `SENTRY_ENVIRONMENT`, optional `OBS_PII_DENY_EXTRA_KEYS`) are ADDED — no renames. CI secrets (`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`) are NEW and must be set in GitHub repo secrets as part of Plan rollout.
- Build artifacts: None affected — new `apps/*/dist/` output layouts become required by the release workflow but didn't previously exist as a gated artifact.

## Common Pitfalls

### Pitfall 1: Default integrations double-register global handlers (see A1)

**What goes wrong:** CONTEXT D-15 `integrations: []` is inert — defaults still install `onUncaughtException` + `onUnhandledRejection`. D-02 then adds a second layer. Two handlers fire per uncaught exception → duplicate Sentry events + racy exit.
**Why it happens:** Sentry API documentation distinguishes `integrations` (additive) from `defaultIntegrations` (toggleable). D-15 conflates them.
**How to avoid:** Use `defaultIntegrations: false` + a minimal additive list (Option C in A1) OR drop D-02 and rely on defaults (Option B). Don't leave both in place.
**Warning signs:** Duplicate Sentry issues for one crash; process hangs briefly after uncaughtException instead of exiting at exit code 1.

### Pitfall 2: Webhook body leaks via `requestDataIntegration`

**What goes wrong:** Sentry auto-captures request bodies on HTTP-integrated errors. Stripe/Pagar.me webhook bodies land in breadcrumbs/events.
**Why it happens:** `requestDataIntegration` is default-enabled in `@sentry/bun` (see A1 list).
**How to avoid:** D-13's route rule (drop `request.data` on `/api/webhooks/**`) runs in `beforeSend` — this IS the fix, as long as the route rule executes on EVERY event shape the integration emits. Verify by conformance fixture (D-14 already covers).
**Warning signs:** Sentry events from the webhook routes show non-empty `request.data`.

### Pitfall 3: `request.route` doesn't exist on Elysia Context (see A3)

**What goes wrong:** D-03 code fails type-check or tags `undefined`.
**Why it happens:** Elysia's public Context API provides `path` (concrete) but no route template.
**How to avoid:** Drop the `route` tag in Phase 18; add it in Phase 19 via middleware that has access to the matched route.
**Warning signs:** TypeScript errors on `request.route`, or Sentry events with `tags.route: undefined`.

### Pitfall 4: pino-sink scope leaks across concurrent withScope calls

**What goes wrong:** If the adapter stores scope as an instance field, concurrent requests' scopes mix — tenantA sees tenantB's fields.
**Why it happens:** Bun is single-threaded but async — concurrent requests interleave between `await` points. Instance-field scope = cross-request leakage.
**How to avoid:** `withScope(fn)` must scope via closure, NOT instance state. The ErrorTrackerScope given to `fn` writes to a local object; that local is used for the captures inside `fn` and garbage-collected after.
**Warning signs:** Under concurrent load test, tenant IDs appear with wrong requests in pino output. Tests must exercise `Promise.all` of 50 parallel withScope calls to catch this.

### Pitfall 5: Source maps linked in production assets (published to browser)

**What goes wrong:** Stack traces demangled in DevTools — reverses minification, exposes source to public.
**Why it happens:** Accidentally using `bun build --sourcemap=linked` (inserts `//# sourceMappingURL` comment pointing to the `.map`) instead of `--sourcemap=external` (Debug ID, no URL comment).
**How to avoid:** D-18 says `--sourcemap=external` for api/worker (this produces `.map` file with `debugId` and NO sourceMappingURL comment — Debug ID is baked into the emitted bundle). For admin (Vite), `build.sourcemap: true` produces linked maps but the `.map` files must NOT be deployed with the built admin SPA. For Next.js web: DO NOT enable `productionBrowserSourceMaps` — it publishes `.map` files to the browser. Instead, rely on Next.js's server-side source maps (emitted by default into `.next/` but not shipped in public output) and only upload those.
**Warning signs:** Fetching `https://<app>/index-abc.js.map` from the public web returns 200.

[VERIFIED: bun.com/docs/bundler — "external" value "does not insert a //# sourceMappingURL comment"]

### Pitfall 6: RELEASE drifts between build-time, runtime, and upload

**What goes wrong:** CI uploads maps against `release=abc1234`; runtime reports `release=def5678`; Sentry can't match the stack trace to the uploaded maps → demangled frames empty.
**Why it happens:** Forgot to pass `--define process.env.RELEASE=\"$RELEASE\"` to bun build, or runtime falls back to `process.env.RELEASE` at deploy time which was never set.
**How to avoid:** D-19 is the prescription — CI exports `RELEASE` once, then passes it to build-define AND to the sentry-cli upload flags. Runtime reads `env.RELEASE` which was baked in at build. Add a CI assertion: `grep "const RELEASE" apps/api/dist/*.js` finds the baked SHA.
**Warning signs:** Sentry issues missing the "Release" sidebar; Source Maps tab says "No matching source map."

### Pitfall 7: Conformance test uses the real network by accident

**What goes wrong:** `new SentryErrorTracker({ dsn: 'http://public@sentry.io/1' })` without a test transport → real network calls, leaked PII to Sentry cloud.
**Why it happens:** Copy-pasting init options from docs; forgetting the test transport (A2).
**How to avoid:** Test transport (A2) is the ONLY path — assert by searching for `transport: makeTestTransport` in any test. Add a CI lint/grep check that no test file imports `@sentry/bun` without also importing `makeTestTransport`.
**Warning signs:** `bun test` makes outbound network calls; test DSN ends in `sentry.io` (use `example.com`).

## Code Examples

### Example 1: `installGlobalErrorHandlers` (D-02)

```ts
// packages/observability/src/lib/install-global-error-handlers.ts
import type { ErrorTracker } from '../ports/error-tracker';

/**
 * Register process-level uncaughtException + unhandledRejection handlers.
 * Each handler captures via the tracker, flushes with a bounded timeout,
 * then exits non-zero. Safe to call once per process (idempotent check
 * via a WeakSet for reinstallation in tests).
 */
const INSTALLED = new WeakSet<ErrorTracker>();

export function installGlobalErrorHandlers(tracker: ErrorTracker): void {
  if (INSTALLED.has(tracker)) return;
  INSTALLED.add(tracker);

  const handle = async (err: unknown, kind: 'uncaughtException' | 'unhandledRejection') => {
    try {
      tracker.captureException(err, { extra: { handler: kind } });
      await tracker.flush(2000);
    } catch {
      // Never let the handler itself throw — we're already crashing.
    } finally {
      process.exit(1);
    }
  };

  process.on('uncaughtException', (err) => { void handle(err, 'uncaughtException'); });
  process.on('unhandledRejection', (reason) => { void handle(reason, 'unhandledRejection'); });
}
```

### Example 2: Sentry `init-options.ts` with A1 Option C applied

```ts
// packages/observability/src/adapters/sentry/init-options.ts
import * as Sentry from '@sentry/bun';
import { scrubPii } from '../../lib/scrub-pii';
import type { SentryErrorTrackerOptions } from './sentry-error-tracker';

export function buildInitOptions(opts: SentryErrorTrackerOptions): Parameters<typeof Sentry.init>[0] {
  return {
    dsn: opts.dsn,
    release: opts.release,
    environment: opts.environment,
    sendDefaultPii: false,  // hard-coded per Pitfall 6 / CLAUDE.md
    beforeSend: (event, hint) => scrubPii(event) as any,
    beforeBreadcrumb: (bc, hint) => scrubPii(bc) as any,
    // A1 resolution — Option C (recommended): disable defaults, re-add safe ones.
    defaultIntegrations: false,
    integrations: [
      Sentry.inboundFiltersIntegration(),
      Sentry.dedupeIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.functionToStringIntegration(),
    ],
    transport: opts.transport,
  };
}
```

### Example 3: Test transport helper (A2)

```ts
// packages/observability/src/adapters/sentry/__tests__/test-transport.ts
import { createTransport } from '@sentry/core';
import type { Envelope, Transport, TransportMakeRequestResponse } from '@sentry/core';

export interface TestTransportHandle {
  transport: (options: any) => Transport;
  captured: Envelope[];
  reset: () => void;
}

export function makeTestTransport(): TestTransportHandle {
  const captured: Envelope[] = [];

  const factory = (options: any): Transport =>
    createTransport(options, async (req: { body: string | Uint8Array }) => {
      // The real envelope parser is in @sentry/core; for tests, store the raw body.
      // Tests can parse/assert on the envelope bytes.
      captured.push(req.body as unknown as Envelope);
      return { statusCode: 200 } as TransportMakeRequestResponse;
    });

  return {
    transport: factory,
    captured,
    reset: () => { captured.length = 0; },
  };
}
```

### Example 4: Conformance test skeleton (D-11, mirrors billing pattern)

```ts
// packages/observability/src/adapters/__tests__/error-tracker-conformance.test.ts
import { describe, test, expect, beforeEach } from 'bun:test';
import { PII_FIXTURES, type PiiFixture } from './pii-fixtures';
import { PinoErrorTracker } from '../pino/pino-error-tracker';
import { NoopErrorTracker } from '../noop/noop-error-tracker';
import { SentryErrorTracker } from '../sentry/sentry-error-tracker';
import { makeTestTransport } from '../sentry/__tests__/test-transport';
import { pino } from 'pino';

// Same structure as billing's pattern: one `describe` per adapter, inner table-driven over fixtures.
describe('ErrorTracker conformance: PII scrubbing', () => {
  describe('pino adapter', () => {
    let logged: unknown[];
    let tracker: PinoErrorTracker;

    beforeEach(() => {
      logged = [];
      const fakeLogger = pino({ level: 'error' }, {
        write: (chunk: string) => { logged.push(JSON.parse(chunk)); },
      });
      tracker = new PinoErrorTracker(fakeLogger);
    });

    for (const fixture of PII_FIXTURES) {
      test(`[${fixture.name}] redacts expected fields`, () => {
        tracker.captureException(fixture.input.err, fixture.input.scope);
        expect(logged).toHaveLength(1);
        expect(logged[0]).toMatchObject(fixture.expected);
        // Positive assertion: fields in denyList.shouldSurvive remain
        for (const key of fixture.shouldSurvive ?? []) {
          expect(JSON.stringify(logged[0])).toContain(key);
        }
        // Negative assertion: fields in denyList.shouldNotAppear never present
        for (const secret of fixture.shouldNotAppear ?? []) {
          expect(JSON.stringify(logged[0])).not.toContain(secret);
        }
      });
    }
  });

  describe('sentry adapter', () => {
    let handle: ReturnType<typeof makeTestTransport>;
    let tracker: SentryErrorTracker;

    beforeEach(() => {
      handle = makeTestTransport();
      tracker = new SentryErrorTracker({
        dsn: 'http://public@example.com/1',
        kind: 'sentry',
        transport: handle.transport,
      });
    });

    for (const fixture of PII_FIXTURES) {
      test(`[${fixture.name}] redacts expected fields`, async () => {
        tracker.captureException(fixture.input.err, fixture.input.scope);
        await tracker.flush(100);
        expect(handle.captured).toHaveLength(1);
        // Parse envelope, walk event, assert redaction
        // ... shape assertions mirror pino case
      });
    }
  });

  // Optional: parity test — feed the same fixture to both, diff the normalized events
});
```

### Example 5: `release.yml` skeleton (D-16..D-19)

```yaml
# .github/workflows/release.yml
name: Release — upload source maps
on:
  push:
    tags:
      - 'v*.*.*'

jobs:
  upload-sourcemaps:
    runs-on: ubuntu-latest
    env:
      SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
      SENTRY_ORG: ${{ secrets.SENTRY_ORG }}
      SENTRY_PROJECT: ${{ secrets.SENTRY_PROJECT }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # git rev-parse --short needs history

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Compute RELEASE (short SHA)
        id: rel
        run: echo "release=$(git rev-parse --short HEAD)" >> "$GITHUB_OUTPUT"

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build apps/api (+worker bundle)
        env:
          RELEASE: ${{ steps.rel.outputs.release }}
        run: |
          bun build apps/api/src/index.ts  --outdir apps/api/dist       --target bun --sourcemap external --define "process.env.RELEASE=\"$RELEASE\""
          bun build apps/api/src/worker.ts --outdir apps/api/dist/worker --target bun --sourcemap external --define "process.env.RELEASE=\"$RELEASE\""

      - name: Build apps/admin (Vite)
        env:
          VITE_RELEASE: ${{ steps.rel.outputs.release }}
        run: bun --cwd apps/admin run build

      - name: Build apps/web (Next.js)
        run: bun --cwd apps/web run build

      - name: Inject + upload source maps
        env:
          RELEASE: ${{ steps.rel.outputs.release }}
        run: |
          for DIR in apps/api/dist apps/admin/dist apps/web/.next; do
            bun x sentry-cli sourcemaps inject  "$DIR"
            bun x sentry-cli sourcemaps upload  --release="$RELEASE" --org="$SENTRY_ORG" --project="$SENTRY_PROJECT" "$DIR"
          done
```

[CITED: docs.sentry.io/platforms/javascript/guides/bun/sourcemaps/uploading/cli/; github.com/oven-sh/setup-bun v2.2.0]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sentry release + dist matching by filename hash | Debug ID variant (embedded ID in bundle + `.map`) | sentry-cli 2.17+ / 2024 | Filename-independent matching; resilient to CDN renames. Current and recommended. |
| `@sentry/node` on Bun with polyfills | `@sentry/bun` first-party SDK | `@sentry/bun` GA early 2024 | Profiling addon no longer breaks; Bun-native `Bun.serve` integration. |
| GlitchTip separate SDK | `@sentry/bun` + DSN swap | GlitchTip 6 (Feb 2026) | Single client; parity guaranteed by wire-protocol alignment. |
| pino transport for OTEL export | `@opentelemetry/instrumentation-pino` | 2024 | Deferred to Phase 19 in Baseworks; Phase 18 pino-sink is error-only. |
| `AsyncLocalStorage.enterWith` | `AsyncLocalStorage.run(ctx, fn)` | N/A (always) | Forbidden; Phase 19 ships the Biome rule. Phase 18's `wrapCqrsBus` does not use ALS — that's Phase 19's extension. |

**Deprecated / outdated:**
- `Sentry.close()` in flush-on-exit: use `flush` + `exit(1)` per D-02.
- `sendDefaultPii: true`: forbidden by CLAUDE.md + STACK.md.
- Single-file executable (`bun build --compile`) for API image: breaks SDK auto-instrumentations (STACK.md).
- `MockTransport` naming: never existed; don't invent it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `Sentry.dedupeIntegration()`, `Sentry.inboundFiltersIntegration()`, `Sentry.linkedErrorsIntegration()`, `Sentry.functionToStringIntegration()` are re-exported from `@sentry/bun` (Option C fallback). | Pattern 2 / Example 2 | If not re-exported, import from `@sentry/core` instead — one-line change per integration. Verify at plan time: `grep -E "export.*Integration" node_modules/@sentry/bun/build/esm/index.js`. |
| A2 | `@sentry/core`'s `createTransport` export signature is stable in 10.x (takes `{ recordDroppedEvent, textEncoder }` plus a request-handler). | A2 / Example 3 | If signature changed in 10.x, update the test helper. Low impact: 5-line fix. [VERIFIED: sentry-javascript Discussion #6826 pattern recommended for 10.x] |
| A3 | The existing `errorMiddleware` in `apps/api/src/core/middleware/error.ts` can be extended with a `tracker.captureException` call without breaking its `{ as: "global" }` scope. | A4 / Integration Points | Low risk — `tracker.captureException` is a side-effect that does not alter the middleware's return value. |
| A4 | Next.js 15 emits server-side source maps into `.next/` by default when `next build` is run, and `sentry-cli sourcemaps upload .next` picks them up. | D-18 / Example 5 | Next.js 15 + Turbopack has automatic Sentry upload via `@sentry/nextjs` wrapper. If we don't use `@sentry/nextjs` wrapper, we need to verify manual upload against `.next/`. Researching this in Phase 18 plan is recommended; fallback is to limit source-map upload to api/worker/admin and ship Next.js-side in a follow-up. [CITED: docs.sentry.io/platforms/javascript/guides/nextjs/sourcemaps/] |
| A5 | `worker.on('failed')` at `apps/api/src/worker.ts:57` remains the single failure-capture site after potential BullMQ upgrades. | D-04 | Stable — BullMQ 5.x worker event API is not slated for breaking change. |
| A6 | `bun x sentry-cli` works in GitHub Actions when `@sentry/cli` is a devDependency — resolves to `node_modules/.bin/sentry-cli`. | D-17 / Example 5 | Alternative: `npx` or `bunx` — both functionally equivalent on GH runners. If `bun x` surprises, swap. |

**If any claim is wrong:** update adapter/test code; no structural change. All 6 assumptions have concrete verification paths listed.

## Open Questions

1. **`@sentry/bun` integration re-export surface (A1 Option C)**
   - What we know: `@sentry/bun` re-exports extensively from `@sentry/core` and `@sentry/node`.
   - What's unclear: whether `dedupeIntegration` etc. are re-exported by name, or if we need `import { dedupeIntegration } from '@sentry/core'`.
   - Recommendation: Plan author runs `bun repl` or greps `node_modules/@sentry/bun` after install; uses whichever import works. Trivial difference.

2. **Next.js 15 server-side source-map upload mechanics**
   - What we know: `productionBrowserSourceMaps` publishes maps to the public — don't use it. Next.js emits some server maps into `.next/` by default.
   - What's unclear: exact file layout of Next.js server maps (are they `.map` files next to `.js`? named differently?). `@sentry/nextjs`'s official integration handles this automatically but pulls in a wrapper config we may not want.
   - Recommendation: Phase 18 plan explicitly researches this, with fallback to "upload api + worker + admin only in Phase 18; add web-server-side in a follow-up quick task" if the mechanics are messier than hoped.

3. **Elysia route-template extraction in `onError` context**
   - What we know: Context has no documented `route` property.
   - What's unclear: whether Elysia 1.x exposes `route.template` or similar as an internal field (read source at plan time).
   - Recommendation: Default to dropping the `route` tag (A3 Option 1). Revisit in Phase 19 where middleware has the route in scope.

4. **GlitchTip 6 compatibility with `sentry-cli@3.4.0`**
   - What we know: GlitchTip 6 (Feb 2026) supports Sentry wire protocol; earlier versions had source-map-upload redirect-follow bugs.
   - What's unclear: whether `sentry-cli@3.4.0` specifically works against GlitchTip 6's endpoint.
   - Recommendation: CONTEXT says "works against both" — trust it for Phase 18. If Success Criterion #4 test fails against GlitchTip, file a follow-up.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| `@sentry/bun` | SentryErrorTracker adapter | ✗ (to install) | target `^10.49.0` | — |
| `@sentry/cli` | Release workflow | ✗ (to install as devDep) | target `^3.4.0` | GitHub Action `getsentry/action-release` (not preferred per A1 "Claude's discretion") |
| Bun runtime | Build + test | ✓ (locally and in `oven-sh/setup-bun@v2`) | `1.1+` | — |
| `pino` | pino-sink adapter | ✓ (installed) | `^9` | — |
| `@baseworks/config` + `@baseworks/observability` + `@baseworks/shared` workspace packages | All | ✓ | — | — |
| GitHub Actions secrets: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | release.yml | ✗ (operator config) | — | Planner must include "configure repo secrets" as a manual step in the execution checklist. |
| `git` in CI | RELEASE SHA computation | ✓ (default on ubuntu-latest) | — | — |

**Missing dependencies with no fallback:**
- CI secrets: operator must add `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` to repo secrets before the workflow can succeed. First `v*.*.*` push will fail if they're absent — not a blocker for code, but a planned manual step.

**Missing dependencies with fallback:**
- `@sentry/cli`: GitHub Action `getsentry/action-release` can substitute for local CLI. Not recommended — extra abstraction layer.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun test` (built-in, per CLAUDE.md + existing Phase 17 tests) |
| Config file | None — `bun test` uses zero-config discovery on `**/*.test.ts` |
| Quick run command | `bun test packages/observability/src/adapters` |
| Full suite command | `bun test` (repo-root) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ERR-01 | `SentryErrorTracker` captures via `@sentry/bun`, emits to transport | unit | `bun test packages/observability/src/adapters/sentry` | ❌ Wave 0 |
| ERR-01 | Uncaught exception → captured via `installGlobalErrorHandlers` | integration (subprocess) | `bun test packages/observability/src/lib/__tests__/install-global-error-handlers.test.ts` | ❌ Wave 0 |
| ERR-01 | BullMQ job failure → tracker.captureException called | unit | `bun test apps/api/src/__tests__/worker-failed-capture.test.ts` | ❌ Wave 0 |
| ERR-02 | GlitchTip parity: identical event shape for sentry and glitchtip kinds | unit | `bun test packages/observability/src/adapters/__tests__/error-tracker-conformance.test.ts` (parity cases) | ❌ Wave 0 |
| ERR-03 | `pino-sink` writes structured event at ERROR level; zero network | unit | `bun test packages/observability/src/adapters/pino` | ❌ Wave 0 |
| ERR-03 | `pino-sink` default when `ERROR_TRACKER` unset | unit | `bun test packages/observability/src/__tests__/factory.test.ts` (extend existing) | ⚠️ Extend existing |
| ERR-04 | PII fixtures redacted across all adapters | unit | `bun test packages/observability/src/adapters/__tests__/error-tracker-conformance.test.ts` | ❌ Wave 0 |
| ERR-04 | `scrubPii` unit tests (nested keys, regex patterns, route rule, env extension) | unit | `bun test packages/observability/src/lib/__tests__/scrub-pii.test.ts` | ❌ Wave 0 |
| ERR-04 | Context enrichment: captureException carries tenantId/userId/request_id/command | unit | part of conformance test | ❌ Wave 0 |
| EXT-01 | release.yml workflow syntax valid; builds produce source maps | CI | GitHub Actions on pushed tag (manual test post-merge); local `bun build ... --sourcemap external` smoke | ❌ Wave 0 (workflow); ⚠️ smoke verifiable locally |
| EXT-01 | Post-deploy: deliberately-failing endpoint produces demangled stack trace | manual | Operator hits test endpoint after release tag deploy; inspects Sentry issue | Manual — see Success Criterion #4 |

### Sampling Rate

- **Per task commit:** `bun test packages/observability` (covers port, adapters, scrubber, wrapper — fast, <5s)
- **Per wave merge:** `bun test` (full repo — includes apps/api captures + existing Phase 17 telemetry tests)
- **Phase gate:** Full suite green + one end-to-end check: `bun build apps/api/src/index.ts --outdir apps/api/dist --sourcemap external` produces `.map` files containing `"debug_id"` JSON property.

### Wave 0 Gaps

- [ ] `packages/observability/src/adapters/__tests__/error-tracker-conformance.test.ts` — conformance fixture runner (D-11)
- [ ] `packages/observability/src/adapters/__tests__/pii-fixtures.ts` — 12–15 fixtures (D-14)
- [ ] `packages/observability/src/lib/__tests__/scrub-pii.test.ts` — unit tests for the scrubber (keys, regex, route rule, env extension)
- [ ] `packages/observability/src/lib/__tests__/install-global-error-handlers.test.ts` — subprocess-based test (mirror `apps/api/__tests__/telemetry-boot.test.ts` pattern) asserting tracker.captureException + flush + exit(1) fire
- [ ] `packages/observability/src/adapters/pino/__tests__/pino-error-tracker.test.ts`
- [ ] `packages/observability/src/adapters/sentry/__tests__/sentry-error-tracker.test.ts`
- [ ] `packages/observability/src/adapters/sentry/__tests__/test-transport.ts` — test helper (A2)
- [ ] `packages/observability/src/wrappers/__tests__/wrap-cqrs-bus.test.ts` — assert throws captured, Result.err not captured (A5)
- [ ] `apps/api/src/__tests__/worker-failed-capture.test.ts` — assert worker.on('failed') calls captureException

Existing `packages/observability/src/__tests__/factory.test.ts` may exist; if so, extend with `ERROR_TRACKER=pino/sentry/glitchtip` cases; if not, add to Wave 0.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (Phase 18 does not touch auth flows) | — |
| V3 Session Management | indirect | Must ensure `scrubPii` redacts session cookies / tokens; verified by fixture D-14 better-auth session case. |
| V4 Access Control | no | — |
| V5 Input Validation | yes (Zod env schema) | `z.enum(...)` for `ERROR_TRACKER`, `z.string().url()` for DSNs; cross-field validator `validateObservabilityEnv()` is crash-hard. Matches billing precedent. |
| V6 Cryptography | no (Sentry handles envelope encryption / TLS) | Never hand-roll transport encryption. |
| V7 Error Handling & Logging | **yes — the entire Phase 18 surface area** | scrubPii (D-12/D-13); `sendDefaultPii: false` hard-coded (D-15); webhook body drop rule; conformance fixture suite (D-14) is the verification gate. |
| V8 Data Protection | yes (GDPR/LGPD per Pitfall 10) | No PII in error events → no data-subject erasure obligations on error store. Server-side scrubbing in Sentry project settings as third layer (Phase 23 runbook). |
| V9 Communication | partial | Sentry DSN is an HTTPS URL — enforced by `z.string().url()`. Source-map upload to Sentry uses HTTPS. |
| V10 Malicious Code | no | — |
| V12 Files & Resources | yes (source maps) | Source maps MUST NOT be published with built assets (Pitfall 9). `bun build --sourcemap external` + upload-to-Sentry-only pattern enforces this; release.yml checks `.map` files are not in the final deployed artifact. |
| V13 API | no direct | Rate-limiting on `/api/*` is a separate concern. |
| V14 Configuration | yes | `defaultIntegrations: false` (per A1) prevents Bun.serve auto-patching; env schema crash-hard prevents boot with misconfigured DSN. |

### Known Threat Patterns for Bun + Elysia + @sentry/bun stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| PII leak via `sendDefaultPii: true` | Information disclosure | Hard-coded `sendDefaultPii: false`; no env override (D-15). |
| PII leak via `requestDataIntegration` capturing webhook bodies | Information disclosure | D-13 route rule; verified by D-14 fixtures. |
| PII in error message interpolation (`` `failed for ${email}` ``) | Information disclosure | `scrubPii` regex pass on `event.message` + `exception.values[*].value`; fixture D-14 covers. |
| Source maps exposed publicly (reverses minification) | Information disclosure | `bun build --sourcemap external` (Debug ID — no sourceMappingURL comment); upload-to-Sentry-only; CI check no `.map` in public output. |
| Double global-handler race (A1) | Denial of service / inconsistent exit | Resolve A1 — pick one of three options. |
| CI `SENTRY_AUTH_TOKEN` leak via log echo | Credentials exposure | GitHub Actions masks secret env vars automatically — `env:` block references them without `echo`. Don't `set -x`. |
| Release SHA drift masks stack traces | Integrity | D-19 single-source discipline; CI assertion `grep RELEASE apps/api/dist/*.js`. |

## Sources

### Primary (HIGH confidence)

- `@sentry/bun` npm page + `npm view` — version `10.49.0` published 2026-04-16. [VERIFIED: npm registry]
- `@sentry/cli` npm page + `npm view` — version `3.4.0` current. [VERIFIED: npm registry]
- Sentry Bun configuration/options docs — https://docs.sentry.io/platforms/javascript/guides/bun/configuration/options/
- Sentry Bun configuration/integrations docs — https://docs.sentry.io/platforms/javascript/guides/bun/configuration/integrations/
- Sentry Bun configuration/draining docs (flush semantics) — https://docs.sentry.io/platforms/javascript/guides/bun/configuration/draining/
- Sentry Bun configuration/apis docs (function signatures) — https://docs.sentry.io/platforms/javascript/guides/bun/configuration/apis/
- Sentry source-maps uploading/cli docs — https://docs.sentry.io/platforms/javascript/guides/bun/sourcemaps/uploading/cli/
- `@sentry/bun` source — `packages/bun/src/sdk.ts` on develop branch (`getDefaultIntegrations` body)
- Bun bundler docs — https://bun.com/docs/bundler (sourcemap values: none / linked / external / inline)
- oven-sh/setup-bun v2.2.0 (2026-03-14) — https://github.com/oven-sh/setup-bun
- Elysia Lifecycle / Handler docs — https://elysiajs.com/essential/life-cycle, https://elysiajs.com/essential/handler
- `.planning/research/PITFALLS.md` §Pitfall 6 (Sentry PII) and §Pitfall 9/12 (source maps + release tracking)
- `.planning/research/STACK.md` §Recommended Stack (@sentry/bun, `@sentry/profiling-node` broken under Bun)
- Baseworks codebase: `packages/observability/src/ports/error-tracker.ts`, `packages/observability/src/factory.ts`, `apps/api/src/index.ts`, `apps/api/src/worker.ts`, `apps/api/src/core/cqrs.ts`, `apps/api/src/core/middleware/error.ts`, `packages/config/src/env.ts`, `apps/api/src/telemetry.ts`, `apps/api/__tests__/telemetry-boot.test.ts` [VERIFIED: read during research]
- `apps/api/src/core/registry.ts` — for wrapCqrsBus wire-up site identification [VERIFIED: read]

### Secondary (MEDIUM confidence)

- GitHub Issue getsentry/sentry-javascript#6826 "Testing an integration" — `createTransport` pattern for custom test transports
- Next.js 15 source-map docs (Turbopack + Sentry) — https://docs.sentry.io/platforms/javascript/guides/nextjs/sourcemaps/ (partial — manual setup details vary)
- GlitchTip 6 release notes (Feb 2026) — per STACK.md references

### Tertiary (LOW confidence)

- None required for Phase 18 scope.

## Metadata

**Confidence breakdown:**
- Standard stack (versions, imports): HIGH — verified via npm registry and first-party docs.
- `@sentry/bun` default integrations list: HIGH — cross-referenced Sentry docs + source `packages/bun/src/sdk.ts`.
- A1 resolution (defaultIntegrations behavior): HIGH — documented explicitly in Sentry options page.
- A2 MockTransport non-existence: HIGH — package index inspection, no export found.
- A3 Elysia `request.route` non-existence: HIGH — Context docs enumerate fields, no `route` mentioned.
- Conformance test structure: HIGH — billing precedent exists but NOT at the exact path CONTEXT.md claims (`packages/modules/billing/src/adapters/__tests__/payment-provider-conformance.test.ts`). The closest existing file is `packages/modules/billing/src/__tests__/pagarme-adapter.test.ts` — planner should mirror the describe/beforeEach shape from that file, not assume a file that doesn't exist. **Flag for planner.**
- Source-map pipeline (Debug ID + sentry-cli): HIGH — Bun bundler + sentry-cli docs concur.
- Next.js 15 server-side source maps: MEDIUM — mechanics documented partially; plan should verify at implementation time.
- GlitchTip 6 wire-protocol parity: MEDIUM — CONTEXT and STACK.md both assert it, no direct 2026-04 verification.

**Research date:** 2026-04-22
**Valid until:** 2026-05-22 (30 days — stack components are on weekly minor releases; `@sentry/bun` just shipped 10.49.0, so major churn unlikely in the window)
