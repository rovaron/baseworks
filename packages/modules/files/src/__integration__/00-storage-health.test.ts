/**
 * Phase 31 / QUO-03, OPS-03 — storage HealthContributor LIVE-DB tests.
 *
 * `00-`-prefixed to run BEFORE the @baseworks/db-faking unit suites (see
 * 00-reap-pending-uploads.test.ts header). Real config (env.STORAGE_HEALTH_PROBE_MS
 * defaults to 1500) + real Postgres.
 *
 * Asserts:
 *   - output shape (provider/adapter/quota/jobs) + NO storage_key/bucket leak.
 *   - 5s-timeout discipline: with STORAGE_PROVIDER=s3 and a fake adapter whose
 *     stat() NEVER resolves, the contributor returns in well under 5s with
 *     adapter.reachable === false (internal probe timeout resolves, not rejects).
 *   - status rollup: a tenant at >=100% quota ⇒ degraded.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";

process.env.DATABASE_URL ??= "postgres://baseworks:baseworks@localhost:5432/baseworks";
process.env.NODE_ENV ??= "test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-min-32-chars-long-xxxxxxxxxxxxxxx";
// Point the local-disk probe at an existing directory (statfs of a missing path
// resolves reachable:false → unhealthy).
process.env.STORAGE_LOCAL_PATH = tmpdir();

const TEST_DB_URL = process.env.DATABASE_URL;

const { checkStorageHealth, storageHealthContributor } = await import("../health/storage-health");
const { createDb, tenantStorageUsage } = await import("@baseworks/db");
const { resetFileStorage, setFileStorage } = await import("@baseworks/storage");
const { inArray, sql } = await import("drizzle-orm");

let db: ReturnType<typeof createDb>;
const createdTenantIds = new Set<string>();

function newTenantId(tag: string): string {
  const id = `health_${tag}_${crypto.randomUUID().slice(0, 12)}`;
  createdTenantIds.add(id);
  return id;
}

async function seedUsage(tenantId: string, used: number, limit: number): Promise<void> {
  await db
    .insert(tenantStorageUsage)
    .values({ tenantId, bytesUsed: used, bytesPending: 0, bytesLimit: limit })
    .onConflictDoUpdate({
      target: tenantStorageUsage.tenantId,
      set: { bytesUsed: used, bytesPending: 0, bytesLimit: limit },
    });
}

beforeAll(async () => {
  db = createDb(TEST_DB_URL);
  await db.execute(sql`SELECT 1`);
});

afterAll(async () => {
  if (createdTenantIds.size > 0) {
    await db
      .delete(tenantStorageUsage)
      .where(inArray(tenantStorageUsage.tenantId, [...createdTenantIds]));
  }
  resetFileStorage();
  const handle = (db as unknown as { $sql?: { end: (o?: { timeout?: number }) => Promise<void> } })
    .$sql;
  if (handle) await handle.end({ timeout: 5 });
});

describe("storage health contributor (Phase 31 / OPS-03, live DB)", () => {
  test("contributor descriptor: name=storage, timeoutMs=4000 (< 5s aggregator cache)", () => {
    expect(storageHealthContributor.name).toBe("storage");
    expect(storageHealthContributor.timeoutMs).toBe(4000);
  });

  test("local provider ⇒ healthy shape; no storage_key/bucket leak", async () => {
    process.env.STORAGE_PROVIDER = "local";
    resetFileStorage();

    const result = await checkStorageHealth();
    const details = result.details as Record<string, unknown>;

    expect(["healthy", "degraded", "unhealthy"]).toContain(result.status);
    expect(details.provider).toBe("local");

    const adapter = details.adapter as Record<string, unknown>;
    expect(adapter.kind).toBe("local-disk");
    expect(typeof adapter.reachable).toBe("boolean");

    const quota = details.quota as Record<string, unknown>;
    expect(typeof quota.tenantCount).toBe("number");
    expect(Array.isArray(quota.topTenants)).toBe(true);
    expect(typeof quota.tenantsAtWarn).toBe("number");
    expect(typeof quota.tenantsAtLimit).toBe("number");

    expect(Array.isArray(details.jobs)).toBe(true);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("storage_key");
    expect(serialized).not.toContain("storageKey");
    expect(serialized).not.toContain("__healthcheck__");
  });

  test("tenant at >=100% quota ⇒ degraded; surfaced in topTenants with pctUsed", async () => {
    process.env.STORAGE_PROVIDER = "local";
    resetFileStorage();

    const tenantId = newTenantId("atlimit");
    await seedUsage(tenantId, 1000, 1000); // 100%

    const result = await checkStorageHealth();
    const details = result.details as Record<string, unknown>;
    const quota = details.quota as {
      tenantsAtLimit: number;
      topTenants: Array<{ tenantId: string; pctUsed: number }>;
    };

    expect(quota.tenantsAtLimit).toBeGreaterThanOrEqual(1);
    expect(result.status).toBe("degraded");
    const mine = quota.topTenants.find((t) => t.tenantId === tenantId);
    expect(mine).toBeDefined();
    expect(mine?.pctUsed).toBeGreaterThanOrEqual(1);
  });

  test("5s discipline: hung S3 stat() ⇒ returns < 5s with adapter.reachable=false", async () => {
    process.env.STORAGE_PROVIDER = "s3";
    setFileStorage({
      name: "hung-s3",
      async signUpload() {
        throw new Error("unused");
      },
      async signRead() {
        throw new Error("unused");
      },
      stat() {
        return new Promise(() => {}); // never resolves
      },
      async delete() {},
      async getObject() {
        return new Uint8Array();
      },
      async putObject() {},
    } as never);

    const start = Date.now();
    const result = await checkStorageHealth();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5000);
    const adapter = (result.details as Record<string, unknown>).adapter as Record<string, unknown>;
    expect(adapter.reachable).toBe(false);
    expect(adapter.kind).toBe("object-store");
    expect(result.status).toBe("unhealthy");

    process.env.STORAGE_PROVIDER = "local";
    resetFileStorage();
  });
});
