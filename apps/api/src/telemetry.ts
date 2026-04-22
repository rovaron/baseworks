/**
 * OTEL bootstrap (OBS-04 / Phase 17).
 *
 * Imported as line 1 of apps/api/src/index.ts and apps/api/src/worker.ts
 * (D-04, D-10, wired by Plan 05). Bun does NOT honor NODE_OPTIONS=--require
 * for module patching, so this side-effect import is the ONLY way to attach
 * auto-instrumentations before any other module loads.
 *
 * This module uses a top-level `await import("@baseworks/config")` AFTER
 * `sdk.start()` (Issue 3 strict D-06). Bun supports top-level await; the
 * `import "./telemetry";` line-1 in the entrypoints will await this
 * module's initialization before continuing module evaluation.
 *
 * Constraints (do not violate):
 * - D-06 (strict): no static `from "@baseworks/config"` anywhere; the only
 *   reference is the dynamic `await import(...)` AFTER sdk.start(). The
 *   validation call is synchronous and runs BEFORE the "otel-selftest: ok"
 *   log, so a Zod failure crashes the process before any acceptance string
 *   reaches stdout.
 * - D-05: span attributes carry only {ok, role, service.name} — no PII (T-17-05).
 * - RESEARCH.md A4 / Issue 7: NodeSDK is constructed with NO exporter property
 *   anywhere in the file — zero outbound network on noop defaults (T-17-03).
 *   Phase 21 wires the OTLP exporter here.
 * - D-12: @appsignal/opentelemetry-instrumentation-bullmq NOT installed (Phase 20).
 * - Issue 5 (Option A): role type is `"api" | "worker"`. Unset defaults to "api".
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { trace } from "@opentelemetry/api";

// D-06 (strict): read env directly. Do NOT statically import @baseworks/config here.
// Issue 5 (Option A): only "api" | "worker"; unset defaults to "api".
const role: "api" | "worker" =
  process.env.INSTANCE_ROLE === "worker" ? "worker" : "api";
const isApiFlavour = role === "api";
const serviceName = role === "worker" ? "baseworks-worker" : "baseworks-api";
const serviceVersion = process.env.npm_package_version ?? "0.0.0";

// D-04 + Pattern 3 matrix. Keep this list in sync with telemetry-instrumentations.test.ts.
const instrumentations = getNodeAutoInstrumentations({
  "@opentelemetry/instrumentation-http":    { enabled: isApiFlavour },
  "@opentelemetry/instrumentation-ioredis": { enabled: true },
  "@opentelemetry/instrumentation-pino":    { enabled: true },
  "@opentelemetry/instrumentation-fs":      { enabled: false },
  "@opentelemetry/instrumentation-dns":     { enabled: false },
  "@opentelemetry/instrumentation-net":     { enabled: false },
});

// Issue 7: NodeSDK constructed without any exporter property. Zero outbound
// traffic by construction — the property's absence IS the contract. Phase 21
// wires OTLP exports here.
const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
  }),
  instrumentations,
});

// sdk.start() returns void in v0.215.x. Synchronous on purpose — Bun + OTEL
// ordering is load-bearing; see RESEARCH.md Pitfall 1.
sdk.start();

// Issue 3 (strict D-06): top-level await — runs synchronously after sdk.start()
// and BEFORE any acceptance string reaches stdout. A Zod failure throws here
// and crashes the process non-zero per D-09.
const { validateObservabilityEnv } = await import("@baseworks/config");
validateObservabilityEnv();

// D-05: self-test span. Attributes are intentionally minimal (T-17-05).
const tracer = trace.getTracer("baseworks.boot");
const span = tracer.startSpan("otel-selftest", {
  attributes: { ok: true, role, "service.name": serviceName },
});
span.end();

// Acceptance string — DO NOT change ("otel-selftest: ok").
// Use plain console.log; do NOT import apps/api/src/lib/logger.ts here
// (per 17-PATTERNS.md "Logger to use" — pino instr hasn't attached yet
//  AND logger.ts pulls @baseworks/config transitively, violating D-06).
console.log("otel-selftest: ok");

// D-11 probe line: the smoke test greps this for bidirectional assertion.
// Format: "instrumentations-loaded: <comma-separated instrumentationName values>".
// Each instrumentation exposes `instrumentationName` per the @opentelemetry/instrumentation
// Instrumentation interface. We filter on getConfig().enabled !== false so the line
// lists only the actually-enabled members.
const enabled = instrumentations
  .filter(
    (i) =>
      (i as { getConfig?: () => { enabled?: boolean } }).getConfig?.().enabled !==
      false,
  )
  .map((i) => (i as { instrumentationName: string }).instrumentationName)
  .join(",");
console.log(`instrumentations-loaded: ${enabled}`);

const shutdown = async (): Promise<void> => {
  try {
    await sdk.shutdown();
  } catch {
    /* noop SDK rarely throws */
  }
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
