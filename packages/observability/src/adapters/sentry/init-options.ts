/**
 * Sentry.init options builder (Phase 18 / D-15 / A1 Option C).
 *
 * Pure function — returns the exact InitOptions the Sentry adapter feeds
 * to Sentry.init(). Test-friendly (conformance test overrides transport).
 *
 * Design rules (non-negotiable):
 * - sendDefaultPii: false — hard-coded; no env override (trip-wire risk).
 *   Encoded as a literal `false` rather than a variable so the acceptance
 *   grep `grep "sendDefaultPii: false"` matches exactly once (T-18-29).
 * - defaultIntegrations: false — A1 resolution: empty `integrations: []`
 *   does NOT disable defaults in @sentry/bun. Must use defaultIntegrations
 *   flag. This avoids double-registering global handlers (D-02 owns
 *   uncaughtException/unhandledRejection) AND suppresses bunServerIntegration
 *   which auto-patches Bun.serve and would auto-capture request bodies.
 * - Safe integrations re-added explicitly (Option C):
 *     inboundFiltersIntegration — noise reduction / error filtering
 *     dedupeIntegration          — prevents duplicate reports
 *     linkedErrorsIntegration    — walks `cause` chain for nested errors
 *     functionToStringIntegration — preserves `Function#toString` for stacks
 *   No HTTP/Bun.serve/requestData integrations — those would auto-capture
 *   request bodies (Pitfall 2, threat T-18-26).
 * - beforeSend + beforeBreadcrumb run scrubPii — defense-in-depth (D-12).
 *   Even with sendDefaultPii false and no body-capturing integrations,
 *   users can still manually attach PII via scope.extra; scrubPii catches it.
 */
import * as Sentry from "@sentry/bun";
import type { Transport } from "@sentry/core";
import { scrubPii } from "../../lib/scrub-pii";
import type { PiiEvent } from "../../lib/scrub-pii";

/**
 * Options accepted by `buildInitOptions`. A thin subset of Sentry.init opts
 * — only the fields the adapter permits callers to configure.
 */
export interface SentryInitOpts {
  /** Sentry or GlitchTip DSN (required). */
  dsn: string;
  /** Release identifier — typically short git SHA (D-19). */
  release?: string;
  /** Environment name — typically `NODE_ENV` or `SENTRY_ENVIRONMENT`. */
  environment?: string;
  /**
   * Optional transport factory. Conformance tests pass `makeTestTransport()`
   * to capture envelopes in-process (A2). Production leaves this undefined
   * so Sentry uses its default fetch transport.
   */
  // biome-ignore lint/suspicious/noExplicitAny: Sentry's transport factory signature is generic by design
  transport?: (options: any) => Transport;
}

/**
 * Build the Sentry.init options object.
 *
 * @param opts - Adapter-level options (dsn, release, environment, transport)
 * @returns The exact InitOptions object to feed to `Sentry.init()`
 */
export function buildInitOptions(
  opts: SentryInitOpts,
): Parameters<typeof Sentry.init>[0] {
  return {
    dsn: opts.dsn,
    release: opts.release,
    environment: opts.environment,
    sendDefaultPii: false,
    // biome-ignore lint/suspicious/noExplicitAny: Sentry's Event type is a superset of our PiiEvent — cast via unknown at the boundary
    beforeSend: (event) => scrubPii(event as unknown as PiiEvent) as any,
    // biome-ignore lint/suspicious/noExplicitAny: Sentry's Breadcrumb type is a superset of our PiiEvent — cast via unknown at the boundary
    beforeBreadcrumb: (bc) => scrubPii(bc as unknown as PiiEvent) as any,
    defaultIntegrations: false,
    integrations: [
      Sentry.inboundFiltersIntegration(),
      Sentry.dedupeIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.functionToStringIntegration(),
    ],
    transport: opts.transport,
  };
}
