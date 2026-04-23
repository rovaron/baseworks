/**
 * Sentry/GlitchTip ErrorTracker adapter (ERR-01, ERR-02 / Phase 18 D-05).
 *
 * One class serves BOTH Sentry and GlitchTip targets via the `kind` tag.
 * GlitchTip's wire protocol is Sentry-compatible (STACK.md), so the DSN
 * swap proves parity (ERR-02 gate is structural, not behavioral). This
 * file and `init-options.ts` are the ONLY modules that import `@sentry/bun`.
 *
 * Design rules:
 * - Sentry.init called in ctor via `buildInitOptions(opts)`. Testable because
 *   the conformance test passes `opts.transport = makeTestTransport()` to
 *   capture envelopes in-memory (A2). Hard-coded safe defaults live in
 *   init-options (D-15 / A1 Option C).
 * - Port methods delegate thinly to `@sentry/bun` top-level functions. The
 *   Sentry SDK owns the global hub, client, and transport lifecycle; the
 *   adapter is a boundary-layer glue class.
 * - `withScope` bridges the port's ErrorTrackerScope interface to Sentry's
 *   native Scope by wiring scope methods one-to-one. `setTenant` maps to
 *   `setTag("tenantId", value)` — Sentry doesn't have a first-class tenant
 *   concept but tags are the correct dimension.
 * - `flush` returns Sentry's flush result as-is. Test 7 asserts it's a
 *   boolean; callers gate process-exit on the drain result.
 *
 * Non-Error throws: Sentry's captureException handles non-Error values
 * natively (stringifies / wraps as needed), so no adapter-level wrapping.
 */
import * as Sentry from "@sentry/bun";
import type { Transport } from "@sentry/core";
import { buildInitOptions } from "./init-options";
import type {
  Breadcrumb,
  CaptureScope,
  ErrorTracker,
  ErrorTrackerScope,
} from "../../ports/error-tracker";
import type { LogLevel } from "../../ports/types";

/**
 * Options for constructing a SentryErrorTracker. `kind` selects the target
 * backend (Sentry or GlitchTip); both use the same wire protocol so the
 * choice only affects the adapter's `name` field.
 */
export interface SentryErrorTrackerOptions {
  /** DSN of the target Sentry/GlitchTip project. */
  dsn: string;
  /** Target backend — drives only the adapter's `name` property (D-05). */
  kind: "sentry" | "glitchtip";
  /** Release identifier — typically short git SHA (D-19). */
  release?: string;
  /** Environment name — typically `NODE_ENV` or `SENTRY_ENVIRONMENT`. */
  environment?: string;
  /**
   * Optional transport factory. Conformance tests pass `makeTestTransport()`
   * to capture envelopes in-process (A2). Production leaves this undefined.
   */
  // biome-ignore lint/suspicious/noExplicitAny: Sentry's transport factory signature is generic by design
  transport?: (options: any) => Transport;
}

/**
 * Sentry/GlitchTip adapter. `name` is either `"sentry"` or `"glitchtip"`
 * per the `kind` option — the class itself is identical across the two
 * (ERR-02 parity via single code path).
 */
export class SentryErrorTracker implements ErrorTracker {
  readonly name: "sentry" | "glitchtip";

  /**
   * @param opts - Adapter options (dsn, kind, release, environment, transport)
   */
  constructor(opts: SentryErrorTrackerOptions) {
    this.name = opts.kind;
    Sentry.init(buildInitOptions(opts));
  }

  /**
   * Capture an exception. Delegates to `Sentry.captureException`. Port
   * `CaptureScope.tenantId` has no Sentry-native equivalent, so it is
   * translated to a `tenantId` tag (mirrors the withScope mapping). All
   * other fields (extra, tags, user) pass through to Sentry's CaptureContext
   * shape directly — Sentry accepts partial overrides inline.
   *
   * @param err - Error instance or arbitrary thrown value
   * @param scope - Optional inline scope overrides for this capture
   */
  captureException(err: unknown, scope?: CaptureScope): void {
    if (!scope) {
      Sentry.captureException(err);
      return;
    }
    const { tenantId, tags, ...rest } = scope;
    const mergedTags =
      tenantId !== undefined && tenantId !== null
        ? { ...(tags ?? {}), tenantId: String(tenantId) }
        : tags;
    const ctx: Sentry.CaptureContext = {
      ...(rest as Sentry.CaptureContext),
      ...(mergedTags ? { tags: mergedTags } : {}),
    };
    Sentry.captureException(err, ctx);
  }

  /**
   * Capture a free-form message at the requested severity. Port `LogLevel`
   * uses Sentry-native vocabulary ("warning", not "warn") so no translation
   * is needed.
   *
   * @param message - Message text
   * @param level - Severity (defaults to Sentry's `"info"`)
   */
  captureMessage(message: string, level?: LogLevel): void {
    Sentry.captureMessage(message, level as Sentry.SeverityLevel | undefined);
  }

  /**
   * Record a breadcrumb on the current Sentry scope. Sentry enforces its
   * own ring buffer (default 100). `scrubPii` runs via the beforeBreadcrumb
   * hook so PII never reaches the SDK's buffer.
   *
   * @param breadcrumb - Breadcrumb record
   */
  addBreadcrumb(breadcrumb: Breadcrumb): void {
    Sentry.addBreadcrumb(breadcrumb);
  }

  /**
   * Run `fn` with a scoped ErrorTrackerScope. Bridges the port's scope
   * interface to Sentry's native Scope by wiring setters one-to-one.
   * `setTenant` maps to a `tenantId` tag — Sentry doesn't have a first-class
   * tenant concept, but tags are the correct filter dimension.
   *
   * @param fn - Callback receiving the port scope
   * @returns Whatever `fn` returns
   */
  withScope<T>(fn: (scope: ErrorTrackerScope) => T): T {
    let result!: T;
    Sentry.withScope((sentryScope) => {
      const portScope: ErrorTrackerScope = {
        setUser: (user) => sentryScope.setUser(user),
        setTag: (key, value) => sentryScope.setTag(key, value),
        setExtra: (key, value) => sentryScope.setExtra(key, value),
        setTenant: (tenantId) =>
          sentryScope.setTag("tenantId", tenantId ?? ""),
      };
      result = fn(portScope);
    });
    return result;
  }

  /**
   * Flush any buffered events. Returns Sentry's flush result unchanged —
   * `true` if the drain completed, `false` on timeout.
   *
   * @param timeoutMs - Drain timeout in milliseconds
   * @returns `true` if drain completed, `false` on timeout
   */
  flush(timeoutMs?: number): Promise<boolean> {
    return Sentry.flush(timeoutMs);
  }
}
