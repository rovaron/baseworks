/**
 * ObservabilityContext — unified AsyncLocalStorage carrier for per-request
 * observability fields (Phase 19 / CTX-01 / D-06).
 *
 * Single ALS instance for the entire codebase. Every request-scoped concern
 * (logger mixin, HTTP/CQRS/EventBus spans, worker job seeding, locale lookup)
 * reads from this one store. Seeded exactly once per request at the outermost
 * async boundary — the Bun.serve fetch wrapper (Plan 06) for HTTP, the central
 * `createWorker` (Plan 04) for BullMQ jobs.
 *
 * Design invariants (D-01, D-03, D-24):
 * - Single `obsContext` export — no sibling AsyncLocalStorage instances allowed
 *   anywhere in the repo (Plan 08 ships the lint ban).
 * - Mutator helpers (setTenantContext / setSpan / setLocale) mutate the store
 *   IN PLACE. They NEVER open a new frame and NEVER call the banned
 *   AsyncLocalStorage method that would do so.
 * - Reading the store is permitted everywhere via `getObsContext()` or
 *   `obsContext.getStore()`.
 * - Writing fields directly via `store.tenantId = ...` outside the three
 *   exported mutators is banned (same Plan 08 lint rule); use the helpers so
 *   writes stay searchable via `grep -r "setTenantContext"`.
 *
 * The only correct seed path is `obsContext.run(ctx, fn)` — performed once
 * per request in the Bun.serve fetch wrapper (Plan 06) and once per job in
 * `createWorker` (Plan 04).
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Locale } from "@baseworks/i18n";

/**
 * Per-request observability fields carried through the async graph.
 *
 * requestId/traceId/spanId/locale are seeded non-null at request entry.
 * tenantId/userId are nullable at seed time and enriched after
 * `auth.api.getSession()` resolves in tenantMiddleware (Plan 06 / D-04).
 *
 * `inboundCarrier` is populated when the Bun.serve fetch wrapper decides
 * (per D-07) that an inbound `traceparent` should be attached as an OTEL
 * Link rather than trusted as a parent. Phase 19 Noop ignores it; Phase 21
 * OtelTracer consumes it via the widened SpanOptions.links field.
 */
export interface ObservabilityContext {
  requestId: string;
  traceId: string;
  spanId: string;
  locale: Locale;
  tenantId: string | null;
  userId: string | null;
  inboundCarrier?: Record<string, string>;
}

/**
 * The single module-level AsyncLocalStorage instance. Every package and app
 * imports THIS exact reference.
 */
export const obsContext = new AsyncLocalStorage<ObservabilityContext>();

/**
 * Read the current ALS store. Returns `undefined` if called outside any
 * `obsContext.run(...)` frame (startup logs, shutdown hooks, migration
 * scripts, direct CLI invocations).
 */
export function getObsContext(): ObservabilityContext | undefined {
  return obsContext.getStore();
}

/**
 * Publish the session-derived tenant/user into the active ALS store
 * (Plan 06 / D-04 — called from tenantMiddleware after session resolution).
 *
 * Silently no-ops outside a request frame — matches the defensive mixin
 * pattern used by the pino logger (Plan 02 / D-19).
 */
export function setTenantContext(input: {
  tenantId: string | null;
  userId: string | null;
}): void {
  const store = obsContext.getStore();
  if (store) {
    store.tenantId = input.tenantId;
    store.userId = input.userId;
  }
}

/**
 * Publish the currently-open span IDs into the active ALS store (Plan 03 /
 * D-21 — called from observabilityMiddleware.derive). Keeps the logger mixin
 * + downstream wrappers in sync with the HTTP span without a second lookup.
 *
 * Silently no-ops outside a request frame.
 */
export function setSpan(input: { traceId: string; spanId: string }): void {
  const store = obsContext.getStore();
  if (store) {
    store.traceId = input.traceId;
    store.spanId = input.spanId;
  }
}

/**
 * Overwrite the locale on the active ALS store. Rare — Phase 19 does not
 * call this path; reserved for future i18n flows (per-user locale switch
 * mid-request, etc.).
 *
 * Silently no-ops outside a request frame.
 */
export function setLocale(locale: Locale): void {
  const store = obsContext.getStore();
  if (store) {
    store.locale = locale;
  }
}
