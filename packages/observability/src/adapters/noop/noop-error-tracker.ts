/**
 * Noop ErrorTracker adapter (OBS-01).
 *
 * Default adapter when `ERROR_TRACKER` is unset or `=noop` (Phase 17).
 * Phase 18 changes the default to the pino-sink adapter per CONTEXT D-03.
 * Zero external traffic, zero allocation growth.
 *
 * Design rule: NEVER throws on any input. Acceptance criterion asserts zero
 * `throw` statements in this file.
 */

import type {
  Breadcrumb,
  CaptureScope,
  ErrorTracker,
  ErrorTrackerScope,
} from "../../ports/error-tracker";
import type { LogLevel } from "../../ports/types";

/**
 * No-op scope handle — every mutator silently discards its argument.
 */
class NoopScope implements ErrorTrackerScope {
  setUser(_user: { id?: string; email?: string } | null): void {}
  setTag(_key: string, _value: string): void {}
  setExtra(_key: string, _value: unknown): void {}
  setTenant(_tenantId: string | null): void {}
}

/**
 * Default ErrorTracker adapter. Every operation is a no-op. `flush` always
 * resolves to `true` — there is nothing to drain.
 */
export class NoopErrorTracker implements ErrorTracker {
  readonly name = "noop";

  /**
   * Discard the exception — no backend call.
   *
   * @param _err - Error or arbitrary thrown value (ignored)
   * @param _scope - Inline scope overrides (ignored)
   */
  captureException(_err: unknown, _scope?: CaptureScope): void {}

  /**
   * Discard the message — no backend call.
   *
   * @param _message - Message text (ignored)
   * @param _level - Severity (ignored)
   */
  captureMessage(_message: string, _level?: LogLevel): void {}

  /**
   * Discard the breadcrumb.
   *
   * @param _breadcrumb - Breadcrumb record (ignored)
   */
  addBreadcrumb(_breadcrumb: Breadcrumb): void {}

  /**
   * Invoke `fn` with a fresh NoopScope and return its result. Errors from
   * `fn` propagate — the Noop adapter does not swallow them.
   *
   * @param fn - Callback receiving the scope
   * @returns Whatever `fn` returns
   */
  withScope<T>(fn: (scope: ErrorTrackerScope) => T): T {
    return fn(new NoopScope());
  }

  /**
   * Always resolves to `true` — the Noop adapter buffers nothing.
   *
   * @param _timeoutMs - Drain timeout (ignored)
   * @returns `true`
   */
  async flush(_timeoutMs?: number): Promise<boolean> {
    return true;
  }
}
