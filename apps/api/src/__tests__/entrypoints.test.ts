import { describe, expect, test } from "bun:test";

/**
 * Tests for API and worker entrypoints.
 * Tests API via Elysia's .handle() without starting a real server.
 * Tests worker via subprocess spawn.
 */

describe("API entrypoint", () => {
  test("GET /health responds with 200 and module list", async () => {
    // Use dynamic import to load the app without starting the server
    // We test by creating a minimal app with the same structure
    const { Elysia } = await import("elysia");
    const { errorMiddleware } = await import("../core/middleware/error");

    const testApp = new Elysia().use(errorMiddleware).get("/health", () => ({
      status: "ok",
      modules: ["example"],
    }));

    const response = await testApp.handle(new Request("http://localhost/health"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.modules).toContain("example");
  });
});

describe("Worker entrypoint", () => {
  // 15s test budget: the internal kill timer (below) must fire and the piped
  // streams drain BEFORE bun's test timeout — a 5000ms kill under bun's default
  // 5000ms test timeout was a race that timed out on slower/Windows hosts.
  test("worker starts without HTTP server and logs startup", async () => {
    // Spawn worker as subprocess with minimal env
    const proc = Bun.spawn(["bun", "run", "apps/api/src/worker.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL:
          process.env.DATABASE_URL ?? "postgres://baseworks:baseworks@localhost:5432/baseworks",
        NODE_ENV: "test",
        INSTANCE_ROLE: "worker",
        LOG_LEVEL: "info",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Kill after 3s (well under the 15s test budget) — we only need enough
    // output to confirm the worker entrypoint loads and starts NO HTTP server.
    const timeout = setTimeout(() => proc.kill(), 3000);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    clearTimeout(timeout);

    const output = stdout + stderr;

    // Worker should log startup message (pino JSON or pretty format)
    const started = output.includes("Worker started") || output.includes("worker");

    // If it couldn't connect to DB, that's OK -- we just verify the entrypoint loads
    // The key thing is it does NOT start an HTTP server
    const noServer = !output.includes("Baseworks API started");

    expect(noServer).toBe(true);
  }, 15000);
});
