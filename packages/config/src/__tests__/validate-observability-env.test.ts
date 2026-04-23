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

describe("validateObservabilityEnv ERROR_TRACKER crash-hard (Phase 18 / D-09)", () => {
  test("throws when ERROR_TRACKER=sentry without SENTRY_DSN in production", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { validateObservabilityEnv } from "@baseworks/config"; validateObservabilityEnv(); console.log("OK")',
      ],
      {
        env: {
          ...baseEnv,
          NODE_ENV: "production",
          ERROR_TRACKER: "sentry",
          // No SENTRY_DSN
        },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("SENTRY_DSN is required when ERROR_TRACKER=sentry");
  });

  test("throws when ERROR_TRACKER=glitchtip without GLITCHTIP_DSN in production", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { validateObservabilityEnv } from "@baseworks/config"; validateObservabilityEnv(); console.log("OK")',
      ],
      {
        env: {
          ...baseEnv,
          NODE_ENV: "production",
          ERROR_TRACKER: "glitchtip",
          // No GLITCHTIP_DSN
        },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain(
      "GLITCHTIP_DSN is required when ERROR_TRACKER=glitchtip",
    );
  });

  test("does not throw when ERROR_TRACKER=pino (no required env)", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { validateObservabilityEnv } from "@baseworks/config"; validateObservabilityEnv(); console.log("OK")',
      ],
      {
        env: {
          ...baseEnv,
          NODE_ENV: "production",
          ERROR_TRACKER: "pino",
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

  test("does not throw when ERROR_TRACKER=noop (existing behavior preserved)", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { validateObservabilityEnv } from "@baseworks/config"; validateObservabilityEnv(); console.log("OK")',
      ],
      {
        env: {
          ...baseEnv,
          NODE_ENV: "production",
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

  test("warns but does not throw when ERROR_TRACKER=sentry missing DSN in NODE_ENV=test", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { validateObservabilityEnv } from "@baseworks/config"; validateObservabilityEnv(); console.log("OK")',
      ],
      {
        env: {
          ...baseEnv,
          NODE_ENV: "test",
          ERROR_TRACKER: "sentry",
          // No SENTRY_DSN
        },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toContain("OK");
    expect(stderr).toContain("[env] WARNING: SENTRY_DSN is not set");
  });

  test("warns but does not throw when ERROR_TRACKER=glitchtip missing DSN in NODE_ENV=test", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { validateObservabilityEnv } from "@baseworks/config"; validateObservabilityEnv(); console.log("OK")',
      ],
      {
        env: {
          ...baseEnv,
          NODE_ENV: "test",
          ERROR_TRACKER: "glitchtip",
          // No GLITCHTIP_DSN
        },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toContain("OK");
    expect(stderr).toContain("[env] WARNING: GLITCHTIP_DSN is not set");
  });

  test("does not throw when ERROR_TRACKER=sentry with SENTRY_DSN set in production", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { validateObservabilityEnv } from "@baseworks/config"; validateObservabilityEnv(); console.log("OK")',
      ],
      {
        env: {
          ...baseEnv,
          NODE_ENV: "production",
          ERROR_TRACKER: "sentry",
          SENTRY_DSN: "https://public@sentry.example.com/1",
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
});

describe("ERROR_TRACKER enum widening (Phase 18 / D-06)", () => {
  test("accepts ERROR_TRACKER=pino", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { env } from "@baseworks/config"; console.log(env.ERROR_TRACKER)',
      ],
      {
        env: { ...baseEnv, ERROR_TRACKER: "pino" },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("pino");
  });

  test("accepts ERROR_TRACKER=sentry", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { env } from "@baseworks/config"; console.log(env.ERROR_TRACKER)',
      ],
      {
        env: { ...baseEnv, ERROR_TRACKER: "sentry" },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("sentry");
  });

  test("accepts ERROR_TRACKER=glitchtip", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { env } from "@baseworks/config"; console.log(env.ERROR_TRACKER)',
      ],
      {
        env: { ...baseEnv, ERROR_TRACKER: "glitchtip" },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("glitchtip");
  });

  test("rejects ERROR_TRACKER=bogus with Zod enum error", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { env } from "@baseworks/config"; console.log(env.ERROR_TRACKER)',
      ],
      {
        env: { ...baseEnv, ERROR_TRACKER: "bogus" },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    expect(exitCode).not.toBe(0);
  });

  test("defaults ERROR_TRACKER to 'pino' when unset (Phase 18 widens Phase 17 'noop' default)", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { env } from "@baseworks/config"; console.log(env.ERROR_TRACKER)',
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
    expect(stdout.trim()).toBe("pino");
  });
});

describe("New Phase 18 env fields (D-09)", () => {
  test("SENTRY_DSN accepts a valid URL", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { env } from "@baseworks/config"; console.log(env.SENTRY_DSN)',
      ],
      {
        env: { ...baseEnv, SENTRY_DSN: "https://public@sentry.example.com/1" },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("https://public@sentry.example.com/1");
  });

  test("SENTRY_DSN rejects non-URL strings", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { env } from "@baseworks/config"; console.log(env.SENTRY_DSN)',
      ],
      {
        env: { ...baseEnv, SENTRY_DSN: "not-a-url" },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    expect(exitCode).not.toBe(0);
  });

  test("GLITCHTIP_DSN accepts a valid URL", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { env } from "@baseworks/config"; console.log(env.GLITCHTIP_DSN)',
      ],
      {
        env: {
          ...baseEnv,
          GLITCHTIP_DSN: "https://public@glitchtip.example.com/1",
        },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("https://public@glitchtip.example.com/1");
  });

  test("GLITCHTIP_DSN rejects non-URL strings", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { env } from "@baseworks/config"; console.log(env.GLITCHTIP_DSN)',
      ],
      {
        env: { ...baseEnv, GLITCHTIP_DSN: "not-a-url" },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    expect(exitCode).not.toBe(0);
  });

  test("RELEASE is an optional string (undefined when unset)", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { env } from "@baseworks/config"; console.log(String(env.RELEASE))',
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
    expect(stdout.trim()).toBe("undefined");
  });

  test("RELEASE accepts a short git SHA", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { env } from "@baseworks/config"; console.log(env.RELEASE)',
      ],
      {
        env: { ...baseEnv, RELEASE: "abc1234" },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("abc1234");
  });

  test("SENTRY_ENVIRONMENT is an optional string (undefined when unset)", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { env } from "@baseworks/config"; console.log(String(env.SENTRY_ENVIRONMENT))',
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
    expect(stdout.trim()).toBe("undefined");
  });

  test("OBS_PII_DENY_EXTRA_KEYS is an optional string (undefined when unset)", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { env } from "@baseworks/config"; console.log(String(env.OBS_PII_DENY_EXTRA_KEYS))',
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
    expect(stdout.trim()).toBe("undefined");
  });

  test("OBS_PII_DENY_EXTRA_KEYS accepts a comma-separated string", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { env } from "@baseworks/config"; console.log(env.OBS_PII_DENY_EXTRA_KEYS)',
      ],
      {
        env: { ...baseEnv, OBS_PII_DENY_EXTRA_KEYS: "ssn,dob,phone" },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("ssn,dob,phone");
  });
});
