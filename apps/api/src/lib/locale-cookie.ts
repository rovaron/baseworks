import { defaultLocale, locales, type Locale } from "@baseworks/i18n";

/**
 * Parse the NEXT_LOCALE cookie from a raw Cookie header value.
 * Returns null if the cookie is absent or holds an unsupported locale.
 *
 * Phase 19 D-12 — called from the Bun.serve fetch wrapper in
 * apps/api/src/index.ts (Plan 06) once per request, before the Elysia
 * pipeline runs. Replaces the Phase 12 localeMiddleware Elysia plugin that
 * was removed in Plan 01.
 *
 * Relocation rationale (D-12): the previous owner at
 * `packages/modules/auth/src/locale-context.ts` performed the parse inside
 * an Elysia plugin that used the now-banned AsyncLocalStorage mutator
 * (CTX-01). Moving the parser to apps/api collapses the parse + seed path
 * into a single outermost async boundary while keeping the module-auth
 * package free of any HTTP-layer concerns.
 */
export function parseNextLocaleCookie(
  cookieHeader: string | null,
): Locale | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
  if (!match) return null;
  const value = decodeURIComponent(match[1]);
  return (locales as readonly string[]).includes(value)
    ? (value as Locale)
    : null;
}

export { defaultLocale };
