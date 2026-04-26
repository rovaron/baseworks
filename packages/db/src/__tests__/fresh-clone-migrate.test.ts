import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createDb } from "../connection";
import { sql } from "drizzle-orm";

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
 */

const ADMIN_DB_URL =
  process.env.DATABASE_URL ?? "postgres://baseworks:baseworks@localhost:5432/baseworks";
const SCRATCH_DB_NAME = "baseworks_migrate_test";
const scratchUrl = ADMIN_DB_URL.replace(/\/[^/?]+(\?|$)/, `/${SCRATCH_DB_NAME}$1`);

async function isPostgresAvailable(): Promise<boolean> {
  try {
    const db = createDb(ADMIN_DB_URL);
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

describe("fresh-clone migration baseline (Phase 20.1 D-03)", () => {
  let canConnect = false;

  beforeAll(async () => {
    canConnect = await isPostgresAvailable();
    if (!canConnect) return;
    const admin = createDb(ADMIN_DB_URL);
    await admin.execute(sql.raw(`DROP DATABASE IF EXISTS ${SCRATCH_DB_NAME}`));
    await admin.execute(sql.raw(`CREATE DATABASE ${SCRATCH_DB_NAME}`));
  });

  afterAll(async () => {
    if (!canConnect) return;
    const admin = createDb(ADMIN_DB_URL);
    await admin.execute(sql.raw(`DROP DATABASE IF EXISTS ${SCRATCH_DB_NAME}`));
  });

  test(
    "bun run db:migrate succeeds against an empty database",
    async () => {
      if (!canConnect) {
        console.warn(
          "SKIPPED: PostgreSQL unavailable (start: docker compose up -d postgres)",
        );
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

      const db = createDb(scratchUrl);
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
    },
    60_000,
  );
});
