---
phase: 17-observability-ports-otel-bootstrap
reviewed: 2026-04-22T00:00:00Z
depth: standard
files_reviewed: 27
files_reviewed_list:
  - apps/api/__tests__/telemetry-boot.test.ts
  - apps/api/__tests__/telemetry-instrumentations.test.ts
  - apps/api/__tests__/telemetry-line1.test.ts
  - apps/api/package.json
  - apps/api/src/index.ts
  - apps/api/src/telemetry.ts
  - apps/api/src/worker.ts
  - packages/config/src/__tests__/validate-observability-env.test.ts
  - packages/config/src/env.ts
  - packages/config/src/index.ts
  - packages/observability/package.json
  - packages/observability/src/adapters/noop/noop-error-tracker.ts
  - packages/observability/src/adapters/noop/noop-metrics.ts
  - packages/observability/src/adapters/noop/noop-tracer.ts
  - packages/observability/src/factory.ts
  - packages/observability/src/factory/__tests__/error-tracker-factory.test.ts
  - packages/observability/src/factory/__tests__/metrics-factory.test.ts
  - packages/observability/src/factory/__tests__/tracer-factory.test.ts
  - packages/observability/src/index.ts
  - packages/observability/src/ports/__tests__/error-tracker.test.ts
  - packages/observability/src/ports/__tests__/metrics.test.ts
  - packages/observability/src/ports/__tests__/tracer.test.ts
  - packages/observability/src/ports/error-tracker.ts
  - packages/observability/src/ports/metrics.ts
  - packages/observability/src/ports/tracer.ts
  - packages/observability/src/ports/types.ts
  - packages/observability/tsconfig.json
  - tsconfig.json
findings:
  critical: 0
  warning: 3
  info: 6
  total: 9
status: issues_found
---

# Phase 17: Code Review Report

**Reviewed:** 2026-04-22
**Depth:** standard
**Files Reviewed:** 27
**Status:** issues_found

## Summary

Phase 17 ships three observability ports (Tracer, MetricsProvider, ErrorTracker) with noop-only adapters, an env-selected factory layer, and an OTEL NodeSDK bootstrap in `apps/api/src/telemetry.ts`. The design is disciplined: D-06 strict ordering is enforced by a dynamic `await import("@baseworks/config")` after `sdk.start()`, line-1 ordering is protected by a dedicated test, and the NodeSDK is constructed without an exporter property so there is zero outbound network on noop defaults (T-17-03). Port contracts are well-typed and the noop adapters correctly never throw.

Overall code quality is high and the phase contracts (D-03/D-04/D-05/D-06/D-09/Issue 3/Issue 5/Issue 7) appear faithfully implemented. Findings are limited to a small number of consistency/robustness issues and some minor style observations — no critical defects, no security vulnerabilities, no PII leakage risks.

## Warnings

### WR-01: Empty-string env var bypasses `emptyStringAsUndefined` coercion in factory

**File:** `packages/observability/src/factory.ts:42`, `:97`, `:152`
**Issue:** The factory reads `process.env.TRACER`, `process.env.METRICS_PROVIDER`, and `process.env.ERROR_TRACKER` directly and uses `?? "noop"` as the fallback. `??` only triggers on `null` / `undefined`, so an empty string (e.g. `TRACER=` in a `.env` file) falls through to `switch(name)` with `name === ""` and throws `"Unknown TRACER: . Phase 17 supports only 'noop'."` at the first `getTracer()` call.

`packages/config/src/env.ts` uses `emptyStringAsUndefined: true` and so treats `TRACER=""` identically to unset — but the factory deliberately skips `@baseworks/config` (per the D-06 module comment) and loses that coercion. An operator who writes an empty assignment expecting "unset" gets a crash with a confusing message instead of the noop default.

**Fix:**
```typescript
// factory.ts — normalize empty/whitespace to undefined the same way Zod does
const raw = process.env.TRACER;
const name = (raw === undefined || raw.trim() === "") ? "noop" : raw;
```
Apply the same normalization in `getMetrics()` and `getErrorTracker()`. Alternatively, extract a tiny helper `readAdapterEnv(key: string, fallback: string): string`.

---

### WR-02: `assertRedisUrl` returns `undefined` cast as `string` for non-worker roles

**File:** `packages/config/src/env.ts:143-150`
**Issue:** `assertRedisUrl` only validates when `role === "worker" || role === "all"`. For any other role (notably `"api"`), the function skips the guard and returns `redisUrl as string`, where `redisUrl` can be `undefined`. The `as string` suppresses the TypeScript signal that `undefined` is possible. Callers relying on the non-nullable return type will read `.ping()` or pass it to `getRedisConnection()` and crash with "Cannot read properties of undefined" far from the root cause.

Within Phase 17 the only caller is `apps/api/src/worker.ts:13` where `role === "worker"`, so the bug is latent today, but the contract is unsound.

**Fix:**
```typescript
export function assertRedisUrl(role: string, redisUrl?: string): string {
  if ((role === "worker" || role === "all") && !redisUrl) {
    throw new Error(
      `REDIS_URL is required when INSTANCE_ROLE is "${role}". ...`,
    );
  }
  if (!redisUrl) {
    throw new Error(
      `REDIS_URL is required to call assertRedisUrl (role="${role}").`,
    );
  }
  return redisUrl;
}
```
Or, if the intent is that non-worker callers simply should not call this helper, narrow the parameter type to the worker-requiring roles and delete the ambiguous `as string`.

---

### WR-03: `WORKER_HEALTH_PORT` read twice with inconsistent coercion

**File:** `apps/api/src/worker.ts:86`
**Issue:** `packages/config/src/env.ts:39` defines `WORKER_HEALTH_PORT: z.coerce.number().default(3001)` and exports the validated, coerced, defaulted value via `env`. `worker.ts` then bypasses this and reads `process.env.WORKER_HEALTH_PORT` directly with `Number(...) || 3001`, which:
1. Duplicates schema logic.
2. Returns `3001` for `WORKER_HEALTH_PORT=0` (since `0 || 3001 === 3001`), even though `0` is a valid port number in the schema's type (and triggers `Bun.serve` on an ephemeral port, which some operators rely on).
3. Drifts silently if the schema default or validator changes.

**Fix:**
```typescript
// worker.ts
const WORKER_HEALTH_PORT = env.WORKER_HEALTH_PORT;
```
Drop the `Number(process.env.WORKER_HEALTH_PORT) || 3001` pattern entirely.

---

## Info

### IN-01: Redundant type assertion on `env.INSTANCE_ROLE`

**File:** `apps/api/src/index.ts:28`
**Issue:** `role: env.INSTANCE_ROLE as "api" | "worker" | "all"` — the Zod schema already narrows `INSTANCE_ROLE` to `"api" | "worker" | "all"`, so the `as` cast is a no-op. Casts hide future type regressions (e.g. if someone adds `"scheduler"` to the enum but forgets to update consumers, the cast silently truncates).
**Fix:** Drop the cast: `role: env.INSTANCE_ROLE,`.

---

### IN-02: Swallowed error objects in health checks

**File:** `apps/api/src/index.ts:74`, `:86`; `apps/api/src/worker.ts:104`
**Issue:** `catch (err) { checks.database = { status: "down", error: "Failed to connect" }; }` — `err` is bound but never used; the original error (network timeout vs. auth failure vs. DNS resolution) is lost. For a diagnostic endpoint this is a missed signal. Using `_err` would at least mark intent; logging at debug/warn level would retain the context.
**Fix:**
```typescript
} catch (err) {
  logger.warn({ err: String(err) }, "Health check: database unreachable");
  checks.database = { status: "down", error: "Failed to connect" };
}
```
Or rename the unused binding to `_err` to make the intent explicit. Apply the same pattern to the `redis` branches.

---

### IN-03: Silent `catch {}` in telemetry shutdown

**File:** `apps/api/src/telemetry.ts:106-108`
**Issue:** `try { await sdk.shutdown(); } catch { /* noop SDK rarely throws */ }` — the empty catch suppresses any error, including programmer mistakes (e.g. if a future Phase-21 change replaces `sdk` with a variable that is `undefined` in some code path). A single line of diagnostic output is very cheap at shutdown and would surface regressions.
**Fix:**
```typescript
const shutdown = async (): Promise<void> => {
  try {
    await sdk.shutdown();
  } catch (err) {
    // Shutdown failures must not block process exit, but log for postmortem.
    console.warn("otel-shutdown-failed:", String(err));
  }
};
```

---

### IN-04: Declared OpenTelemetry deps unused in Phase 17 observability package

**File:** `packages/observability/package.json:8-14`
**Issue:** `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/resources`, and `@opentelemetry/semantic-conventions` are declared as dependencies of `@baseworks/observability`, but no file under `packages/observability/src/` imports them in Phase 17 (the noop adapters and the factory reference only local ports). These are reserved for Phase 21 OTEL adapters.

This installs ~6 MB of runtime dependencies into every consumer of `@baseworks/observability` today for zero benefit. It also makes `bun install` slower for unrelated consumers (e.g. the admin dashboard if it ever imports the package for type-only reasons).
**Fix:** Either (a) move these to `peerDependencies` / `optionalDependencies` until Phase 21 wires them in, or (b) add a `// phase-21` comment so the next reviewer knows they are intentional. Leaving them unused without annotation is fine but marks technical debt.

---

### IN-05: File/directory name collision at `packages/observability/src/factory`

**File:** `packages/observability/src/factory.ts` vs `packages/observability/src/factory/__tests__/`
**Issue:** There is both a file `src/factory.ts` and a directory `src/factory/` in the same parent. Node module resolution picks the file first (so `import "../factory"` works), but editors, git tooling, and some linters get confused by the pair (e.g. VS Code's "Go to Symbol in Workspace" shows ambiguous results; `grep -r factory` output is noisier). The ports package uses the opposite convention — tests live at `src/ports/__tests__/` alongside the port files — and the factory tests could mirror that.
**Fix:** Move the factory tests to `packages/observability/src/__tests__/factory.test.ts` (single-file form) or split by port into `.../src/__tests__/tracer-factory.test.ts` etc. Pick one convention and apply it to both ports and factory.

---

### IN-06: `factory.ts` and `telemetry.ts` construct parallel auto-instrumentation matrices

**File:** `apps/api/src/telemetry.ts:45-52` and `apps/api/__tests__/telemetry-instrumentations.test.ts:20-30`
**Issue:** The auto-instrumentation matrix (http/ioredis/pino/fs/dns/net toggles) is copied verbatim between the production file and the test file. The header comment acknowledges this (`"if you change one, change both"`), but the coupling is a latent footgun: a drift would not fail either suite, since each would test its own copy, and the bug would manifest only at runtime as a silent missing instrumentation.
**Fix:** Export the matrix-builder from `telemetry.ts` (or a helper module `apps/api/src/telemetry/matrix.ts`) and import it from the test:
```typescript
// apps/api/src/telemetry/matrix.ts
export function buildInstrumentationMatrix(role: "api" | "worker") {
  const isApiFlavour = role === "api";
  return getNodeAutoInstrumentations({
    "@opentelemetry/instrumentation-http":    { enabled: isApiFlavour },
    "@opentelemetry/instrumentation-ioredis": { enabled: true },
    "@opentelemetry/instrumentation-pino":    { enabled: true },
    "@opentelemetry/instrumentation-fs":      { enabled: false },
    "@opentelemetry/instrumentation-dns":     { enabled: false },
    "@opentelemetry/instrumentation-net":     { enabled: false },
  });
}
```
The caveat: `telemetry.ts` must stay a side-effect-only module that does not export names, so the helper would need to live in a sibling file imported by `telemetry.ts`. That is still a single source of truth.

If the current duplication is kept intentionally for the D-06 ordering guarantee (i.e., refusing to add any static import to `telemetry.ts` that could pull in transitive dependencies), then document that trade-off next to both matrices rather than only in the test header.

---

---

_Reviewed: 2026-04-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
