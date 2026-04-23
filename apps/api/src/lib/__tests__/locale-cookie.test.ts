import { describe, test, expect } from "bun:test";
import { parseNextLocaleCookie } from "../locale-cookie";

/**
 * Unit tests for parseNextLocaleCookie (Phase 19 / D-12).
 *
 * Mirrors the original implementation that lived in
 * `packages/modules/auth/src/locale-context.ts` (deleted in Plan 01) —
 * now relocated to the apps/api boundary so Plan 06's Bun.serve fetch
 * wrapper can call it once per request before the Elysia pipeline runs.
 */
describe("parseNextLocaleCookie", () => {
  test("returns null for a null cookie header", () => {
    expect(parseNextLocaleCookie(null)).toBeNull();
  });

  test("returns null for an empty cookie header", () => {
    expect(parseNextLocaleCookie("")).toBeNull();
  });

  test("extracts NEXT_LOCALE=en from a mixed cookie header", () => {
    expect(
      parseNextLocaleCookie("foo=bar; NEXT_LOCALE=en; other=x"),
    ).toBe("en");
  });

  test("extracts NEXT_LOCALE=pt-BR as the sole cookie", () => {
    expect(parseNextLocaleCookie("NEXT_LOCALE=pt-BR")).toBe("pt-BR");
  });

  test("returns null for an unknown locale value", () => {
    expect(parseNextLocaleCookie("NEXT_LOCALE=xyzzy")).toBeNull();
  });

  test("applies decodeURIComponent — URL-encoded pt-BR resolves to pt-BR", () => {
    // "pt-BR" is in locales; "pt%2DBR" is the URL-encoded form (hyphen is
    // encoded as %2D). decodeURIComponent must be applied so the allow-list
    // check sees the canonical value.
    expect(parseNextLocaleCookie("NEXT_LOCALE=pt%2DBR")).toBe("pt-BR");
  });
});
