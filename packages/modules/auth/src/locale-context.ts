import { defaultLocale, type Locale } from "@baseworks/i18n";
import { obsContext } from "@baseworks/observability";

/**
 * Read the current request's locale from the unified observability ALS
 * (Phase 19 / CTX-01 / D-10 / D-11).
 *
 * Returns `defaultLocale` if called outside any request frame — e.g. from
 * a BullMQ worker, a migration script, or any non-HTTP entry point. API
 * surface unchanged from Phase 12: every existing caller (sendInvitationEmail,
 * better-auth callbacks) continues to work without modification.
 *
 * Phase 19 migration: this module previously owned a dedicated locale ALS
 * instance plus an Elysia plugin that seeded it via the now-banned mutator.
 * Both are gone — context lives in @baseworks/observability (obsContext),
 * and cookie parsing moves to apps/api/src/lib/locale-cookie.ts (Plan 05)
 * where the Bun.serve fetch wrapper (Plan 06) performs the single seed per
 * request before the Elysia pipeline runs.
 */
export function getLocale(): Locale {
  return obsContext.getStore()?.locale ?? defaultLocale;
}
