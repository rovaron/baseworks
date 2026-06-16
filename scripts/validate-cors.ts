#!/usr/bin/env bun
/**
 * scripts/validate-cors.ts (Phase 25 / FILE-02 / FILE-03, contract §4 / SC#3)
 *
 * Validates the committed bucket-CORS templates under
 * `docs/integrations/file-storage/cors/*.json` against the storage milestone's
 * security rules. The presigned-upload flow (Phase 26) needs the browser to
 * PUT directly to the bucket and read back the `ETag` for integrity checks, so
 * every template MUST:
 *   - carry NO wildcard `AllowedOrigins` (Pitfall: a `"*"` origin lets any site
 *     drive authenticated presigned PUTs/GETs — reject any entry containing the
 *     character `"*"`, which also rejects `"*.example.com"` forms);
 *   - expose `ETag` in `ExposeHeaders` (case-insensitive) so the client can read
 *     the upload's ETag;
 *   - allow `PUT` in `AllowedMethods` (the presigned upload verb). Absent
 *     `GET`/`HEAD` is a non-fatal warning.
 *
 * `validateCorsConfig(json)` is a pure function (exported for unit tests). The
 * CLI `main()` loads every template, prints a per-file PASS/FAIL line, and exits
 * non-zero with a clear message on any violation so it can gate CI
 * (`bun run validate-cors`). The validator owns no filesystem or process state.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** AWS S3 `{ CORSRules: [...] }` shape (R2/MinIO/Garage all accept it). */
export interface CorsRule {
  AllowedOrigins?: unknown;
  AllowedMethods?: unknown;
  AllowedHeaders?: unknown;
  ExposeHeaders?: unknown;
  MaxAgeSeconds?: unknown;
}

export interface CorsConfig {
  CORSRules?: unknown;
}

export interface CorsValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Validate a parsed CORS config object against the SC#3 rules. Pure: no I/O.
 * Each violation appends to `errors`; `ok === (errors.length === 0)`.
 */
export function validateCorsConfig(config: CorsConfig): CorsValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const rules = config.CORSRules;
  if (!Array.isArray(rules) || rules.length === 0) {
    errors.push("CORSRules must be a non-empty array");
    return { ok: false, errors, warnings };
  }

  rules.forEach((rule: CorsRule, i) => {
    const at = `CORSRules[${i}]`;

    // --- AllowedOrigins: present, non-empty, NO wildcard ---
    if (!isStringArray(rule.AllowedOrigins) || rule.AllowedOrigins.length === 0) {
      errors.push(`${at}.AllowedOrigins must be a non-empty string array`);
    } else {
      for (const origin of rule.AllowedOrigins) {
        if (origin.includes("*")) {
          errors.push(
            `${at}.AllowedOrigins contains a wildcard origin "${origin}" — use a concrete origin (e.g. https://app.example.com)`,
          );
        }
      }
    }

    // --- AllowedMethods: present, non-empty, includes PUT (GET/HEAD warn) ---
    if (!isStringArray(rule.AllowedMethods) || rule.AllowedMethods.length === 0) {
      errors.push(`${at}.AllowedMethods must be a non-empty string array`);
    } else {
      const methods = rule.AllowedMethods.map((m) => m.toUpperCase());
      if (!methods.includes("PUT")) {
        errors.push(`${at}.AllowedMethods must include "PUT" (presigned upload verb)`);
      }
      if (!methods.includes("GET") && !methods.includes("HEAD")) {
        warnings.push(
          `${at}.AllowedMethods has neither "GET" nor "HEAD" (presigned reads will fail)`,
        );
      }
    }

    // --- ExposeHeaders: present, non-empty, includes ETag (case-insensitive) ---
    if (!isStringArray(rule.ExposeHeaders) || rule.ExposeHeaders.length === 0) {
      errors.push(`${at}.ExposeHeaders must be a non-empty string array`);
    } else if (!rule.ExposeHeaders.some((h) => h.toLowerCase() === "etag")) {
      errors.push(`${at}.ExposeHeaders must include "ETag"`);
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}

const CORS_DIR_REL = "docs/integrations/file-storage/cors";

/**
 * Load + validate every `*.json` template under
 * `docs/integrations/file-storage/cors`. Returns per-file results; pure apart
 * from the directory read it is given (root is injectable for tests).
 */
export function validateCorsDir(root: string): {
  ok: boolean;
  files: { file: string; result: CorsValidationResult }[];
} {
  const dir = join(root, CORS_DIR_REL);
  const jsonFiles = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const files = jsonFiles.map((file) => {
    let result: CorsValidationResult;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), "utf8")) as CorsConfig;
      result = validateCorsConfig(parsed);
    } catch (err) {
      result = {
        ok: false,
        errors: [`failed to parse JSON: ${(err as Error).message}`],
        warnings: [],
      };
    }
    return { file, result };
  });

  if (files.length === 0) {
    return {
      ok: false,
      files: [
        {
          file: CORS_DIR_REL,
          result: { ok: false, errors: ["no *.json CORS templates found"], warnings: [] },
        },
      ],
    };
  }

  return { ok: files.every((f) => f.result.ok), files };
}

function main(): void {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const { ok, files } = validateCorsDir(root);

  for (const { file, result } of files) {
    if (result.ok) {
      console.log(`PASS  ${file}`);
    } else {
      console.error(`FAIL  ${file}`);
      for (const e of result.errors) console.error(`        error: ${e}`);
    }
    for (const w of result.warnings) console.warn(`        warn:  ${w}`);
  }

  if (!ok) {
    console.error("\nCORS validation FAILED — fix the templates above before merging.");
    process.exit(1);
  }
  console.log(`\nCORS validation passed (${files.length} template(s)).`);
}

// Run only when invoked as a CLI, not when imported by the test file.
if (import.meta.main) {
  main();
}
