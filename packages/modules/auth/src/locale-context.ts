import { AsyncLocalStorage } from "node:async_hooks";
import { Elysia } from "elysia";
import { defaultLocale, locales, type Locale } from "@baseworks/i18n";

/**
 * Request-scoped locale store.
 *
 * Per Phase 12 D-02: better-auth's plugin config is intentionally left
 * untouched. Instead, an Elysia middleware captures the request locale
 * into AsyncLocalStorage so `sendInvitationEmail` — which runs inside
 * better-auth's mounted handler — can read it via `getLocale()` without
 * any prop-drilling or plugin surgery.
 *
 * Resolution order:
 *   1. NEXT_LOCALE cookie (set by next-intl middleware in apps/web)
 *   2. defaultLocale from @baseworks/i18n (currently "en")
 *
 * Full RFC 9110 Accept-Language q-value parsing is deferred per
 * CONTEXT.md Deferred Ideas.
 */
interface LocaleStore {
  locale: Locale;
}

const localeStorage = new AsyncLocalStorage<LocaleStore>();

/**
 * Read the current request's locale from AsyncLocalStorage.
 *
 * Returns `defaultLocale` if called outside any request — e.g. from a
 * BullMQ worker process, a migration script, or any other non-HTTP
 * entry point. This matches Phase 12 D-03 fallback behavior.
 */
export function getLocale(): Locale {
  return localeStorage.getStore()?.locale ?? defaultLocale;
}

/**
 * Parse the NEXT_LOCALE cookie from a raw Cookie header value.
 * Returns null if the cookie is absent or holds an unsupported locale.
 */
function parseNextLocaleCookie(cookieHeader: string | null): Locale | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
  if (!match) return null;
  const value = decodeURIComponent(match[1]);
  return (locales as readonly string[]).includes(value)
    ? (value as Locale)
    : null;
}

/**
 * Elysia middleware that captures the request locale into AsyncLocalStorage.
 *
 * Uses `.onRequest` + `enterWith` so downstream handlers (including
 * better-auth's mounted handler via `.mount(auth.handler)` in
 * packages/modules/auth/src/routes.ts:41) see the locale transparently.
 *
 * Mount this plugin on the OUTERMOST Elysia layer in apps/api/src/index.ts
 * before `.use(authRoutes)`. See Phase 12 plan 03 Task 3 for wiring.
 */
export const localeMiddleware = new Elysia({ name: "locale-context" }).onRequest(
  ({ request }) => {
    const cookieHeader = request.headers.get("cookie");
    const locale = parseNextLocaleCookie(cookieHeader) ?? defaultLocale;
    localeStorage.enterWith({ locale });
  },
);
