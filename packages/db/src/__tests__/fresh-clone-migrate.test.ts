import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/**
 * Phase 20.1 Plan 01 D-03 — fresh-clone migration regression gate.
 *
 * Boots a scratch Postgres database, runs `bun run db:migrate` against it,
 * and asserts that the resulting schema reflects the current `provider_*`
 * column shape (post-rename). This locks SC#1 as a CI-grade regression test:
 * a freshly-cloned repo + `docker compose up -d`'d database must apply
 * migrations cleanly with no journal/disk inconsistencies.
 *
 * Skip discipline: when PostgreSQL is unavailable the test is SKIPPED (not
 * failed) — same pattern as connection.test.ts and scoped-db.test.ts.
 *
 * Connection-lifecycle discipline: every `postgres()` client is `.end()`'d
 * before exit so afterAll's `DROP DATABASE` is not blocked by lingering
 * connections to the scratch DB.
 */

const ADMIN_DB_URL =
  process.env.DATABASE_URL ?? "postgres://baseworks:baseworks@localhost:5432/baseworks";
const SCRATCH_DB_NAME = "baseworks_migrate_test";
const scratchUrl = ADMIN_DB_URL.replace(/\/[^/?]+(\?|$)/, `/${SCRATCH_DB_NAME}$1`);

async function isPostgresAvailable(): Promise<boolean> {
  const client = postgres(ADMIN_DB_URL, { max: 1 });
  try {
    await client`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.end({ timeout: 1 });
  }
}

async function dropScratchDatabase(): Promise<void> {
  const admin = postgres(ADMIN_DB_URL, { max: 1 });
  try {
    // Terminate any lingering connections to the scratch DB before dropping.
    await admin`
      SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
       WHERE datname = ${SCRATCH_DB_NAME}
         AND pid <> pg_backend_pid()
    `;
    await admin.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH_DB_NAME}`);
  } finally {
    await admin.end({ timeout: 1 });
  }
}

async function createScratchDatabase(): Promise<void> {
  const admin = postgres(ADMIN_DB_URL, { max: 1 });
  try {
    await admin.unsafe(`CREATE DATABASE ${SCRATCH_DB_NAME}`);
  } finally {
    await admin.end({ timeout: 1 });
  }
}

describe("fresh-clone migration baseline (Phase 20.1 D-03)", () => {
  let canConnect = false;
  let canCreateDb = false;

  beforeAll(async () => {
    canConnect = await isPostgresAvailable();
    if (!canConnect) return;
    // The test needs CREATEDB to spin up a scratch database. CI's `postgres`
    // superuser has it; a local dev role (e.g. `baseworks`) typically does NOT,
    // so a "permission denied to create database" must SKIP (not fail) — same
    // discipline as the PostgreSQL-unavailable path. Migration correctness is
    // still exercised in CI where the privilege exists.
    try {
      await dropScratchDatabase();
      await createScratchDatabase();
      canCreateDb = true;
    } catch (err) {
      console.warn(
        `SKIPPED: cannot create the scratch database (CREATEDB privilege required): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      canCreateDb = false;
    }
  });

  afterAll(async () => {
    if (!canCreateDb) return;
    await dropScratchDatabase();
  });

  test("bun run db:migrate succeeds against an empty database", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable (start: docker compose up -d postgres)");
      return;
    }
    if (!canCreateDb) {
      console.warn("SKIPPED: role lacks CREATEDB; the fresh-clone baseline runs in CI (superuser)");
      return;
    }

    const proc = Bun.spawn(["bun", "run", "db:migrate"], {
      env: { ...process.env, DATABASE_URL: scratchUrl },
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    expect(exitCode, `db:migrate stderr: ${stderr}`).toBe(0);

    const client = postgres(scratchUrl, { max: 1 });
    try {
      const db = drizzle(client);
      const tables = (await db.execute(sql`
          SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public'
           ORDER BY table_name
        `)) as Array<{ table_name: string }>;
      const names = tables.map((r) => r.table_name);
      expect(names).toContain("billing_customers");
      expect(names).toContain("user");
      expect(names).toContain("session");
      expect(names).toContain("examples");

      const cols = (await db.execute(sql`
          SELECT column_name FROM information_schema.columns
           WHERE table_name = 'billing_customers'
        `)) as Array<{ column_name: string }>;
      const colNames = cols.map((r) => r.column_name);
      expect(colNames).toContain("provider_customer_id");
      expect(colNames).not.toContain("stripe_customer_id");
    } finally {
      await client.end({ timeout: 1 });
    }
  }, 60_000);
});
