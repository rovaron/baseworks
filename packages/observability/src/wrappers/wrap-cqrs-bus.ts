/**
 * External CqrsBus wrapper (ERR-01 / Phase 18 D-01).
 *
 * Wraps `bus.execute` and `bus.query` in a try/catch that calls
 * `tracker.captureException` on THROWN exceptions only — Result.err is
 * normal flow per A5 and does NOT trigger capture. No edits to
 * apps/api/src/core/cqrs.ts; this wrapper attaches at registry boot
 * time (see apps/api/src/index.ts wire-up in plan 06).
 *
 * Design rules:
 * - BusLike type intentionally narrow (execute + query only) to avoid
 *   cross-package type cycles. The real CqrsBus type satisfies it.
 * - Re-throws the ORIGINAL error after capture — callers upstream
 *   (Elysia onError, worker.on('failed')) see the same throw they would
 *   without the wrapper.
 * - commandName/queryName attached via `extra` so conformance fixture
 *   "cqrs-error-preserves-command-name" passes.
 * - tenantId pulled from ctx if present — Phase 19 extends this with
 *   request_id/user_id via ALS without changing the wrapper signature.
 */
import type { ErrorTracker } from "../ports/error-tracker";

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
 * Wrap a CqrsBus-like object so thrown exceptions from `execute`/`query`
 * are forwarded to the ErrorTracker before being rethrown unchanged.
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
  const origExecute = bus.execute.bind(bus);
  const origQuery = bus.query.bind(bus);

  (bus as BusLike).execute = async (
    command: string,
    input: unknown,
    ctx: unknown,
  ) => {
    try {
      return await origExecute(command, input, ctx);
    } catch (err) {
      tracker.captureException(err, {
        extra: { commandName: command },
        tenantId: (ctx as { tenantId?: string | null })?.tenantId,
      });
      throw err;
    }
  };

  (bus as BusLike).query = async (
    queryName: string,
    input: unknown,
    ctx: unknown,
  ) => {
    try {
      return await origQuery(queryName, input, ctx);
    } catch (err) {
      tracker.captureException(err, {
        extra: { queryName },
        tenantId: (ctx as { tenantId?: string | null })?.tenantId,
      });
      throw err;
    }
  };

  return bus;
}
