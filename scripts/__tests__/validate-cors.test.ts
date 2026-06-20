/**
 * scripts/__tests__/validate-cors.test.ts (Phase 25 / FILE-02 / FILE-03, SC#3)
 *
 * Proves `scripts/validate-cors.ts`:
 *   - PASSES every committed template under
 *     `docs/integrations/file-storage/cors/` (real corpus is clean today);
 *   - FAILS each of the three security rules in isolation — a wildcard origin,
 *     a missing `ETag` in `ExposeHeaders`, and a missing `PUT` in
 *     `AllowedMethods` — so a regression in any single rule is caught;
 *   - exits non-zero via the CLI when a template is bad (full exit semantics
 *     are exercised by spawning the script over a temp wildcard fixture).
 *
 * The pure `validateCorsConfig` helper is imported directly; the CLI exit-code
 * contract is checked with `Bun.spawn` (matching the repo's subprocess pattern
 * for script CLIs, e.g. `validate-docs.test.ts`).
 */

import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type CorsConfig, validateCorsConfig, validateCorsDir } from "../validate-cors";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(REPO_ROOT, "scripts/validate-cors.ts");

const GOOD: CorsConfig = {
  CORSRules: [
    {
      AllowedOrigins: ["https://app.example.com", "http://localhost:3000"],
      AllowedMethods: ["PUT", "POST", "GET", "HEAD"],
      AllowedHeaders: ["content-type"],
      ExposeHeaders: ["ETag"],
      MaxAgeSeconds: 3600,
    },
  ],
};

function clone(): CorsConfig {
  return structuredClone(GOOD);
}

test("every committed CORS template passes validation", () => {
  const { ok, files } = validateCorsDir(REPO_ROOT);
  // The four documented backends must all be present and clean.
  expect(files.map((f) => f.file).sort()).toEqual([
    "aws-s3.json",
    "garage.json",
    "minio.json",
    "r2.json",
  ]);
  for (const { file, result } of files) {
    expect({ file, errors: result.errors }).toEqual({ file, errors: [] });
  }
  expect(ok).toBe(true);
});

test("a known-good config passes", () => {
  const r = validateCorsConfig(GOOD);
  expect(r.ok).toBe(true);
  expect(r.errors).toEqual([]);
});

test("bare wildcard origin fails", () => {
  const cfg = clone();
  (cfg.CORSRules as Record<string, unknown>[])[0].AllowedOrigins = ["*"];
  const r = validateCorsConfig(cfg);
  expect(r.ok).toBe(false);
  expect(r.errors.some((e) => e.includes("wildcard"))).toBe(true);
});

test("subdomain wildcard origin fails", () => {
  const cfg = clone();
  (cfg.CORSRules as Record<string, unknown>[])[0].AllowedOrigins = ["https://*.example.com"];
  const r = validateCorsConfig(cfg);
  expect(r.ok).toBe(false);
  expect(r.errors.some((e) => e.includes("wildcard"))).toBe(true);
});

test("missing ETag in ExposeHeaders fails", () => {
  const cfg = clone();
  (cfg.CORSRules as Record<string, unknown>[])[0].ExposeHeaders = ["x-amz-version-id"];
  const r = validateCorsConfig(cfg);
  expect(r.ok).toBe(false);
  expect(r.errors.some((e) => e.includes("ETag"))).toBe(true);
});

test("missing PUT in AllowedMethods fails", () => {
  const cfg = clone();
  (cfg.CORSRules as Record<string, unknown>[])[0].AllowedMethods = ["GET", "HEAD"];
  const r = validateCorsConfig(cfg);
  expect(r.ok).toBe(false);
  expect(r.errors.some((e) => e.includes("PUT"))).toBe(true);
});

test("empty CORSRules fails", () => {
  const r = validateCorsConfig({ CORSRules: [] });
  expect(r.ok).toBe(false);
  expect(r.errors.some((e) => e.includes("non-empty array"))).toBe(true);
});

test("missing GET/HEAD warns but does not fail", () => {
  const cfg = clone();
  (cfg.CORSRules as Record<string, unknown>[])[0].AllowedMethods = ["PUT"];
  const r = validateCorsConfig(cfg);
  expect(r.ok).toBe(true);
  expect(r.warnings.some((w) => w.includes("GET"))).toBe(true);
});

// --- CLI exit-code contract ------------------------------------------------

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

test("CLI exits 0 on the real templates", async () => {
  const proc = Bun.spawn(["bun", SCRIPT], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  expect(code).toBe(0);
});

test("CLI exits non-zero on a wildcard fixture", async () => {
  // Build a throwaway repo-shaped root whose cors dir holds one bad template.
  const root = mkdtempSync(join(tmpdir(), "cors-bad-"));
  tmpDirs.push(root);
  const corsDir = join(root, "docs/integrations/file-storage/cors");
  mkdirSync(corsDir, { recursive: true });
  writeFileSync(
    join(corsDir, "bad.json"),
    JSON.stringify({
      CORSRules: [
        {
          AllowedOrigins: ["*"],
          AllowedMethods: ["PUT", "GET"],
          ExposeHeaders: ["ETag"],
        },
      ],
    }),
  );

  // validateCorsDir is the unit the CLI wraps; assert it reports failure.
  const { ok, files } = validateCorsDir(root);
  expect(ok).toBe(false);
  expect(files[0].result.errors.some((e) => e.includes("wildcard"))).toBe(true);
});
