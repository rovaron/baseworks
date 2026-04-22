import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Phase 17 OBS-04 line-1 ordering gate (T-17-04).
 *
 * Bun does not honor NODE_OPTIONS=--require for OTEL module patching.
 * The ONLY way to attach auto-instrumentation is for `import "./telemetry";`
 * to load before any other import in the entrypoint. If a future PR moves
 * the import down by even one line — or wraps it with a comment that
 * pushes it to line 2 — every auto-instrumentation silently fails to
 * patch and the system runs un-instrumented forever, with NO error.
 *
 * This test is that PR's gate. Keep it green. Do not "improve" the
 * entrypoints by reordering imports.
 */

const EXPECTED_LINE_1 = 'import "./telemetry";';

function readEntrypoint(relativePath: string): string[] {
  const abs = resolve(process.cwd(), relativePath);
  return readFileSync(abs, "utf8").split(/\r?\n/);
}

describe("telemetry line-1 ordering (OBS-04 / T-17-04)", () => {
  test("apps/api/src/index.ts line 1 is the telemetry side-effect import", () => {
    const lines = readEntrypoint("apps/api/src/index.ts");
    expect(lines[0]).toBe(EXPECTED_LINE_1);
  });

  test("apps/api/src/worker.ts line 1 is the telemetry side-effect import", () => {
    const lines = readEntrypoint("apps/api/src/worker.ts");
    expect(lines[0]).toBe(EXPECTED_LINE_1);
  });

  test("no leading blank line or comment in apps/api/src/index.ts", () => {
    const lines = readEntrypoint("apps/api/src/index.ts");
    // Defensive: even if line 0 happens to be the import, catch the
    // accidental UTF-8 BOM or invisible whitespace prefix.
    expect(lines[0]).not.toMatch(/^\s+/);
    expect(lines[0]).not.toMatch(/^\/\//);
    expect(lines[0]).not.toMatch(/^\/\*/);
    expect(lines[0].length).toBeGreaterThan(0);
  });

  test("no leading blank line or comment in apps/api/src/worker.ts", () => {
    const lines = readEntrypoint("apps/api/src/worker.ts");
    expect(lines[0]).not.toMatch(/^\s+/);
    expect(lines[0]).not.toMatch(/^\/\//);
    expect(lines[0]).not.toMatch(/^\/\*/);
    expect(lines[0].length).toBeGreaterThan(0);
  });

  test("telemetry import in index.ts is a side-effect import (no `from` clause)", () => {
    const lines = readEntrypoint("apps/api/src/index.ts");
    // A side-effect import has no binding — `import "./x";`. A regression
    // like `import { foo } from "./telemetry";` would still leave line 1
    // looking import-shaped but break the side-effect contract.
    expect(lines[0]).not.toContain("from");
    expect(lines[0]).toContain('"./telemetry"');
  });

  test("telemetry import in worker.ts is a side-effect import (no `from` clause)", () => {
    const lines = readEntrypoint("apps/api/src/worker.ts");
    expect(lines[0]).not.toContain("from");
    expect(lines[0]).toContain('"./telemetry"');
  });
});
