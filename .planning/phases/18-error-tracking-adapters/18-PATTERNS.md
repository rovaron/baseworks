# Phase 18: Error Tracking Adapters - Pattern Map

**Mapped:** 2026-04-22
**Files analyzed:** 13 (9 new + 4 edits)
**Analogs found:** 12 / 13 (1 net-new artifact: `.github/workflows/release.yml`)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/observability/src/adapters/pino/pino-error-tracker.ts` | adapter (port impl) | transform + log sink | `packages/observability/src/adapters/noop/noop-error-tracker.ts` | exact (role) / partial (flow) |
| `packages/observability/src/adapters/sentry/sentry-error-tracker.ts` | adapter (port impl) | delegate to SDK | `packages/modules/billing/src/adapters/stripe/stripe-adapter.ts` | partial (SDK-wrapping adapter shape) |
| `packages/observability/src/adapters/sentry/init-options.ts` | config helper (pure) | request-response | `packages/config/src/env.ts` (`validatePaymentProviderEnv`) | weak (pure config builder) |
| `packages/observability/src/lib/scrub-pii.ts` | utility (pure function) | transform | (no direct analog — hand-rolled per RESEARCH "Don't Hand-Roll" table) | no-analog |
| `packages/observability/src/lib/install-global-error-handlers.ts` | utility | event-driven (process signals) | `apps/api/src/worker.ts` (SIGTERM/SIGINT shutdown block, lines 128-138) | role-match (process handler registration) |
| `packages/observability/src/wrappers/wrap-cqrs-bus.ts` | wrapper/decorator | request-response (try/catch shim) | `apps/api/src/core/cqrs.ts` (bus surface being wrapped) | partial (interface mirror) |
| `packages/observability/src/adapters/__tests__/error-tracker-conformance.test.ts` | test (conformance) | table-driven | `packages/modules/billing/src/__tests__/webhook-normalization.test.ts` + `provider-factory.test.ts` | role-match (no existing cross-adapter conformance file) |
| `packages/observability/src/adapters/__tests__/pii-fixtures.ts` | test fixtures | data | (no direct analog — hand-crafted per CONTEXT D-14) | no-analog |
| `packages/observability/src/adapters/sentry/__tests__/test-transport.ts` | test helper | in-memory sink | `packages/modules/billing/src/__tests__/stripe-adapter.test.ts` (mock setup pattern) | role-match |
| `packages/config/src/env.ts` (EDIT) | config schema + validator | crash-hard validation | `validatePaymentProviderEnv` (same file, lines 57-92) | exact |
| `apps/api/src/index.ts` (EDIT) | entrypoint | bootstrap sequence | self (existing `validatePaymentProviderEnv()` call at line 24) | exact |
| `apps/api/src/worker.ts` (EDIT) | entrypoint + worker loop | event-driven | self (existing `worker.on('failed')` at line 57; SIGTERM at line 137) | exact |
| `apps/api/src/core/middleware/error.ts` (EDIT) | Elysia middleware | request-response (error hook) | self (existing `.onError({ as: 'global' }, ...)` at line 20) | exact (A4: extend existing, don't add second `onError`) |
| `.github/workflows/release.yml` (NEW) | CI workflow | event-driven (tag push) | none — repo's first workflow | no-analog |

## Pattern Assignments

### `packages/observability/src/adapters/pino/pino-error-tracker.ts` (adapter, transform + log sink)

**Primary analog:** `packages/observability/src/adapters/noop/noop-error-tracker.ts` (port shape, method set, file header conventions)
**Secondary analog:** `apps/api/src/lib/logger.ts` (the pino instance consumed by ctor)

**Imports pattern** (from noop, lines 12-18):
```typescript
import type {
  Breadcrumb,
  CaptureScope,
  ErrorTracker,
  ErrorTrackerScope,
} from "../../ports/error-tracker";
import type { LogLevel } from "../../ports/types";
```
Add locally:
```typescript
import type { Logger } from "pino";
import { scrubPii } from "../../lib/scrub-pii";
```

**File header + design-rule comment pattern** (from noop, lines 1-10):
```typescript
/**
 * Pino-sink ErrorTracker adapter (OBS-01 / Phase 18 D-07).
 *
 * Default adapter when `ERROR_TRACKER` is unset or `=pino` (Phase 18
 * widens the Phase-17 noop default). Writes through the existing pino
 * logger at ERROR level with full structured scope. Zero external traffic.
 *
 * Design rule: ...
 */
```

**Class skeleton pattern** (mirror noop method-for-method, lines 34-80):
```typescript
export class NoopErrorTracker implements ErrorTracker {
  readonly name = "noop";
  captureException(_err: unknown, _scope?: CaptureScope): void {}
  captureMessage(_message: string, _level?: LogLevel): void {}
  addBreadcrumb(_breadcrumb: Breadcrumb): void {}
  withScope<T>(fn: (scope: ErrorTrackerScope) => T): T {
    return fn(new NoopScope());
  }
  async flush(_timeoutMs?: number): Promise<boolean> {
    return true;
  }
}
```
Replace each no-op body with the D-07 semantics (see RESEARCH Pattern 2, lines 462-487).

**Scope-object pattern** (NoopScope inner class, noop lines 23-28):
```typescript
class NoopScope implements ErrorTrackerScope {
  setUser(_user: { id?: string; email?: string } | null): void {}
  setTag(_key: string, _value: string): void {}
  setExtra(_key: string, _value: unknown): void {}
  setTenant(_tenantId: string | null): void {}
}
```
Pino variant writes into a local `Record<string, unknown>` passed to `logger.child(...)` — closure-scoped per Pitfall 4 in RESEARCH (no instance state).

**Logger shape** (from `apps/api/src/lib/logger.ts`, lines 6-16):
```typescript
export const logger = pino({
  level,
  ...(isDev ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
});
```
Adapter accepts `logger: Logger` via ctor; callers pass the singleton from `@baseworks/api` or construct their own pino in tests (see `createRequestLogger` pattern, logger.ts lines 19-21, for child-logger construction).

---

### `packages/observability/src/adapters/sentry/sentry-error-tracker.ts` (adapter, delegate to SDK)

**Primary analog:** `packages/modules/billing/src/adapters/stripe/stripe-adapter.ts` (SDK-wrapping adapter with ctor that takes config object + instantiates SDK)
**Secondary analog:** `packages/observability/src/adapters/noop/noop-error-tracker.ts` (port method set)

**File header + invariant callouts** (from stripe-adapter, lines 24-35):
```typescript
/**
 * Stripe adapter implementing PaymentProvider (PAY-02).
 *
 * Wraps all Stripe SDK calls behind the provider-agnostic interface.
 * This is the only file (along with stripe-webhook-mapper.ts) that
 * imports the Stripe SDK directly. All other billing module files
 * interact with Stripe through this adapter via getPaymentProvider().
 *
 * Per D-09: Uses crypto.randomUUID() as idempotency key on mutation calls.
 * Per T-10-02: Webhook signature verification uses stripe.webhooks.constructEvent().
 * Per T-10-05: Secret keys are only held in the constructor, never logged.
 */
```
Mirror for sentry: cite OBS-01 / ERR-01,02 / D-05 / D-11 / D-15 (serves both `sentry` and `glitchtip` kinds; `@sentry/bun` is the only SDK import; `Sentry.init` lives in ctor via `buildInitOptions`).

**Class ctor pattern — SDK init in ctor, config object parameter** (stripe-adapter lines 36-44):
```typescript
export class StripeAdapter implements PaymentProvider {
  readonly name = "stripe";
  private stripe: Stripe;
  private webhookSecret: string;

  constructor(config: { secretKey: string; webhookSecret: string }) {
    this.stripe = new Stripe(config.secretKey, { typescript: true });
    this.webhookSecret = config.webhookSecret;
  }
```
Mirror for sentry — see RESEARCH Pattern 1, lines 396-452. `readonly name` set from `opts.kind` (`'sentry' | 'glitchtip'`); call `Sentry.init(buildInitOptions(opts))` in ctor.

**Delegation pattern — every port method is a thin SDK call** (stripe-adapter lines 52-61):
```typescript
async createCustomer(params: CreateCustomerParams): Promise<ProviderCustomer> {
  const customer = await this.stripe.customers.create(
    { metadata: { tenantId: params.tenantId }, name: ... },
    { idempotencyKey: crypto.randomUUID() },
  );
  return { providerCustomerId: customer.id };
}
```
Sentry equivalent: `captureException(err, scope) → Sentry.captureException(err, scope as Sentry.CaptureContext)`, `flush(timeoutMs) → Sentry.flush(timeoutMs)`, `withScope(fn) → Sentry.withScope(sentryScope => fn(portScopeAdapter(sentryScope)))` (RESEARCH lines 419-450).

---

### `packages/observability/src/adapters/sentry/init-options.ts` (config helper, pure)

**No strong analog in-repo.** Closest shape: small pure helper modules (no side effects, returns a config object). Pattern comes from RESEARCH Example 2 (lines 679-706).

**Pattern to follow** (RESEARCH Example 2):
```typescript
// packages/observability/src/adapters/sentry/init-options.ts
import * as Sentry from '@sentry/bun';
import { scrubPii } from '../../lib/scrub-pii';
import type { SentryErrorTrackerOptions } from './sentry-error-tracker';

export function buildInitOptions(opts: SentryErrorTrackerOptions): Parameters<typeof Sentry.init>[0] {
  return {
    dsn: opts.dsn,
    release: opts.release,
    environment: opts.environment,
    sendDefaultPii: false,           // hard-coded per Pitfall 6
    beforeSend: (event) => scrubPii(event) as any,
    beforeBreadcrumb: (bc) => scrubPii(bc) as any,
    defaultIntegrations: false,      // A1 resolution Option C
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

**Why pure helper:** the factory-function pattern lets the conformance test override `transport` (A2) and `defaultIntegrations` without patching the adapter. Keep ctor dumb, keep options calculable — called out as an anti-pattern in RESEARCH lines 561-562.

---

### `packages/observability/src/lib/scrub-pii.ts` (utility, pure transform)

**No analog in-repo.** RESEARCH line 574 flags this as an expected hand-roll: "HAND-ROLL EXPECTED here because no off-the-shelf library covers Baseworks' key denylist (CPF/CNPJ, Brazilian PII). But centralize it; don't scatter inline redactions."

**Pattern to follow** (RESEARCH Pattern 3, lines 489-509):

```typescript
// packages/observability/src/lib/scrub-pii.ts
export type PiiEvent = Record<string, unknown>;

export function scrubPii(event: PiiEvent): PiiEvent {
  // Deep-clone-and-transform; never mutate input
  // 1. Walk all keys recursively; if key matches denylist → replace value with '[redacted:<key>]'
  // 2. On string leaves → apply regex patterns
  // 3. If event.request?.url matches /\/api\/webhooks\//, delete event.request.data
  // Returns the scrubbed event (null drop not currently used per D-13)
}
```

**Contract constraints to preserve** (from CONTEXT D-13 and RESEARCH Pattern 3):
- Pure function — zero shared mutable state (RESEARCH anti-patterns lines 563).
- Return type compatible with Sentry's `beforeSend: (event, hint) => Event | null`.
- Denylist built at module init (recommended) from `env.OBS_PII_DENY_EXTRA_KEYS` + hard-coded defaults.
- Legitimate context keys NOT denied: `tenantId`, `user_id`, `request_id`, `command`, `queryName`, `jobId`, `queue`, `route`, `method`, `code`.

**No JSDoc analog needed** — but match the comprehensive header-comment style used on `error-tracker.ts` port (lines 1-17) and `factory.ts` (lines 1-15).

---

### `packages/observability/src/lib/install-global-error-handlers.ts` (utility, event-driven)

**Primary analog:** `apps/api/src/worker.ts` lines 128-138 (graceful shutdown registers `process.on('SIGTERM', ...)`, `process.on('SIGINT', ...)`).

**Process-handler registration pattern** (worker.ts lines 128-138):
```typescript
// Graceful shutdown handler
async function shutdown() {
  logger.info("Worker shutting down...");
  healthServer.stop();
  await Promise.all(workers.map((w) => w.close()));
  await closeConnection();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

**Adaptation** (see RESEARCH Example 1, lines 645-677): switch signals to `'uncaughtException'` and `'unhandledRejection'`; each handler: `try { tracker.captureException(err, { extra: { handler: kind } }); await tracker.flush(2000); } finally { process.exit(1); }`; guard with a `WeakSet<ErrorTracker>` to make the install idempotent for tests.

**Key differences from worker.ts shutdown:**
- Exit code `1` (not `0`) — these handlers fire on crash.
- Bounded flush timeout (`2000ms` per D-02) — same `await ...flush(timeout)` gate discipline.
- Try/catch inside the handler body so a failing tracker never prevents process exit (RESEARCH Example 1 line 670).

---

### `packages/observability/src/wrappers/wrap-cqrs-bus.ts` (wrapper, request-response)

**Primary analog:** `apps/api/src/core/cqrs.ts` (the surface being wrapped — do NOT edit; see CONTEXT D-01 and RESEARCH A5).

**Bus interface to mirror** (cqrs.ts lines 62-94, the two methods to wrap):
```typescript
async execute<T>(command: string, input: unknown, ctx: HandlerContext): Promise<Result<T>> {
  const handler = this.commands.get(command);
  if (!handler) {
    return err("COMMAND_NOT_FOUND");
  }
  return handler(input, ctx);
}

async query<T>(queryName: string, input: unknown, ctx: HandlerContext): Promise<Result<T>> {
  const handler = this.queries.get(queryName);
  if (!handler) {
    return err("QUERY_NOT_FOUND");
  }
  return handler(input, ctx);
}
```

**Critical invariant (A5 in RESEARCH, lines 212-214):** `execute`/`query` return `Promise<Result<T>>`. `Result.err("COMMAND_NOT_FOUND")` is *normal flow*, NOT an exception. The wrapper catches only `throw`n exceptions from within handlers (DB failures, programmer bugs) — it must NOT inspect the returned `Result.success` to decide whether to call `captureException`.

**Wrapper skeleton** (RESEARCH Pattern 4, lines 518-550):
```typescript
// packages/observability/src/wrappers/wrap-cqrs-bus.ts
import type { ErrorTracker } from '../ports/error-tracker';

export interface BusLike {
  execute<T>(command: string, input: unknown, ctx: any): Promise<any>;
  query<T>(queryName: string, input: unknown, ctx: any): Promise<any>;
}

export function wrapCqrsBus<B extends BusLike>(bus: B, tracker: ErrorTracker): B {
  const origExecute = bus.execute.bind(bus);
  // wrap execute in try/catch that calls tracker.captureException then re-throws
  // wrap query the same way
  return bus;
}
```

**Wire-up site** (RESEARCH lines 553-557, Claude's discretion per CONTEXT "Claude's Discretion"): single call after `registry.loadAll()` in both `apps/api/src/index.ts` and `apps/api/src/worker.ts`.

---

### `packages/observability/src/adapters/__tests__/error-tracker-conformance.test.ts` (test, conformance/table-driven)

**Primary analog:** `packages/modules/billing/src/__tests__/webhook-normalization.test.ts` (cross-adapter parity via nested describe blocks) + `packages/modules/billing/src/__tests__/provider-factory.test.ts` (mock.module pattern for `@baseworks/config`).

**Imports + describe-nesting pattern** (webhook-normalization.test.ts lines 1-23):
```typescript
import { describe, test, expect } from "bun:test";
import { mapStripeEvent } from "../adapters/stripe/stripe-webhook-mapper";
import type { RawProviderEvent } from "../ports/types";

describe("Webhook Normalization", () => {
  describe("Stripe", () => {
    test("maps checkout.session.completed to checkout.completed", () => {
      // ...
    });
  });

  describe("Pagar.me", () => {
    // ...
  });
});
```

**Table-driven inner loop** — webhook-normalization.test.ts inlines per-test bodies; the conformance test needs a `for (const fixture of PII_FIXTURES)` loop per adapter describe block. See RESEARCH Example 4 (lines 743-804) for the exact skeleton.

**Mock pattern for `@baseworks/config`** (from provider-factory.test.ts lines 22-25):
```typescript
mock.module("@baseworks/config", () => ({
  env: mockEnv,
}));
```
Apply to the conformance test so `ERROR_TRACKER` / `SENTRY_DSN` can be set per-test without touching real env. Follow the same `beforeEach` reset pattern (provider-factory.test.ts lines 41-49).

**No existing `adapters/__tests__/` directory in billing** — the billing conformance-equivalent tests (`webhook-normalization.test.ts`, `provider-factory.test.ts`, `stripe-adapter.test.ts`, `pagarme-adapter.test.ts`) all live at `packages/modules/billing/src/__tests__/`. CONTEXT D-08 explicitly calls for the adapter-level subdirectory `packages/observability/src/adapters/__tests__/` for the shared conformance file; individual adapter unit tests live in per-adapter `__tests__/` subdirectories (mirrored in RESEARCH's recommended project structure, lines 355-365).

---

### `packages/observability/src/adapters/__tests__/pii-fixtures.ts` (fixtures, data)

**No analog in-repo.** Hand-crafted per CONTEXT D-14; 12-15 fixture events covering the documented leak vectors.

**Shape to export** (referenced by conformance test):
```typescript
export interface PiiFixture {
  name: string;
  input: { err: unknown; scope?: CaptureScope };
  expected: Partial<Record<string, unknown>>;
  shouldSurvive?: string[];    // substrings that MUST remain in output
  shouldNotAppear?: string[];  // secret values that MUST NOT appear
}
export const PII_FIXTURES: PiiFixture[] = [ /* 12-15 entries */ ];
```

Covers: plain password; bearer token in Authorization header; email in error.message; Stripe webhook body; Pagar.me CPF+CNPJ; better-auth session at `extra.session`; email at depth 3; stale Bearer; positive tenantId fixture; plain stack trace (pass-through); webhook-route request (whole `request.data` dropped); CQRS error event with `extra.commandName` surviving.

---

### `packages/observability/src/adapters/sentry/__tests__/test-transport.ts` (test helper, in-memory sink)

**Primary analog:** `packages/modules/billing/src/__tests__/stripe-adapter.test.ts` lines 13-65 (SDK mock factory pattern).

**Stripe mock factory pattern** (stripe-adapter.test.ts lines 13-46):
```typescript
const mockCustomersCreate = mock(() =>
  Promise.resolve({ id: "cus_stripe_123" }),
);
const mockSubscriptionsCreate = mock(() =>
  Promise.resolve({ id: "sub_stripe_789", status: "active", /* ... */ }),
);
// mock.module("stripe", () => ({ default: ... }));
```

**Adaptation:** instead of mocking `@sentry/bun` (which would short-circuit the adapter), construct a real `Transport` factory via `createTransport` from `@sentry/core` and pass it to `Sentry.init({ transport })`. See RESEARCH Example 3, lines 710-737, for the full implementation.

**Critical:** this file must NOT be named `MockTransport` — A2 in RESEARCH (lines 164-188) clarifies no such export exists in `@sentry/bun`. Name: `makeTestTransport()` returning `{ transport, captured, reset }`.

---

### `packages/config/src/env.ts` (EDIT — schema widening + validator arms)

**Primary analog:** same file. `PAYMENT_PROVIDER` schema (line 23) + `validatePaymentProviderEnv()` (lines 57-92) are the byte-for-byte template.

**Enum-widening pattern** (line 23):
```typescript
PAYMENT_PROVIDER: z.enum(["stripe", "pagarme"]).optional().default("stripe"),
```
Mirror for Phase 18 (line 35, currently `ERROR_TRACKER: z.enum(["noop"]).optional().default("noop")`):
```typescript
ERROR_TRACKER: z.enum(["noop", "pino", "sentry", "glitchtip"]).optional().default("pino"),
```

**Optional-secret-key pattern** (lines 24-27):
```typescript
STRIPE_SECRET_KEY: z.string().min(1).optional(),
STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
PAGARME_SECRET_KEY: z.string().min(1).optional(),
PAGARME_WEBHOOK_SECRET: z.string().min(1).optional(),
```
Mirror for D-09:
```typescript
SENTRY_DSN: z.string().url().optional(),
GLITCHTIP_DSN: z.string().url().optional(),
RELEASE: z.string().optional(),
SENTRY_ENVIRONMENT: z.string().optional(),
// optional per Claude's Discretion:
OBS_PII_DENY_EXTRA_KEYS: z.string().optional(),
```

**Crash-hard validator pattern** (lines 57-92) — THE template for the new `'sentry'`/`'glitchtip'` arms of `validateObservabilityEnv()`:
```typescript
export function validatePaymentProviderEnv(): void {
  const provider = env.PAYMENT_PROVIDER ?? "stripe";
  const isTest = env.NODE_ENV === "test";

  if (provider === "pagarme" && !env.PAGARME_SECRET_KEY) {
    if (isTest) {
      console.warn(
        "[env] WARNING: PAGARME_SECRET_KEY is not set (NODE_ENV=test).",
      );
    } else {
      throw new Error(
        "PAGARME_SECRET_KEY is required when PAYMENT_PROVIDER=pagarme. " +
          "Set PAGARME_SECRET_KEY in your environment.",
      );
    }
  }
  // ... symmetric branch for stripe
}
```

**Existing `validateObservabilityEnv` shell to fill** (lines 109-134 — arms already marked as Phase 18 insertion sites):
```typescript
switch (env.ERROR_TRACKER ?? "noop") {
  case "noop":
    break;
  // Phase 18 inserts pino/sentry/glitchtip cases here.
}
```

**Fill with** (D-09 — mirror the payment-provider pattern byte-for-byte):
```typescript
case "pino":
  break; // no required env
case "sentry":
  if (!env.SENTRY_DSN) {
    if (isTest) console.warn("[env] WARNING: SENTRY_DSN is not set (NODE_ENV=test).");
    else throw new Error("SENTRY_DSN is required when ERROR_TRACKER=sentry. Set SENTRY_DSN in your environment.");
  }
  break;
case "glitchtip":
  if (!env.GLITCHTIP_DSN) {
    if (isTest) console.warn("[env] WARNING: GLITCHTIP_DSN is not set (NODE_ENV=test).");
    else throw new Error("GLITCHTIP_DSN is required when ERROR_TRACKER=glitchtip. Set GLITCHTIP_DSN in your environment.");
  }
  break;
```

**Export update** — `packages/config/src/index.ts` is a single-line barrel:
```typescript
export { env, validatePaymentProviderEnv, validateObservabilityEnv, assertRedisUrl } from "./env";
```
No edit required — both functions are already exported.

---

### `packages/observability/src/factory.ts` (EDIT — ERROR_TRACKER switch)

**Primary analog:** same file, `getErrorTracker()` (lines 150-165) — already carries a comment reserving the Phase 18 insertion slot.

**Switch-extension pattern** (lines 150-165):
```typescript
export function getErrorTracker(): ErrorTracker {
  if (!errorTrackerInstance) {
    const name = process.env.ERROR_TRACKER ?? "noop";
    switch (name) {
      case "noop":
        errorTrackerInstance = new NoopErrorTracker();
        break;
      // Phase 18 will add: case "pino" | "sentry" | "glitchtip": ...
      default:
        throw new Error(
          `Unknown ERROR_TRACKER: ${name}. Phase 17 supports only 'noop'.`,
        );
    }
  }
  return errorTrackerInstance;
}
```

**Phase 18 fill** (change default from `"noop"` to `"pino"` per D-06):
```typescript
const name = process.env.ERROR_TRACKER ?? "pino";
switch (name) {
  case "noop":
    errorTrackerInstance = new NoopErrorTracker();
    break;
  case "pino":
    errorTrackerInstance = new PinoErrorTracker(/* pino logger injection — see discussion below */);
    break;
  case "sentry":
    errorTrackerInstance = new SentryErrorTracker({ dsn: process.env.SENTRY_DSN!, kind: "sentry", ... });
    break;
  case "glitchtip":
    errorTrackerInstance = new SentryErrorTracker({ dsn: process.env.GLITCHTIP_DSN!, kind: "glitchtip", ... });
    break;
  default:
    throw new Error(`Unknown ERROR_TRACKER: ${name}.`);
}
```

**IMPORTANT:** factory.ts reads `process.env` directly (not `@baseworks/config`) per the header comment (lines 12-15) — preserve this invariant to stay compatible with `apps/api/src/telemetry.ts`'s early-load ordering.

**Pino logger injection:** the factory does NOT import `@baseworks/api`'s logger (would create a cross-package cycle). Plan decision: ship a minimal local pino instance inside `pino-error-tracker.ts` (ctor takes optional logger, builds a default one if none provided), or require callers to pass a logger via `setErrorTracker(...)`.

---

### `apps/api/src/index.ts` (EDIT — insert global-handler install + wrapCqrsBus)

**Primary analog:** same file (existing bootstrap ordering is the template).

**Existing bootstrap pattern** (lines 1-33):
```typescript
import "./telemetry";                        // line 1 — telemetry FIRST (D-06 from Phase 17)
import { env, validatePaymentProviderEnv } from "@baseworks/config";
// ... imports
validatePaymentProviderEnv();                // line 24 — crash-hard validation
const registry = new ModuleRegistry({...});
await registry.loadAll();                    // line 33
```

**Phase 18 insertion points** (per CONTEXT D-02 "after `import './telemetry'` and after `validateObservabilityEnv()`"):

1. After line 24, insert:
   ```typescript
   validateObservabilityEnv();
   ```

2. After line 24 (after validators), insert:
   ```typescript
   import { getErrorTracker } from "@baseworks/observability";
   import { installGlobalErrorHandlers } from "@baseworks/observability";
   installGlobalErrorHandlers(getErrorTracker());
   ```

3. After line 33 (`await registry.loadAll()`), insert (Claude's Discretion — single boot wrap per RESEARCH line 553-557):
   ```typescript
   import { wrapCqrsBus } from "@baseworks/observability";
   wrapCqrsBus(registry.getCqrs(), getErrorTracker());
   ```

**`errorMiddleware` already registered at line 50** — no second `.onError` added; see the `error.ts` edit below (A4).

---

### `apps/api/src/worker.ts` (EDIT — install handlers + extend worker.on('failed') at line 57)

**Primary analog:** same file.

**Existing `worker.on('failed')` handler pattern** (lines 57-62) — THE exact line CONTEXT D-04 points at:
```typescript
worker.on("failed", (job, err) => {
  logger.error(
    { job: job?.id, queue: jobDef.queue, err: String(err) },
    "Job failed",
  );
});
```

**Phase 18 one-line addition** (CONTEXT D-04 — no new handler; append a `captureException` call next to the `logger.error`):
```typescript
worker.on("failed", (job, err) => {
  logger.error(
    { job: job?.id, queue: jobDef.queue, err: String(err) },
    "Job failed",
  );
  getErrorTracker().captureException(err, {
    tags: { queue: jobDef.queue },
    extra: { jobId: job?.id, jobName },
  });
});
```
Keep inner try/catch at lines 45-52 log-only (CONTEXT D-04 last sentence: "capture-and-rethrow at both layers would double-report").

**Bootstrap insertion** — mirror `apps/api/src/index.ts` edits:
- After line 16 (`validatePaymentProviderEnv()`), add `validateObservabilityEnv()`.
- Add `installGlobalErrorHandlers(getErrorTracker())` after validators.
- Add `wrapCqrsBus(registry.getCqrs(), getErrorTracker())` after `await registry.loadAll()` (line 28).

**Existing graceful-shutdown registration (lines 128-138)** is ALSO the prior-art for `installGlobalErrorHandlers` — see that section above.

---

### `apps/api/src/core/middleware/error.ts` (EDIT — prepend captureException to existing onError)

**Primary analog:** same file. RESEARCH A4 (line 206-208) explicitly states: "D-03 should NOT add a second `app.onError` — it should EXTEND `errorMiddleware` with a `tracker.captureException(error, ...)` call before the status-mapping switch. One file edit, zero new middleware plugins."

**Existing onError pattern** (lines 20-84):
```typescript
export const errorMiddleware = new Elysia({ name: "error-handler" }).onError(
  { as: "global" },
  ({ code, error, set }) => {
    const errMsg = "message" in error ? (error as Error).message : String(error);
    const errStack = "stack" in error ? (error as Error).stack : undefined;

    // Log all errors server-side
    logger.error({ code, message: errMsg, stack: errStack }, "Request error");

    switch (code) {
      // ... status mapping
    }
  },
);
```

**Phase 18 insertion** (before the `switch (code)` block — keeps the single on-error site invariant):
```typescript
logger.error({ code, message: errMsg, stack: errStack }, "Request error");

// Phase 18 D-03 — capture via ErrorTracker port.
// A3 resolution: drop the non-existent `request.route`; tag only method+code.
// Path goes on `extra` (not a metric dimension) to avoid cardinality explosion per Pitfall 4.
getErrorTracker().captureException(error, {
  tags: { method: request.method, code: String(code) },
  extra: { path: new URL(request.url).pathname },
});

switch (code) {
  // ... unchanged
}
```

**Context destructure update** — current callback destructures `{ code, error, set }`; Phase 18 also needs `request`:
```typescript
({ code, error, set, request }) => { ... }
```

**Imports to add** at top:
```typescript
import { getErrorTracker } from "@baseworks/observability";
```

---

### `.github/workflows/release.yml` (NEW — repo's first workflow)

**No in-repo analog** — `.github/` directory does not yet exist (verified). Pattern comes from CONTEXT D-16..D-19 and RESEARCH Architecture Patterns (lines 322-338).

**Structure to ship** (per CONTEXT D-16):
- Trigger: `on.push.tags: ['v*.*.*']` only (no PR, no schedule).
- First step: export `RELEASE=$(git rev-parse --short HEAD)` (D-19).
- Build steps (CONTEXT D-18):
  - `bun build apps/api/src/index.ts --sourcemap external --outdir apps/api/dist/`
  - `bun build apps/api/src/worker.ts --sourcemap external --outdir apps/api/dist/worker/`
  - `bun --cwd apps/admin run build` (Vite sourcemap)
  - `bun --cwd apps/web run build` (Next.js server-side sourcemaps only — NOT `productionBrowserSourceMaps`, per Pitfall 5)
- For each of the four dist directories:
  - `bun x sentry-cli sourcemaps inject <dir>`
  - `bun x sentry-cli sourcemaps upload --release=$RELEASE --org=$SENTRY_ORG --project=$SENTRY_PROJECT <dir>`
- Required secrets (set in GitHub repo settings): `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` (RESEARCH line 587).
- Pin `@sentry/cli` in root `package.json` devDependencies (CONTEXT D-17).

**Anti-patterns** (from CONTEXT D-16 and RESEARCH Pitfall 5): no test/lint/deploy jobs; do NOT enable `productionBrowserSourceMaps` in `next.config.*`; do NOT use `--sourcemap=linked` for api/worker builds (insert `//# sourceMappingURL` comment → leaks maps to browser).

---

## Shared Patterns

### JSDoc comment style (ALL new files)
**Source:** `packages/observability/src/ports/error-tracker.ts` (lines 1-17) + `packages/observability/src/adapters/noop/noop-error-tracker.ts` (lines 1-10) + `packages/modules/billing/src/adapters/stripe/stripe-adapter.ts` (lines 24-35)
**Apply to:** every new `.ts` file.

Header-comment template (from noop-error-tracker.ts):
```typescript
/**
 * <Adapter/Utility name> (<REQ-TAG> / <D-tag>).
 *
 * <One-sentence purpose>.
 *
 * <Design rule or invariant>.
 */
```
Method-level JSDoc template (from noop-error-tracker.ts lines 37-43 / port interface lines 96-97):
```typescript
/**
 * <One-line summary>.
 *
 * @param <name> - <description>
 * @returns <description>
 * @throws <when>
 */
```

### Crash-hard validation
**Source:** `packages/config/src/env.ts` `validatePaymentProviderEnv` (lines 57-92)
**Apply to:** new arms in `validateObservabilityEnv()`.
- `NODE_ENV === "test"` branch warns via `console.warn("[env] WARNING: ...");` — booting tests without real keys.
- Non-test branch throws with the exact env var name in the message + a "Set X in your environment" suffix.

### Singleton get/set/reset trio (for factories)
**Source:** `packages/observability/src/factory.ts` ErrorTracker trio (lines 136-185); `packages/modules/billing/src/provider-factory.ts` (lines 19-95).
**Apply to:** `getErrorTracker` / `setErrorTracker` / `resetErrorTracker` — already present; Phase 18 edits only extend the switch body.

### Mock-the-config in tests
**Source:** `packages/modules/billing/src/__tests__/provider-factory.test.ts` (lines 13-38)
**Apply to:** `error-tracker-conformance.test.ts` and any Phase 18 unit test that reads from `@baseworks/config` (e.g., `scrub-pii.test.ts` if it reads `OBS_PII_DENY_EXTRA_KEYS`).
```typescript
const mockEnv: Record<string, any> = { ERROR_TRACKER: "sentry", SENTRY_DSN: "http://public@example.com/1" };
mock.module("@baseworks/config", () => ({ env: mockEnv }));
const { getErrorTracker, resetErrorTracker } = await import("@baseworks/observability");
```

### Bootstrap ordering (entrypoints)
**Source:** `apps/api/src/index.ts` lines 1-33 / `apps/api/src/worker.ts` lines 1-28
**Apply to:** Phase 18 edits in both entrypoints. Order is load-bearing:
1. `import "./telemetry";` — Phase 17 D-06 invariant (must be first; no `@baseworks/config` import before SDK starts).
2. `validatePaymentProviderEnv()` → add `validateObservabilityEnv()` immediately after (same crash-hard layer).
3. `installGlobalErrorHandlers(getErrorTracker())` — after validators pass (tracker is known-configured).
4. `await registry.loadAll()` — module boot.
5. `wrapCqrsBus(registry.getCqrs(), getErrorTracker())` — after modules register their handlers.

### Existing `.onError` extension, not new `.onError`
**Source:** `apps/api/src/core/middleware/error.ts` lines 20-84 (the repo's single `.onError({ as: "global" }, ...)` site).
**Apply to:** Elysia error-capture wiring (D-03). A4 in RESEARCH explicitly flags this: register capture by editing `error.ts`, not by adding a second plugin.

### pino structured-logging conventions
**Source:** `apps/api/src/worker.ts` lines 41-52 (child logger with request-scoped bindings); `apps/api/src/core/middleware/error.ts` line 28 (object-first positional call).
**Apply to:** `pino-error-tracker.ts` logging calls.
```typescript
logger.error({ code, message: errMsg, stack: errStack }, "Request error");      // error.ts:28
const jobLog = logger.child({ requestId, jobId: job.id, queue: jobDef.queue });  // worker.ts:42
```
Always: object-first, message-second; child-logger for bound context fields.

## No Analog Found

Files with no close match in the codebase (planner should use RESEARCH.md patterns instead):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `packages/observability/src/lib/scrub-pii.ts` | utility | transform | No existing PII-scrubber in repo; RESEARCH "Don't Hand-Roll" table (line 574) explicitly authorizes hand-rolling; follow RESEARCH Pattern 3 + CONTEXT D-13. |
| `packages/observability/src/adapters/__tests__/pii-fixtures.ts` | fixtures | data | 12-15 hand-crafted events per D-14; no analog fixture file exists. |
| `.github/workflows/release.yml` | CI workflow | event-driven | Repo has no `.github/` directory; this is the first workflow. Follow CONTEXT D-16..D-19 + RESEARCH architecture diagram verbatim. |

## Metadata

**Analog search scope:** `packages/observability/`, `packages/modules/billing/`, `packages/config/`, `apps/api/src/`, `.github/` (empty).
**Files scanned:** 14 (noop-error-tracker.ts, error-tracker.ts, types.ts, factory.ts, index.ts (observability), stripe-adapter.ts, pagarme dir listing, provider-factory.ts, webhook-normalization.test.ts, provider-factory.test.ts, stripe-adapter.test.ts, env.ts, config/index.ts, apps/api/src/index.ts, apps/api/src/worker.ts, apps/api/src/lib/logger.ts, apps/api/src/core/cqrs.ts, apps/api/src/core/middleware/error.ts).
**Pattern extraction date:** 2026-04-22.
