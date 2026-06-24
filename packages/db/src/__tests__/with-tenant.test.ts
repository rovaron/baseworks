// packages/db/src/__tests__/with-tenant.test.ts
import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { getRlsDb } from "../connection";
import { withTenant } from "../helpers/with-tenant";

const RLS_URL =
  process.env.DATABASE_URL_RLS ??
  "postgres://baseworks_rls:baseworks_rls_dev@localhost:5432/baseworks";
let canConnect = false;
beforeAll(async () => {
  process.env.DATABASE_URL_RLS ??= RLS_URL;
  try {
    await getRlsDb().execute(sql`select 1`);
    canConnect = true;
  } catch {
    canConnect = false;
  }
});

describe("withTenant", () => {
  test("sets app.tenant_id transaction-locally", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: RLS role / Postgres unavailable");
      return;
    }
    const seen = await withTenant(getRlsDb(), "tenant-abc", async (tx) => {
      const rows = (await tx.execute(
        sql`select current_setting('app.tenant_id', true) as t`,
      )) as unknown as Array<{ t: string }>;
      return rows[0]?.t;
    });
    expect(seen).toBe("tenant-abc");

    // After the tx, the setting must NOT leak on the pooled connection.
    const after = (await getRlsDb().execute(
      sql`select current_setting('app.tenant_id', true) as t`,
    )) as unknown as Array<{ t: string | null }>;
    expect(after[0]?.t == null || after[0]?.t === "").toBe(true);
  });
});
