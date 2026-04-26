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

  /**
   * Phase 20.1 D-16 / H-01 — malformed cookie hardening.
   *
   * 19-REVIEW.md H-01: a crafted `NEXT_LOCALE=%ZZ` cookie throws URIError
   * inside `decodeURIComponent` BEFORE `obsContext.run` opens, losing the
   * request frame and producing a context-less 500. The fix wraps the
   * decode in try/catch so the parser falls through to `null` and the
   * caller (apps/api/src/index.ts) selects `defaultLocale`.
   */
  describe("D-16 / H-01 malformed-cookie hardening", () => {
    test("malformed cookie value (stray %ZZ) returns null instead of throwing", () => {
      expect(() => parseNextLocaleCookie("NEXT_LOCALE=%ZZ")).not.toThrow();
      expect(parseNextLocaleCookie("NEXT_LOCALE=%ZZ")).toBeNull();
    });

    test("unpaired % returns null instead of throwing", () => {
      expect(() => parseNextLocaleCookie("NEXT_LOCALE=foo%")).not.toThrow();
      expect(parseNextLocaleCookie("NEXT_LOCALE=foo%")).toBeNull();
    });

    test("malformed cookie embedded among valid cookies returns null instead of throwing", () => {
      expect(() =>
        parseNextLocaleCookie("foo=bar; NEXT_LOCALE=%E0%A4; other=x"),
      ).not.toThrow();
      expect(
        parseNextLocaleCookie("foo=bar; NEXT_LOCALE=%E0%A4; other=x"),
      ).toBeNull();
    });
  });
});
