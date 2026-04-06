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
