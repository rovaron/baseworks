/**
 * scripts/__tests__/i18n-files-icu.test.ts (Phase 29 / IDA-UI ICU regression)
 *
 * Guards the `files` namespace `uploading` message against an ICU MessageFormat
 * regression: next-intl (intl-messageformat) parses a bare `{percent}` as a
 * named argument. `buildFileUploadLabels` calls t("uploading") with NO values,
 * so a bare token throws MISSING_FORMAT_VALUE and next-intl falls back to the
 * key — the component's `.replace("{percent}", …)` then has nothing to replace
 * and the live progress label breaks in the real app.
 *
 * The token is therefore ICU-escaped with single quotes ('{percent}') so it
 * renders as the LITERAL string `{percent}`, which the <FileUpload> component
 * interpolates client-side. This test asserts every locale keeps that escaping.
 */
import { describe, expect, it } from "bun:test";

import enFiles from "../../packages/i18n/src/locales/en/files.json";
import ptFiles from "../../packages/i18n/src/locales/pt-BR/files.json";

const LOCALES: Array<[string, { uploading: string }]> = [
  ["en", enFiles],
  ["pt-BR", ptFiles],
];

describe("i18n files namespace — uploading ICU escaping", () => {
  for (const [locale, msgs] of LOCALES) {
    it(`${locale}: escapes {percent} so it survives a no-values render`, () => {
      // ICU single-quote escaping → the source must contain the literal '{percent}'.
      expect(msgs.uploading).toContain("'{percent}'");
      // After ICU unescaping the component receives a bare {percent} token to replace.
      const unescaped = msgs.uploading.replace(/'\{percent\}'/g, "{percent}");
      expect(unescaped).toContain("{percent}");
      expect(unescaped.replace("{percent}", "42")).toContain("42%");
    });
  }
});
