import { describe, test, expect } from "bun:test";

/**
 * OBS-04 / D-07 / D-09 — positive-path tests for validateObservabilityEnv().
 *
 * Like the sibling validatePaymentProviderEnv tests in env.test.ts, these run
 * in subprocesses because @t3-oss/env-core evaluates its schema at module-import
 * time. Mutating process.env after the fact has no effect on `env.TRACER`.
 *
 * This file deliberately covers positive cases only. The negative path —
 * TRACER=otel or ERROR_TRACKER=sentry rejected by Zod at env-import time —
 * is exercised end-to-end by Plan 04's telemetry-boot smoke test
 * (17-VALIDATION.md row 17-04-05, threat T-17-01). Putting negative cases
 * here would require the same subprocess machinery and would duplicate
 * Plan 04's coverage of the exact same seam.
 */

const baseEnv = {
  HOME: process.env.HOME,
  PATH: process.env.PATH,
  DATABASE_URL: "postgres://user:pass@localhost:5432/testdb",
  BETTER_AUTH_SECRET: "a".repeat(32),
  NODE_ENV: "test",
};

describe("validateObservabilityEnv (OBS-04 / D-07 / D-09)", () => {
  test("does not throw when TRACER/METRICS_PROVIDER/ERROR_TRACKER are unset (defaults to noop)", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { validateObservabilityEnv } from "@baseworks/config"; validateObservabilityEnv(); console.log("OK")',
      ],
      {
        env: { ...baseEnv },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toContain("OK");
  });

  test("does not throw when all three are explicitly 'noop'", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { validateObservabilityEnv } from "@baseworks/config"; validateObservabilityEnv(); console.log("OK")',
      ],
      {
        env: {
          ...baseEnv,
          TRACER: "noop",
          METRICS_PROVIDER: "noop",
          ERROR_TRACKER: "noop",
        },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toContain("OK");
  });

  test("is exported as a named export from @baseworks/config", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { validateObservabilityEnv } from "@baseworks/config"; console.log(typeof validateObservabilityEnv)',
      ],
      {
        env: { ...baseEnv },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("function");
  });

  // Negative env-typo cases — these need a subprocess AND are covered end-to-end
  // by Plan 04's telemetry-boot smoke test (17-VALIDATION.md row 17-04-05,
  // threat T-17-01). The Zod enum rejection happens at env-import time,
  // before validateObservabilityEnv() can even be called, so the negative
  // path is conceptually a different test: "does TRACER=otel crash the boot
  // process?" — which is the boot smoke test's job, not this file's.
});
