/**
 * External CqrsBus wrapper (ERR-01 / Phase 18 D-01, extended by Phase 19 D-17).
 *
 * Phase 18 behaviour: wrap `bus.execute` and `bus.query` in try/catch, forward
 * thrown exceptions to `tracker.captureException`, then rethrow. Result.err is
 * normal flow per A5 and is NOT captured.
 *
 * Phase 19 D-17 extension (internals only — signature stays locked):
 * - Read ObservabilityContext ALS at dispatch time.
 * - Open a `cqrs.command` / `cqrs.query` span via getTracer() with
 *   `cqrs.name`, `tenant.id`, `user.id`, `request.id` attributes.
 * - On throw: `span.recordException(err) + span.setStatus({code:"error"})`
 *   BEFORE the existing `tracker.captureException(...)` call, then rethrow.
 *   Order matters: downstream span processors (Phase 21 OtelTracer) see the
 *   error context at the same time Sentry/pino-error-tracker does.
 * - ALS is source of truth for tenantId; falls back to `ctx.tenantId` only
 *   when dispatch happens outside a request frame (e.g., startup seed scripts).
 *
 * Design rules:
 * - BusLike type intentionally narrow (execute + query only) to avoid
 *   cross-package type cycles. The real CqrsBus type satisfies it.
 * - Re-throws the ORIGINAL error after capture — callers upstream
 *   (Elysia onError, worker.on('failed')) see the same throw they would
 *   without the wrapper.
 * - commandName/queryName attached via `extra` so conformance fixture
 *   "cqrs-error-preserves-command-name" passes; requestId + traceId added
 *   alongside in Phase 19 for Sentry trace-link enrichment.
 * - The `wrapCqrsBus<B extends BusLike>(bus: B, tracker: ErrorTracker): B`
 *   signature is LOCKED (D-18) — no new parameters. Consumers at
 *   apps/api/src/index.ts:46 and apps/api/src/worker.ts:41 are untouched.
 */
import type { ErrorTracker } from "../ports/error-tracker";
import { obsContext } from "../context";
import { getTracer } from "../factory";

/**
 * Minimal shape the wrapper needs — the real CqrsBus class in
 * apps/api/src/core/cqrs.ts satisfies this structurally. Keeping it
 * narrow avoids a cross-package type cycle between @baseworks/observability
 * and apps/api.
 */
export interface BusLike {
  execute<T>(command: string, input: unknown, ctx: unknown): Promise<unknown>;
  query<T>(queryName: string, input: unknown, ctx: unknown): Promise<unknown>;
}

/**
 * Wrap a CqrsBus-like object so every dispatch opens a tracer span and any
 * thrown exceptions from `execute`/`query` are annotated on the span and
 * forwarded to the ErrorTracker before being rethrown unchanged.
 * Result.err returns (normal flow per A5) are NOT inspected or captured.
 *
 * @param bus - CqrsBus-like instance (mutated in place; also returned)
 * @param tracker - ErrorTracker used to report thrown exceptions
 * @returns The same bus instance, with execute/query wrapped
 */
export function wrapCqrsBus<B extends BusLike>(
  bus: B,
  tracker: ErrorTracker,
): B {
  const tracer = getTracer();
  const origExecute = bus.execute.bind(bus);
  const origQuery = bus.query.bind(bus);

  (bus as BusLike).execute = async (
    command: string,
    input: unknown,
    ctx: unknown,
  ) => {
    const store = obsContext.getStore();
    return tracer.withSpan(
      "cqrs.command",
      async (span) => {
        try {
          return await origExecute(command, input, ctx);
        } catch (err) {
          // D-17 order: span telemetry BEFORE tracker.captureException so
          // downstream span processors (Phase 21 OtelTracer) see the error
          // at the same time Sentry/pino-error-tracker does.
          span.recordException(err);
          span.setStatus({ code: "error" });
          tracker.captureException(err, {
            extra: {
              commandName: command,
              requestId: store?.requestId,
              traceId: store?.traceId,
            },
            // ALS source of truth (D-17); ctx.tenantId is fallback for calls
            // dispatched outside a request frame (e.g., startup seed).
            tenantId:
              store?.tenantId ??
              (ctx as { tenantId?: string | null })?.tenantId,
          });
          throw err;
        }
      },
      {
        attributes: {
          "cqrs.name": command,
          "tenant.id": store?.tenantId ?? "",
          "user.id": store?.userId ?? "",
          "request.id": store?.requestId ?? "",
        },
      },
    );
  };

  (bus as BusLike).query = async (
    queryName: string,
    input: unknown,
    ctx: unknown,
  ) => {
    const store = obsContext.getStore();
    return tracer.withSpan(
      "cqrs.query",
      async (span) => {
        try {
          return await origQuery(queryName, input, ctx);
        } catch (err) {
          // D-17 order: span telemetry BEFORE tracker.captureException.
          span.recordException(err);
          span.setStatus({ code: "error" });
          tracker.captureException(err, {
            extra: {
              queryName,
              requestId: store?.requestId,
              traceId: store?.traceId,
            },
            tenantId:
              store?.tenantId ??
              (ctx as { tenantId?: string | null })?.tenantId,
          });
          throw err;
        }
      },
      {
        attributes: {
          "cqrs.name": queryName,
          "tenant.id": store?.tenantId ?? "",
          "user.id": store?.userId ?? "",
          "request.id": store?.requestId ?? "",
        },
      },
    );
  };

  return bus;
}
