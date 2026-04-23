import { describe, test, expect } from "bun:test";

describe("env validation", () => {
  test("crashes when DATABASE_URL is missing", async () => {
    // Spawn a subprocess with stripped env to test crash behavior
    const proc = Bun.spawn(
      ["bun", "-e", 'import { env } from "@baseworks/config"; console.log(env.DATABASE_URL)'],
      {
        env: {
          // Provide minimal env WITHOUT DATABASE_URL
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          NODE_ENV: "test",
        },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    expect(exitCode).not.toBe(0);
  });

  test("succeeds with valid environment variables", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { env } from "@baseworks/config"; console.log(JSON.stringify({ url: typeof env.DATABASE_URL, port: typeof env.PORT, nodeEnv: env.NODE_ENV }))',
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: "postgres://user:pass@localhost:5432/testdb",
          NODE_ENV: "test",
          PORT: "4000",
        },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout.trim());
    expect(result.url).toBe("string");
    expect(result.port).toBe("number");
    expect(result.nodeEnv).toBe("test");
  });
});

describe("validatePaymentProviderEnv", () => {
  const baseEnv = {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    DATABASE_URL: "postgres://user:pass@localhost:5432/testdb",
    BETTER_AUTH_SECRET: "a".repeat(32),
  };

  test("throws when PAYMENT_PROVIDER=pagarme without PAGARME_SECRET_KEY in non-test NODE_ENV", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { validatePaymentProviderEnv } from "@baseworks/config"; validatePaymentProviderEnv(); console.log("OK")',
      ],
      {
        env: {
          ...baseEnv,
          NODE_ENV: "development",
          PAYMENT_PROVIDER: "pagarme",
          // No PAGARME_SECRET_KEY
        },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("PAGARME_SECRET_KEY");
  });

  test("throws when PAYMENT_PROVIDER=stripe without STRIPE_SECRET_KEY in non-test NODE_ENV", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { validatePaymentProviderEnv } from "@baseworks/config"; validatePaymentProviderEnv(); console.log("OK")',
      ],
      {
        env: {
          ...baseEnv,
          NODE_ENV: "development",
          PAYMENT_PROVIDER: "stripe",
          // No STRIPE_SECRET_KEY
        },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("STRIPE_SECRET_KEY");
  });

  test("warns but does not throw in test NODE_ENV when keys are missing", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { validatePaymentProviderEnv } from "@baseworks/config"; validatePaymentProviderEnv(); console.log("OK")',
      ],
      {
        env: {
          ...baseEnv,
          NODE_ENV: "test",
          PAYMENT_PROVIDER: "pagarme",
          // No PAGARME_SECRET_KEY -- should warn, not throw
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

  test("passes when all required stripe keys present", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { validatePaymentProviderEnv } from "@baseworks/config"; validatePaymentProviderEnv(); console.log("OK")',
      ],
      {
        env: {
          ...baseEnv,
          NODE_ENV: "development",
          PAYMENT_PROVIDER: "stripe",
          STRIPE_SECRET_KEY: "sk_test_123",
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

describe("validateObservabilityEnv — CIDR trust policy (Phase 19 / D-07 / D-08)", () => {
  const baseEnv = {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    DATABASE_URL: "postgres://user:pass@localhost:5432/testdb",
    BETTER_AUTH_SECRET: "a".repeat(32),
  };

  test("Test 1: default unset is valid (never-trust default, D-07)", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { validateObservabilityEnv } from "@baseworks/config"; validateObservabilityEnv(); console.log("OK")',
      ],
      {
        env: { ...baseEnv, NODE_ENV: "production" },
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

  test("Test 2: valid IPv4 CIDR list returns silently", async () => {
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
          OBS_TRUST_TRACEPARENT_FROM: "10.0.0.0/8,172.16.0.0/12",
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

  test("Test 3: valid IPv6 CIDR returns silently", async () => {
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
          OBS_TRUST_TRACEPARENT_FROM: "::1/128,fd00::/8",
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

  test("Test 4: mixed IPv4 + IPv6 CIDR returns silently", async () => {
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
          OBS_TRUST_TRACEPARENT_FROM: "10.0.0.0/8,fd00::/8",
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

  test("Test 5: malformed CIDR (10.0/8) crashes hard in production with actionable message", async () => {
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
          OBS_TRUST_TRACEPARENT_FROM: "10.0/8",
        },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("OBS_TRUST_TRACEPARENT_FROM");
    expect(stderr).toContain("10.0/8");
  });

  test("Test 6: whitespace around commas is tolerated", async () => {
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
          OBS_TRUST_TRACEPARENT_FROM: " 10.0.0.0/8 , 172.16.0.0/12 ",
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

  test("Test 7: empty entries (trailing commas) are filtered out", async () => {
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
          OBS_TRUST_TRACEPARENT_FROM: "10.0.0.0/8,,",
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

  test("Test 8: OBS_TRUST_TRACEPARENT_HEADER is a plain string (no extra validation)", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { env, validateObservabilityEnv } from "@baseworks/config"; validateObservabilityEnv(); console.log(env.OBS_TRUST_TRACEPARENT_HEADER)',
      ],
      {
        env: {
          ...baseEnv,
          NODE_ENV: "production",
          OBS_TRUST_TRACEPARENT_HEADER: "X-Internal-Source",
        },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("X-Internal-Source");
  });

  test("Test 9: malformed CIDR in NODE_ENV=test soft-warns and does not throw", async () => {
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
          OBS_TRUST_TRACEPARENT_FROM: "10.0/8",
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
    expect(stderr).toContain("[env] WARNING");
    expect(stderr).toContain("OBS_TRUST_TRACEPARENT_FROM");
    expect(stderr).toContain("10.0/8");
  });
});

describe("assertRedisUrl", () => {
  const baseEnv = {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    DATABASE_URL: "postgres://user:pass@localhost:5432/testdb",
    BETTER_AUTH_SECRET: "a".repeat(32),
    NODE_ENV: "test",
  };

  test("throws for worker role without REDIS_URL", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { assertRedisUrl } from "@baseworks/config"; assertRedisUrl("worker", undefined); console.log("OK")',
      ],
      {
        env: { ...baseEnv },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("REDIS_URL is required");
  });

  test("throws for all role without REDIS_URL", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { assertRedisUrl } from "@baseworks/config"; assertRedisUrl("all", undefined); console.log("OK")',
      ],
      {
        env: { ...baseEnv },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("REDIS_URL is required");
  });

  test("does not throw for api role without REDIS_URL", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { assertRedisUrl } from "@baseworks/config"; assertRedisUrl("api", undefined); console.log("OK")',
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

  test("passes for any role when REDIS_URL present", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { assertRedisUrl } from "@baseworks/config"; const url = assertRedisUrl("worker", "redis://localhost:6379"); console.log(url)',
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
    expect(stdout.trim()).toBe("redis://localhost:6379");
  });
});
