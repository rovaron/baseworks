/**
 * ErrorTracker port interface (OBS-01).
 *
 * Contract for error-tracking adapters. Phase 17 ships NoopErrorTracker as the
 * default; Phase 18 adds pino-sink/Sentry/GlitchTip adapters. Mirrors the
 * GlitchTip API surface subset that is present in Sentry (captureException,
 * captureMessage, breadcrumbs, scope user/tag/extra/tenant, flush).
 *
 * Design decisions:
 * - `withScope` takes a callback so scope state is exception-safe and does
 *   not leak across concurrent captures (Phase 19's ALS context is NOT used
 *   here).
 * - `setTenant` is a first-class scope method (not a tag) because tenantId
 *   is the primary filter dimension in every support ticket workflow.
 * - `flush` returns boolean so callers can gate process-exit on drain
 *   success.
 */

import type { LogLevel } from "./types";

/**
 * Breadcrumb — a discrete event recorded prior to an exception for context.
 */
export interface Breadcrumb {
  /** Human-readable description of the event. */
  message: string;
  /** Optional classification (e.g., `"ui"`, `"http"`, `"db"`). */
  category?: string;
  /** Severity of the breadcrumb event. */
  level?: LogLevel;
  /** Additional structured data (non-PII). */
  data?: Record<string, unknown>;
  /** Unix-epoch milliseconds; adapters default to "now" when omitted. */
  timestamp?: number;
}

/**
 * Scope handle passed to `ErrorTracker.withScope` callback. Mutations apply
 * only to captures that happen inside the callback.
 */
export interface ErrorTrackerScope {
  /**
   * Attach or clear the current user.
   *
   * @param user - User identification, or `null` to clear
   */
  setUser(user: { id?: string; email?: string } | null): void;

  /**
   * Set a short string tag for filtering in the backend UI.
   *
   * @param key - Tag key
   * @param value - Tag value (always a string)
   */
  setTag(key: string, value: string): void;

  /**
   * Attach arbitrary structured data to the scope.
   *
   * @param key - Extra data key
   * @param value - Arbitrary value (non-PII recommended)
   */
  setExtra(key: string, value: unknown): void;

  /**
   * Attach or clear the current tenant. First-class (not a tag) because
   * tenantId is the primary support-triage dimension.
   *
   * @param tenantId - Tenant ID, or `null` to clear
   */
  setTenant(tenantId: string | null): void;
}

/**
 * Optional scope overrides passed inline with a `captureException` call.
 */
export interface CaptureScope {
  user?: { id?: string; email?: string } | null;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  tenantId?: string | null;
}

/**
 * Error tracker port. Every adapter exposes the same surface — call sites
 * never branch on adapter identity.
 */
export interface ErrorTracker {
  /** Adapter identifier (e.g., `"noop"`, `"pino-sink"`, `"sentry"`). */
  readonly name: string;

  /**
   * Capture an exception and forward it to the backend.
   *
   * @param err - Error object or arbitrary thrown value
   * @param scope - Optional inline scope overrides for this single capture
   */
  captureException(err: unknown, scope?: CaptureScope): void;

  /**
   * Capture a free-form message.
   *
   * @param message - Message text
   * @param level - Severity (defaults to `"info"`)
   */
  captureMessage(message: string, level?: LogLevel): void;

  /**
   * Record a breadcrumb — attached to future captures in the same scope.
   *
   * @param breadcrumb - Breadcrumb record
   */
  addBreadcrumb(breadcrumb: Breadcrumb): void;

  /**
   * Run `fn` with a scoped `ErrorTrackerScope`. Scope mutations apply only
   * to captures that happen inside the callback — implementations must not
   * leak scope across concurrent calls.
   *
   * @param fn - Callback receiving the scope
   * @returns Whatever `fn` returns
   */
  withScope<T>(fn: (scope: ErrorTrackerScope) => T): T;

  /**
   * Flush any buffered events to the backend.
   *
   * @param timeoutMs - Optional drain timeout (adapters apply a sensible default)
   * @returns `true` if the flush completed before the timeout, `false`
   *   otherwise
   */
  flush(timeoutMs?: number): Promise<boolean>;
}

// Re-export types for convenience
export type { LogLevel } from "./types";
