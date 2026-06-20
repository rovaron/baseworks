import { describe, expect, test } from "bun:test";

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

  // Phase 26 / QUO-01 — STORAGE_DEFAULT_QUOTA_BYTES default + coercion.
  test("STORAGE_DEFAULT_QUOTA_BYTES defaults to 1 GiB and coerces overrides to number", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { env } from "@baseworks/config"; console.log(JSON.stringify({ quota: env.STORAGE_DEFAULT_QUOTA_BYTES, type: typeof env.STORAGE_DEFAULT_QUOTA_BYTES }))',
      ],
      {
        env: {
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          DATABASE_URL: "postgres://user:pass@localhost:5432/testdb",
          BETTER_AUTH_SECRET: "a".repeat(32),
          NODE_ENV: "test",
          // No STORAGE_DEFAULT_QUOTA_BYTES -- should fall back to the default.
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
    expect(result.type).toBe("number");
    expect(result.quota).toBe(1073741824);
  });

  test("STORAGE_DEFAULT_QUOTA_BYTES honors an explicit override", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { env } from "@baseworks/config"; console.log(String(env.STORAGE_DEFAULT_QUOTA_BYTES))',
      ],
      {
        env: {
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          DATABASE_URL: "postgres://user:pass@localhost:5432/testdb",
          BETTER_AUTH_SECRET: "a".repeat(32),
          NODE_ENV: "test",
          STORAGE_DEFAULT_QUOTA_BYTES: "524288000",
        },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("524288000");
  });

  // Phase 27 / UPL-04 — STORAGE_SIGNED_URL_TTL_SEC default + bounds.
  test("STORAGE_SIGNED_URL_TTL_SEC defaults to 600 and coerces to number", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { env } from "@baseworks/config"; console.log(JSON.stringify({ ttl: env.STORAGE_SIGNED_URL_TTL_SEC, type: typeof env.STORAGE_SIGNED_URL_TTL_SEC }))',
      ],
      {
        env: {
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          DATABASE_URL: "postgres://user:pass@localhost:5432/testdb",
          BETTER_AUTH_SECRET: "a".repeat(32),
          NODE_ENV: "test",
          // No STORAGE_SIGNED_URL_TTL_SEC -- should fall back to the default.
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
    expect(result.type).toBe("number");
    expect(result.ttl).toBe(600);
  });

  test("STORAGE_SIGNED_URL_TTL_SEC honors an in-bounds override", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { env } from "@baseworks/config"; console.log(String(env.STORAGE_SIGNED_URL_TTL_SEC))',
      ],
      {
        env: {
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          DATABASE_URL: "postgres://user:pass@localhost:5432/testdb",
          BETTER_AUTH_SECRET: "a".repeat(32),
          NODE_ENV: "test",
          STORAGE_SIGNED_URL_TTL_SEC: "900",
        },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("900");
  });

  test("STORAGE_SIGNED_URL_TTL_SEC rejects an out-of-bounds value (< 300)", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import { env } from "@baseworks/config"; console.log(String(env.STORAGE_SIGNED_URL_TTL_SEC))',
      ],
      {
        env: {
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          DATABASE_URL: "postgres://user:pass@localhost:5432/testdb",
          BETTER_AUTH_SECRET: "a".repeat(32),
          NODE_ENV: "test",
          STORAGE_SIGNED_URL_TTL_SEC: "10",
        },
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir + "/../../..",
      },
    );

    const exitCode = await proc.exited;
    expect(exitCode).not.toBe(0);
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
          STRIPE_WEBHOOK_SECRET: "whsec_test_123",
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

// Phase 20.1 D-12 — `validateObservabilityEnv — CIDR trust policy` describe
// block deleted along with the OBS_TRUST_TRACEPARENT_FROM/_HEADER env vars
// and their CIDR-based validation. OTel's "always honor inbound traceparent"
// is the v1.3 default; production trust hardening is deferred per
// .planning/phases/20.1-close-v13-milestone-gaps/20.1-CONTEXT.md.

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
