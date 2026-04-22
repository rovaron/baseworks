# Phase 17: Observability Ports & OTEL Bootstrap - Pattern Map

**Mapped:** 2026-04-21
**Files analyzed:** 13 (10 new, 3 modified)
**Analogs found:** 11 / 13 (2 NEW with no exact analog)

## File Classification

| New/Modified File                                                | Status   | Role                       | Data Flow            | Closest Analog                                                          | Match Quality |
|------------------------------------------------------------------|----------|----------------------------|----------------------|--------------------------------------------------------------------------|---------------|
| `packages/observability/package.json`                            | NEW      | workspace manifest         | n/a                  | `packages/modules/billing/package.json` (+ `packages/shared/package.json` for lean shape) | exact         |
| `packages/observability/tsconfig.json`                           | NEW      | tsconfig                   | n/a                  | `packages/modules/billing/tsconfig.json`                                | exact         |
| `packages/observability/src/index.ts`                            | NEW      | barrel re-export           | request-response     | `packages/config/src/index.ts`                                          | role-match    |
| `packages/observability/src/ports/tracer.ts`                     | NEW      | port interface             | request-response     | `packages/modules/billing/src/ports/payment-provider.ts`                | exact         |
| `packages/observability/src/ports/metrics.ts`                    | NEW      | port interface             | event-driven (counter/histogram/gauge) | `packages/modules/billing/src/ports/payment-provider.ts`                | exact         |
| `packages/observability/src/ports/error-tracker.ts`              | NEW      | port interface             | event-driven         | `packages/modules/billing/src/ports/payment-provider.ts`                | exact         |
| `packages/observability/src/ports/types.ts`                      | NEW      | type definitions           | n/a                  | `packages/modules/billing/src/ports/types.ts` (referenced from payment-provider.ts line 18) | exact         |
| `packages/observability/src/adapters/noop/noop-tracer.ts`        | NEW      | adapter (noop)             | request-response     | `packages/modules/billing/src/adapters/stripe/stripe-adapter.ts` (closest "class X implements Port" pattern — no existing noop adapter) | role-match    |
| `packages/observability/src/adapters/noop/noop-metrics.ts`       | NEW      | adapter (noop)             | event-driven         | `packages/modules/billing/src/adapters/stripe/stripe-adapter.ts`        | role-match    |
| `packages/observability/src/adapters/noop/noop-error-tracker.ts` | NEW      | adapter (noop)             | event-driven         | `packages/modules/billing/src/adapters/stripe/stripe-adapter.ts`        | role-match    |
| `packages/observability/src/factory.ts`                          | NEW      | env-selected factory (×3 trios) | request-response     | `packages/modules/billing/src/provider-factory.ts`                      | exact         |
| `packages/config/src/env.ts`                                     | MODIFIED | env schema + validator     | startup-validate     | `validatePaymentProviderEnv()` in same file (lines 49-84)               | exact         |
| `packages/config/src/index.ts`                                   | MODIFIED | barrel re-export           | n/a                  | Same file (line 1, already re-exports `validatePaymentProviderEnv`)     | exact         |
| `apps/api/src/telemetry.ts`                                      | NEW      | bootstrap entrypoint       | startup-side-effect  | NO exact analog. References: `apps/api/src/worker.ts` (env-driven init lines 1-15) + RESEARCH.md §"NodeSDK bootstrap" lines 297-304 | NEW           |
| `apps/api/src/index.ts`                                          | MODIFIED | entrypoint                 | n/a                  | structural prepend only — no analog needed                              | trivial       |
| `apps/api/src/worker.ts`                                         | MODIFIED | entrypoint                 | n/a                  | structural prepend only — no analog needed                              | trivial       |
| `apps/api/__tests__/telemetry-boot.test.ts`                      | NEW      | integration test (subprocess spawn) | request-response | `apps/api/src/__tests__/entrypoints.test.ts` lines 34-68 (`Bun.spawn` worker-startup pattern) | exact         |

---

## Pattern Assignments

### `packages/observability/package.json` (workspace manifest)

**Analog:** `packages/modules/billing/package.json` (full reference) + `packages/shared/package.json` (leaner manifest with only the deps you actually need).

**Why two analogs:** billing shows the maximal monorepo-package shape (`name`, `version`, `private`, `type`, `main`, `types`, workspace deps + 3rd-party deps). `shared` shows that `version` and `type` can be omitted for a private workspace package — observability only needs to declare a few `@opentelemetry/*` peers + `@baseworks/config` as a workspace dep (per RESEARCH.md line 127: "OTEL SDK packages are pulled in transitively through that workspace dep").

**Imports/shape pattern** (`packages/modules/billing/package.json` lines 1-24):
```json
{
  "name": "@baseworks/module-billing",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "dependencies": {
    "@baseworks/config": "workspace:*",
    "@baseworks/shared": "workspace:*",
    "stripe": "^17.0.0"
  }
}
```

**Apply to observability** (substitute deps from RESEARCH.md lines 89-93, 120-124):
- `@opentelemetry/api ^1.9.1`
- `@opentelemetry/sdk-node ^0.215.0`
- `@opentelemetry/auto-instrumentations-node ^0.73.0`
- `@opentelemetry/resources ^2.7.0`
- `@opentelemetry/semantic-conventions ^1.40.0`

**Tsconfig pattern** (`packages/modules/billing/tsconfig.json` lines 1-7):
```json
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src/**/*.ts"]
}
```

Note: observability lives at `packages/observability/` (one level up from `packages/modules/billing/`), so `extends` is `"../../tsconfig.json"`, not `"../../../tsconfig.json"`.

---

### `packages/observability/src/index.ts` (barrel)

**Analog:** `packages/config/src/index.ts` line 1.

**Pattern:**
```typescript
export { env, validatePaymentProviderEnv, assertRedisUrl } from "./env";
```

**Apply to observability:** single-line re-exports of every port interface, every Noop class, and the six factory functions (`getTracer`/`setTracer`/`resetTracer`/`getMetrics`/`setMetrics`/`resetMetrics`/`getErrorTracker`/`setErrorTracker`/`resetErrorTracker`). Wildcards (`export *`) are NOT used in this codebase — explicit named re-exports only.

---

### `packages/observability/src/ports/tracer.ts` (port interface)

**Analog:** `packages/modules/billing/src/ports/payment-provider.ts` lines 1-159.

**File-header doc-block pattern** (lines 1-16):
```typescript
/**
 * PaymentProvider port interface (PAY-01).
 *
 * Defines the contract that all payment provider adapters must implement.
 * This is the core abstraction enabling provider-agnostic billing:
 * - StripeAdapter implements this for Stripe
 * - PagarmeAdapter implements this for Pagar.me
 *
 * Design decisions:
 * - `createPortalSession` returns `ProviderPortalSession | null` because
 *   not all providers offer a hosted billing portal (e.g., Pagar.me).
 */
```

**Type re-import pattern** (lines 18-37):
```typescript
import type {
  CreateCustomerParams,
  ProviderCustomer,
  // ...
} from "./types";
```

**Interface + readonly name + per-method JSDoc pattern** (lines 38-48):
```typescript
export interface PaymentProvider {
  /** Provider identifier (e.g., "stripe", "pagarme"). */
  readonly name: string;

  /**
   * Create a customer record in the payment provider.
   *
   * @param params - Tenant ID, optional name and metadata
   * @returns Provider customer with the external customer ID
   */
  createCustomer(params: CreateCustomerParams): Promise<ProviderCustomer>;
```

**Optional method pattern** (line 158, used for "not all providers support this"):
```typescript
  reportUsage?(params: ReportUsageParams): Promise<ReportUsageResult>;
```

**Trailing type re-export block** (lines 161-180):
```typescript
// Re-export types for convenience
export type {
  CreateCustomerParams,
  // ...
} from "./types";
```

**Apply to all three port files** (`tracer.ts`, `metrics.ts`, `error-tracker.ts`): every method gets `@param`/`@returns` JSDoc, the interface starts with `readonly name: string`, types live in `./types.ts` and are re-imported with `import type`, port-specific types are re-exported at the bottom.

---

### `packages/observability/src/adapters/noop/noop-*.ts` (adapter classes)

**Analog:** `packages/modules/billing/src/adapters/stripe/stripe-adapter.ts` lines 1-44.

**Caveat:** No noop adapter exists in the codebase yet. The Stripe adapter is the closest "class X implements Port" pattern. Noop adapters are simpler (no SDK, no config, no constructor args) — copy the *shape* (file header, `implements`, `readonly name`), not the body.

**Imports pattern** (lines 1-22):
```typescript
import Stripe from "stripe";
import type { PaymentProvider } from "../../ports/payment-provider";
import type {
  CreateCustomerParams,
  ProviderCustomer,
  // ...
} from "../../ports/types";
```

**File-header doc-block pattern** (lines 24-35):
```typescript
/**
 * Stripe adapter implementing PaymentProvider (PAY-02).
 *
 * Wraps all Stripe SDK calls behind the provider-agnostic interface.
 * This is the only file (along with stripe-webhook-mapper.ts) that
 * imports the Stripe SDK directly.
 */
```

**Class declaration pattern** (lines 36-44):
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

**Apply to noop adapters:**
- `readonly name = "noop";` (or `"noop-tracer"`, etc.)
- No constructor args (Noops are stateless)
- Every interface method body is the minimum compatible no-op (e.g., `startSpan()` returns a noop Span object, `captureException()` returns void, `counter().inc()` is empty).
- File-header explains: "Default adapter when {TRACER,METRICS_PROVIDER,ERROR_TRACKER} is unset or =noop. Zero external traffic."

---

### `packages/observability/src/factory.ts` (env-selected factory ×3)

**Analog:** `packages/modules/billing/src/provider-factory.ts` lines 1-95. **This is the byte-for-byte mirror per CONTEXT.md D-01/D-02 and RESEARCH.md line 249.**

**Imports pattern** (lines 1-4):
```typescript
import { env } from "@baseworks/config";
import type { PaymentProvider } from "./ports/payment-provider";
import { StripeAdapter } from "./adapters/stripe/stripe-adapter";
import { PagarmeAdapter } from "./adapters/pagarme/pagarme-adapter";
```

**Critical:** factory.ts MAY import `@baseworks/config` (it runs lazily, after `sdk.start()`). The hard rule from CONTEXT.md D-06 is that `apps/api/src/telemetry.ts` must NOT import `@baseworks/config` before `sdk.start()` — that constraint applies only to telemetry.ts, not to this factory file.

**File-header doc-block + lazy-singleton variable** (lines 6-19):
```typescript
/**
 * Payment provider singleton factory (PAY-05).
 *
 * Returns a lazily-initialized PaymentProvider instance based on the
 * PAYMENT_PROVIDER environment variable. Defaults to Stripe if unset.
 */
let providerInstance: PaymentProvider | null = null;
```

**Lazy-init switch pattern** (lines 32-75):
```typescript
export function getPaymentProvider(): PaymentProvider {
  if (!providerInstance) {
    const providerName = env.PAYMENT_PROVIDER ?? "stripe";

    switch (providerName) {
      case "stripe": {
        const secretKey = env.STRIPE_SECRET_KEY;
        if (!secretKey) {
          throw new Error(
            "STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe",
          );
        }
        providerInstance = new StripeAdapter({ secretKey, webhookSecret });
        break;
      }
      // ...
      default:
        throw new Error(`Unknown payment provider: ${providerName}`);
    }
  }
  return providerInstance;
}
```

**reset/set trio pattern** (lines 77-95):
```typescript
/**
 * Reset the provider singleton. Used in tests to inject mocks.
 */
export function resetPaymentProvider(): void {
  providerInstance = null;
}

/**
 * Set the provider singleton directly. Used in tests to inject
 * a mock PaymentProvider without env var configuration.
 */
export function setPaymentProvider(provider: PaymentProvider): void {
  providerInstance = provider;
}
```

**Apply to observability:** repeat the entire pattern three times in one file (per CONTEXT.md D-01: "Three separate lazy-singleton factories"). Three module-level `let *Instance: T | null = null;` lines, three `get*()` switch statements (all default to `"noop"` per CONTEXT.md D-03; only `"noop"` is a valid case in Phase 17, anything else throws), three `reset*()` + `set*()` pairs. Env vars are `TRACER` / `METRICS_PROVIDER` / `ERROR_TRACKER` (RESEARCH.md lines 821-823).

---

### `packages/config/src/env.ts` (MODIFIED — add schema fields + validateObservabilityEnv)

**Analog:** `validatePaymentProviderEnv()` in the same file, lines 40-84. **CONTEXT.md D-08/D-09 explicitly require this be the byte-for-byte template.**

**Schema-extension pattern** (lines 10-32 — add new keys alongside existing ones):
```typescript
const serverSchema = {
  // ...existing keys...
  PAYMENT_PROVIDER: z.enum(["stripe", "pagarme"]).optional().default("stripe"),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  // ...
};
```

**Apply to observability:** add (per RESEARCH.md line 230 and CONTEXT.md D-07) optional+defaulted fields:
```typescript
TRACER:           z.enum(["noop"]).optional().default("noop"),
METRICS_PROVIDER: z.enum(["noop"]).optional().default("noop"),
ERROR_TRACKER:    z.enum(["noop"]).optional().default("noop"),
```
Phase 18/21 expand the enums; Phase 17 ships only `"noop"`.

**Crash-hard validator pattern** (lines 40-84):
```typescript
/**
 * Validate that the required payment provider secrets are present.
 * Must be called at startup to prevent runtime crashes on first billing operation.
 *
 * @throws Error if required provider secrets are missing
 */
export function validatePaymentProviderEnv(): void {
  const provider = env.PAYMENT_PROVIDER ?? "stripe";

  // Test environments are allowed to boot without real provider keys...
  const isTest = env.NODE_ENV === "test";

  if (provider === "pagarme" && !env.PAGARME_SECRET_KEY) {
    if (isTest) {
      console.warn("[env] WARNING: PAGARME_SECRET_KEY is not set (NODE_ENV=test).");
    } else {
      throw new Error(
        "PAGARME_SECRET_KEY is required when PAYMENT_PROVIDER=pagarme. " +
          "Set PAGARME_SECRET_KEY in your environment.",
      );
    }
  }
  // ... symmetric branch for stripe ...
}
```

**Apply to `validateObservabilityEnv()`:**
- Same JSDoc shape (`@throws`).
- Same per-adapter conditional structure.
- Per CONTEXT.md D-09: NO `isTest` branch — Phase 17 has no required keys (all defaults are `"noop"`), so the function effectively does nothing today. Stub the function with the per-adapter `switch` skeleton so Phases 18/21 can drop in their branches without re-deriving the pattern.
- On unsupported value (e.g., `TRACER=otel` in Phase 17): throw with message `"Unknown TRACER=${tracer}. Phase 17 supports only 'noop'."` (RESEARCH.md lines 828, 834, 840).

---

### `packages/config/src/index.ts` (MODIFIED — re-export)

**Analog:** itself, line 1.

**Pattern:**
```typescript
export { env, validatePaymentProviderEnv, assertRedisUrl } from "./env";
```

**Apply:** add `validateObservabilityEnv` to the named-export list.

---

### `apps/api/src/telemetry.ts` (NEW — flag as new pattern, no exact analog)

**Status:** NO existing analog. This is an architectural first.

**Closest reference 1:** `apps/api/src/worker.ts` lines 1-18 — env-driven startup, calls validators in sequence.
```typescript
import { env, assertRedisUrl, validatePaymentProviderEnv } from "@baseworks/config";
// ...
const _env = env;
const redisUrl = assertRedisUrl(env.INSTANCE_ROLE, env.REDIS_URL);
validatePaymentProviderEnv();
const db = createDb(env.DATABASE_URL);
```

**Closest reference 2:** RESEARCH.md lines 297-304 (the canonical OTEL bootstrap shape):
```typescript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME /* ... */ } from "@opentelemetry/semantic-conventions";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
```

**Constraints unique to telemetry.ts (do NOT mirror worker.ts on these):**
- **CONTEXT.md D-06:** read `process.env` inline — DO NOT `import { env } from "@baseworks/config"` before `sdk.start()`. Worker.ts violates this (it imports config first); telemetry.ts must invert the order.
- **CONTEXT.md D-04:** branch on `process.env.INSTANCE_ROLE` to choose `service.name` (`baseworks-api` vs `baseworks-worker`) and to enable/disable `@opentelemetry/instrumentation-http` (api: enabled; worker: disabled).
- **RESEARCH.md lines 156-162:** `getNodeAutoInstrumentations({ ... })` config object enables `instrumentation-http` (api only) + `-pino` + `-ioredis`; explicitly disables `-fs`, `-dns`, `-net` via `{ enabled: false }`.
- **CONTEXT.md D-05:** after `sdk.start()`, create + end a span named `otel-selftest` with `ok=true` attribute, log `otel-selftest: ok` to stdout (acceptance string).
- **CONTEXT.md D-06:** call `validateObservabilityEnv()` from `@baseworks/config` on the line after `sdk.start()`.

**Logger to use:** must be plain `console.log("otel-selftest: ok")` (or `process.stdout.write`) — DO NOT import `apps/api/src/lib/logger.ts` before `sdk.start()` (pino-instrumentation hasn't attached yet, and pulling logger.ts indirectly pulls `@baseworks/config`).

---

### `apps/api/src/index.ts` (MODIFIED — line 1 prepend)

No analog needed. Per CONTEXT.md "Integration Points": prepend `import "./telemetry";` as line 1, before any other import. Existing line 1 (`import { env, validatePaymentProviderEnv } from "@baseworks/config";`) becomes line 2.

---

### `apps/api/src/worker.ts` (MODIFIED — line 1 prepend)

No analog needed. Same change as `index.ts`: prepend `import "./telemetry";` as line 1. Existing line 1 (`import { env, assertRedisUrl, validatePaymentProviderEnv } from "@baseworks/config";`) becomes line 2.

---

### `apps/api/__tests__/telemetry-boot.test.ts` (NEW subprocess smoke-test)

**Analog:** `apps/api/src/__tests__/entrypoints.test.ts` lines 34-68. **Exact analog — same `Bun.spawn`-as-subprocess-then-assert-stdout idiom.**

**Note:** Per CONTEXT.md the new test goes in `apps/api/__tests__/` (sibling of `src/`), not `apps/api/src/__tests__/` like the existing one. Same test framework (`bun:test`), different directory.

**Test framework imports** (line 1):
```typescript
import { describe, test, expect } from "bun:test";
```

**Subprocess-spawn + stdout-assert pattern** (lines 34-68):
```typescript
describe("Worker entrypoint", () => {
  test("worker starts without HTTP server and logs startup", async () => {
    // Spawn worker as subprocess with minimal env
    const proc = Bun.spawn(["bun", "run", "apps/api/src/worker.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL ?? "postgres://baseworks:baseworks@localhost:5432/baseworks",
        NODE_ENV: "test",
        INSTANCE_ROLE: "worker",
        LOG_LEVEL: "info",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for startup (max 5 seconds)
    const timeout = setTimeout(() => proc.kill(), 5000);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    clearTimeout(timeout);

    const output = stdout + stderr;

    // Worker should log startup message (pino JSON or pretty format)
    const started = output.includes("Worker started") || output.includes("worker");

    // The key thing is it does NOT start an HTTP server
    const noServer = !output.includes("Baseworks API started");

    expect(noServer).toBe(true);
  });
});
```

**Apply to telemetry-boot.test.ts:** TWO test cases (one per role) using the same `Bun.spawn` shape:

1. `INSTANCE_ROLE=api` case: spawn `bun run apps/api/src/index.ts` (or a thin entry that imports telemetry then exits — see CONTEXT.md D-10 for the "or equivalent" wording), assert `output.includes("otel-selftest: ok")` AND `proc.exitCode === 0`.
2. `INSTANCE_ROLE=worker` case: spawn `bun run apps/api/src/worker.ts`, same assertions.

**Bidirectional instrumentation probe (CONTEXT.md D-11):** assert via stdout that the enabled instrumentations (`http`, `pino`, `ioredis`) loaded AND the disabled ones (`fs`, `dns`, `net`) did NOT. Mechanism: telemetry.ts logs the resolved instrumentation list once at boot (e.g., `instrumentations-loaded: http,pino,ioredis`); the test asserts both inclusion and exclusion against that line. (No introspection API exists per RESEARCH.md "deferred ideas" — this is the lightweight Phase 17 probe.)

**Timeout pattern:** keep the `setTimeout(() => proc.kill(), 5000)` guard from the analog — telemetry boot is fast, but DB/Redis connection retries can hang an unguarded subprocess.

---

## Shared Patterns

### File-header doc-block convention
**Source:** `packages/modules/billing/src/ports/payment-provider.ts` lines 1-16, `packages/modules/billing/src/provider-factory.ts` lines 6-18, `packages/modules/billing/src/adapters/stripe/stripe-adapter.ts` lines 24-35.
**Apply to:** every new `.ts` file in `packages/observability/`.
- Opens with one-line "what this is" + ticket reference (e.g., `(OBS-01)`, `(OBS-02)`, `(OBS-03)`).
- Followed by 2-4 line "design decisions" or "constraints" block.
- JSDoc block, not a `//` comment block.

### JSDoc on every exported method
**Source:** `packages/modules/billing/src/ports/payment-provider.ts` lines 42-158 — every method has `@param` + `@returns` (and `@throws` where relevant).
**Apply to:** every method on `Tracer`, `MetricsProvider`, `ErrorTracker`, every helper on `Counter`/`Histogram`/`Gauge`/`Span`, every factory function in `factory.ts`, and `validateObservabilityEnv()` in `env.ts`.

### Crash-hard env validation
**Source:** `packages/config/src/env.ts` lines 49-84.
**Apply to:** `validateObservabilityEnv()` — throw `Error` (not custom class) with a single message including the offending env key name and what value would be valid. No try/catch wrapping. Caller (`telemetry.ts`) lets it propagate — uncaught throw exits the process non-zero, which is exactly the desired behavior.

### Lazy singleton with reset/set trio
**Source:** `packages/modules/billing/src/provider-factory.ts` lines 19, 32-75, 82-95.
**Apply to:** all three observability factories — same `let instance: T | null = null;` + `get*()` (lazy init via switch) + `reset*()` (set to null) + `set*(impl)` (test-injection) shape, repeated three times in one file.

### Workspace package import naming
**Source:** `packages/config/package.json` → `@baseworks/config`, billing → `@baseworks/module-billing`, queue → `@baseworks/queue`.
**Apply to:** new package is `@baseworks/observability` (RESEARCH.md line 207 confirms this name).

### Subprocess smoke-test idiom
**Source:** `apps/api/src/__tests__/entrypoints.test.ts` lines 37-67.
**Apply to:** `apps/api/__tests__/telemetry-boot.test.ts` — `Bun.spawn` with `stdout: "pipe"`, `stderr: "pipe"`, env merged from `process.env`, `setTimeout` kill-switch, concatenate stdout+stderr, assert via `.includes()`.

---

## No Analog Found

| File                          | Role                  | Reason                                                                                                                                              | Mitigation                                                                                                                       |
|-------------------------------|-----------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------|
| `apps/api/src/telemetry.ts`   | bootstrap entrypoint  | No prior file in this codebase runs *before* `@baseworks/config` is imported. The line-1-import-side-effect pattern is new for Bun + OTEL.          | Use RESEARCH.md §"NodeSDK bootstrap" lines 297-304 for OTEL-API shape; use `apps/api/src/worker.ts` lines 1-15 for env-sequencing rhythm; obey CONTEXT.md D-04/D-05/D-06 constraints listed above. |
| Noop adapters under `packages/observability/src/adapters/noop/` | adapter (noop) | Codebase has no existing noop/in-memory adapter — only real-SDK adapters (stripe, pagarme). | Copy `class X implements Port` *shape* from `stripe-adapter.ts`; bodies are trivial no-ops returning either `void`, a noop sub-object (e.g., `NoopSpan`), or the input unchanged. |

---

## Metadata

**Analog search scope:** `packages/modules/billing/`, `packages/config/`, `packages/shared/`, `packages/i18n/`, `packages/queue/`, `apps/api/src/`, `apps/api/src/__tests__/`.
**Files scanned:** ~30 (billing module fully read; package.json files of 6 workspace packages; 2 entrypoints; 1 existing test; CONTEXT + RESEARCH for the phase).
**Pattern extraction date:** 2026-04-21.
