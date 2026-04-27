import { describe, expect, test } from "bun:test";

/**
 * Phase 22 / D-02 + D-13 — env-validation tests for BULL_BOARD_READ_ONLY and
 * WORKER_HEARTBEAT_INTERVAL_MS.
 *
 * Pattern: spawn a fresh Bun subprocess per case so `createEnv()` re-runs
 * against the supplied process.env. Mirrors the existing
 * packages/config/src/__tests__/env.test.ts approach (createEnv evaluates
 * once at import time; in-process module re-import does not reliably
 * re-evaluate t3-oss/env-core schemas inside a single Bun test runner).
 */

const BASE_ENV: Record<string, string | undefined> = {
  HOME: process.env.HOME,
  PATH: process.env.PATH,
  DATABASE_URL: "postgres://user:pass@localhost:5432/testdb",
  NODE_ENV: "test",
  BETTER_AUTH_SECRET: "a".repeat(32),
};

async function spawnEnv(
  overrides: Record<string, string | undefined>,
  exprToPrint: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...BASE_ENV, ...overrides })) {
    if (v !== undefined) env[k] = v;
  }
  const proc = Bun.spawn(
    [
      "bun",
      "-e",
      `import { env } from "@baseworks/config"; console.log(${exprToPrint});`,
    ],
    {
      env,
      stdout: "pipe",
      stderr: "pipe",
      cwd: import.meta.dir + "/../../../..",
    },
  );
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode, stdout, stderr };
}

describe("BULL_BOARD_READ_ONLY env validation (Phase 22 / D-02)", () => {
  test("accepts \"true\"", async () => {
    const { exitCode, stdout } = await spawnEnv(
      { BULL_BOARD_READ_ONLY: "true" },
      'env.BULL_BOARD_READ_ONLY',
    );
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("true");
  });

  test("accepts \"false\"", async () => {
    const { exitCode, stdout } = await spawnEnv(
      { BULL_BOARD_READ_ONLY: "false" },
      'env.BULL_BOARD_READ_ONLY',
    );
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("false");
  });

  test("rejects typo \"yes\" (crash-hard at boot)", async () => {
    const { exitCode } = await spawnEnv(
      { BULL_BOARD_READ_ONLY: "yes" },
      'env.BULL_BOARD_READ_ONLY',
    );
    expect(exitCode).not.toBe(0);
  });

  test("defaults to \"true\" when unset", async () => {
    const { exitCode, stdout } = await spawnEnv(
      { BULL_BOARD_READ_ONLY: undefined },
      'env.BULL_BOARD_READ_ONLY',
    );
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("true");
  });
});

describe("WORKER_HEARTBEAT_INTERVAL_MS env validation (Phase 22 / D-13)", () => {
  test("accepts \"15000\" and coerces to number", async () => {
    const { exitCode, stdout } = await spawnEnv(
      { WORKER_HEARTBEAT_INTERVAL_MS: "15000" },
      'JSON.stringify({ v: env.WORKER_HEARTBEAT_INTERVAL_MS, t: typeof env.WORKER_HEARTBEAT_INTERVAL_MS })',
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.v).toBe(15000);
    expect(parsed.t).toBe("number");
  });

  test("rejects below min (\"500\")", async () => {
    const { exitCode } = await spawnEnv(
      { WORKER_HEARTBEAT_INTERVAL_MS: "500" },
      'env.WORKER_HEARTBEAT_INTERVAL_MS',
    );
    expect(exitCode).not.toBe(0);
  });

  test("rejects above max (\"500000\")", async () => {
    const { exitCode } = await spawnEnv(
      { WORKER_HEARTBEAT_INTERVAL_MS: "500000" },
      'env.WORKER_HEARTBEAT_INTERVAL_MS',
    );
    expect(exitCode).not.toBe(0);
  });

  test("defaults to 15000 when unset", async () => {
    const { exitCode, stdout } = await spawnEnv(
      { WORKER_HEARTBEAT_INTERVAL_MS: undefined },
      'env.WORKER_HEARTBEAT_INTERVAL_MS',
    );
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("15000");
  });
});
