import { describe, test, expect } from "bun:test";

/**
 * Phase 17 OBS-04 smoke test (D-10).
 * Spawns telemetry.ts under a real bun subprocess so line-1 ordering and
 * NodeSDK programmatic init are exercised end-to-end. Catches regressions
 * that package-level unit tests cannot — specifically: instrumentation
 * patching that silently fails when import order is wrong, AND env-typo
 * silent fallback (T-17-01, Issue 4 negative-path coverage).
 */

type SpawnResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

async function spawnTelemetry(
  extraEnv: Record<string, string>,
): Promise<SpawnResult> {
  const proc = Bun.spawn(["bun", "run", "apps/api/src/telemetry.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      // Required by @baseworks/config core schema (not Phase 17 surface but
      // loaded transitively by validateObservabilityEnv's env import). Use
      // test-safe values so the subprocess reaches the observability branch.
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://baseworks:baseworks@localhost:5432/baseworks",
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ??
        "testtesttesttesttesttesttesttest",
      NODE_ENV: "test",
      LOG_LEVEL: "info",
      // Caller may override INSTANCE_ROLE / TRACER / etc.
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeout = setTimeout(() => proc.kill(), 5000);
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  clearTimeout(timeout);

  return { stdout, stderr, exitCode };
}

describe("telemetry boot smoke test (OBS-04 / D-10)", () => {
  test("api role: exits 0 and prints otel-selftest: ok", async () => {
    const { stdout, exitCode } = await spawnTelemetry({
      INSTANCE_ROLE: "api",
    });
    expect(stdout).toContain("otel-selftest: ok");
    expect(stdout).toContain("instrumentations-loaded:");
    expect(exitCode).toBe(0);
  }, 10_000);

  test("worker role: exits 0 and prints otel-selftest: ok", async () => {
    const { stdout, exitCode } = await spawnTelemetry({
      INSTANCE_ROLE: "worker",
    });
    expect(stdout).toContain("otel-selftest: ok");
    expect(stdout).toContain("instrumentations-loaded:");
    expect(exitCode).toBe(0);
  }, 10_000);

  test("noop egress (T-17-03): stderr is clean of exporter errors with default env", async () => {
    const { stderr, exitCode } = await spawnTelemetry({
      INSTANCE_ROLE: "api",
    });
    const forbiddenStderrTokens = [
      "ECONNREFUSED",
      "ENOTFOUND",
      "localhost:4318",
      "localhost:4317",
      "OTLPTraceExporter",
      "OTLPMetricExporter",
    ];
    for (const token of forbiddenStderrTokens) {
      expect(stderr).not.toContain(token);
    }
    expect(exitCode).toBe(0);
  }, 10_000);

  // Issue 4 / T-17-01 end-to-end: unknown adapter value crashes the process
  // BEFORE any acceptance string reaches stdout. Plan 03's z.enum(["noop"])
  // makes Zod reject TRACER=otel at env-import time; the error message
  // identifies the offending key ("TRACER") and the allowed value ("noop").
  test("unknown adapter rejection (T-17-01 / Issue 4): TRACER=otel crashes non-zero before selftest", async () => {
    const { stdout, stderr, exitCode } = await spawnTelemetry({
      INSTANCE_ROLE: "api",
      TRACER: "otel",
    });
    // Must crash non-zero (D-09 crash-hard).
    expect(exitCode).not.toBe(0);
    // Zod error names the offending key.
    expect(stderr).toContain("TRACER");
    // Zod error lists the allowed enum value(s) — Phase 17 only supports "noop".
    expect(stderr).toContain("noop");
    // Validation runs BEFORE the selftest log (Issue 3 strict ordering).
    expect(stdout).not.toContain("otel-selftest: ok");
  }, 10_000);
});
