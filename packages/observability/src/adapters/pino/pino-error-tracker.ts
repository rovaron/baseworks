/**
 * Pino-sink ErrorTracker adapter (ERR-03 / Phase 18 D-07).
 *
 * Default adapter when `ERROR_TRACKER` is unset or `=pino` (Plan 18-01 widens
 * the Phase-17 noop default per D-06). Writes through a caller-provided pino
 * logger at the appropriate level with full structured scope. Zero external
 * traffic — safe for local development and no-DSN forks.
 *
 * Design rules:
 * - `scrubPii` is applied INSIDE `captureException` BEFORE `logger.error`
 *   (D-12 defense-in-depth — ERR-04 conformance gate).
 * - Breadcrumb ring buffer bounded at `BREADCRUMB_BUFFER_SIZE` entries with
 *   oldest-first eviction. Unbounded buffers leak memory in long-running
 *   worker processes (threat T-18-22).
 * - `withScope` provides a closure-scoped scope object — NO instance state
 *   for scope fields. Otherwise concurrent requests would leak tenantId
 *   across each other (Pitfall 4 / threat T-18-21). Phase-18 contract:
 *   setters write to the closure-local object ONLY; they do NOT bind to
 *   subsequent `captureException` calls. Tenant/user/request binding to
 *   `captureException` is Phase 19's job (ALS-driven).
 * - `flush` always resolves `true` — pino is synchronous from the adapter's
 *   POV. Underlying stream backpressure is a pino concern, not ours
 *   (threat T-18-23 accepted).
 * - Non-Error thrown values (`throw "string"`, `throw { code: 42 }`) are
 *   wrapped as `{ value: String(err) }` so log output is never garbled
 *   (threat T-18-24).
 */

import type { Logger } from "pino";
import { scrubPii } from "../../lib/scrub-pii";
import type {
  Breadcrumb,
  CaptureScope,
  ErrorTracker,
  ErrorTrackerScope,
} from "../../ports/error-tracker";
import type { LogLevel } from "../../ports/types";

/** Max breadcrumbs held in the ring; oldest-first eviction on overflow. */
const BREADCRUMB_BUFFER_SIZE = 10;

/**
 * Resolve the pino method that matches a port `LogLevel`. Defaults to
 * `info` when the level is missing or unrecognized.
 *
 * Mapping (D-07 generalized to the port's full LogLevel enum):
 * - `"fatal"`   → `logger.fatal` (pino level 60)
 * - `"error"`   → `logger.error` (pino level 50)
 * - `"warning"` → `logger.warn`  (pino level 40)
 * - `"info"`    → `logger.info`  (pino level 30)
 * - `"debug"`   → `logger.debug` (pino level 20)
 * - default     → `logger.info`  (pino level 30)
 *
 * The port vocabulary uses `"warning"` (Sentry-native) rather than pino's
 * `"warn"` — this mapper bridges the two. Plan D-07 colloquially referred
 * to `"warn"`; the authoritative source is `ports/types.ts LogLevel`.
 *
 * @param logger - Pino logger instance
 * @param level - Port-level log severity
 * @returns Bound pino method that accepts `(obj, msg)` or `(msg)`
 */
function pinoMethod(
  logger: Logger,
  level?: LogLevel,
): (obj: unknown, msg?: string) => void {
  switch (level) {
    case "fatal":
      return logger.fatal.bind(logger);
    case "error":
      return logger.error.bind(logger);
    case "warning":
      return logger.warn.bind(logger);
    case "debug":
      return logger.debug.bind(logger);
    // biome-ignore lint/complexity/noUselessSwitchCase: explicit for clarity
    case "info":
    default:
      return logger.info.bind(logger);
  }
}

/**
 * ErrorTracker adapter that forwards to a pino logger with structured scope
 * (tenantId, user, tags, extra) and ring-buffered breadcrumbs serialized into
 * `extra.breadcrumbs`. Satisfies ERR-03's "full structured context, zero
 * external dependency" contract.
 */
export class PinoErrorTracker implements ErrorTracker {
  readonly name = "pino";
  private breadcrumbs: Breadcrumb[] = [];

  /**
   * @param logger - Pino logger instance. Callers typically pass the app
   *   singleton from `apps/api/src/lib/logger.ts` or construct a dedicated
   *   child via `logger.child({ adapter: "pino" })`.
   */
  constructor(private logger: Logger) {}

  /**
   * Forward an exception to the pino logger at ERROR level. Applies
   * `scrubPii` to the whole payload before the log call (D-12). Serializes
   * and clears the breadcrumb ring buffer. Wraps non-Error throws as
   * `{ value: String(err) }`.
   *
   * @param err - Error instance or arbitrary thrown value
   * @param scope - Optional inline scope overrides for this capture
   */
  captureException(err: unknown, scope?: CaptureScope): void {
    const errPayload =
      err instanceof Error
        ? { message: err.message, stack: err.stack, name: err.name }
        : { value: String(err) };

    const raw = {
      err: errPayload,
      user: scope?.user,
      tags: scope?.tags,
      extra: scope?.extra,
      tenantId: scope?.tenantId,
      breadcrumbs: [...this.breadcrumbs],
    };

    const scrubbed = scrubPii(raw) ?? raw;
    this.logger.error(scrubbed, "captured exception");
    this.breadcrumbs = [];
  }

  /**
   * Forward a free-form message to the pino logger at the matching level
   * (1:1 mapping per D-07). Defaults to `info` when level is omitted.
   *
   * @param message - Message text
   * @param level - Severity (defaults to `info`)
   */
  captureMessage(message: string, level?: LogLevel): void {
    pinoMethod(this.logger, level)(message);
  }

  /**
   * Append a breadcrumb to the per-instance ring buffer. Enforces the cap
   * via oldest-first eviction — entries beyond `BREADCRUMB_BUFFER_SIZE`
   * are removed from the front so the newest always survives.
   *
   * @param breadcrumb - Breadcrumb record
   */
  addBreadcrumb(breadcrumb: Breadcrumb): void {
    this.breadcrumbs.push(breadcrumb);
    if (this.breadcrumbs.length > BREADCRUMB_BUFFER_SIZE) {
      // Oldest-first eviction — drop the leading overflow.
      this.breadcrumbs.splice(0, this.breadcrumbs.length - BREADCRUMB_BUFFER_SIZE);
    }
  }

  /**
   * Run `fn` with a fresh closure-scoped `ErrorTrackerScope`. Scope setters
   * write to a local object ONLY — they do NOT bind to subsequent
   * `captureException` calls outside the callback (Pitfall 4 / T-18-21).
   * Phase-18 callers must pass scope fields explicitly on each
   * `captureException`; Phase 19 wires ALS-derived context instead.
   *
   * @param fn - Callback receiving the scope
   * @returns Whatever `fn` returns (synchronously)
   */
  withScope<T>(fn: (scope: ErrorTrackerScope) => T): T {
    const local: {
      user?: { id?: string; email?: string } | null;
      tags: Record<string, string>;
      extra: Record<string, unknown>;
      tenantId?: string | null;
    } = { tags: {}, extra: {} };

    const scope: ErrorTrackerScope = {
      setUser: (u) => {
        local.user = u;
      },
      setTag: (k, v) => {
        local.tags[k] = v;
      },
      setExtra: (k, v) => {
        local.extra[k] = v;
      },
      setTenant: (t) => {
        local.tenantId = t;
      },
    };

    return fn(scope);
  }

  /**
   * Always resolves `true` — pino is synchronous from the adapter's POV.
   * Underlying stream backpressure is a pino concern, not this adapter's
   * (T-18-23 accepted).
   *
   * @param _timeoutMs - Drain timeout (ignored)
   * @returns `true`
   */
  async flush(_timeoutMs?: number): Promise<boolean> {
    return true;
  }
}
