import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createDb } from "../connection";
import { scopedDb } from "../helpers/scoped-db";
import { examples } from "../schema/example";
import { eq, and, sql } from "drizzle-orm";

/**
 * Integration tests for scopedDb tenant isolation.
 * Requires a running PostgreSQL instance with the examples table.
 * Tests will be skipped if PostgreSQL is unavailable.
 */

const TEST_DB_URL = process.env.DATABASE_URL ?? "postgres://baseworks:baseworks@localhost:5432/baseworks";

let db: ReturnType<typeof createDb>;
let canConnect = false;

beforeAll(async () => {
  try {
    db = createDb(TEST_DB_URL);
    // Test connectivity
    await db.execute(sql`SELECT 1`);
    canConnect = true;

    // Clean up any previous test data
    await db.delete(examples).where(
      eq(examples.tenantId, "tenant-a"),
    );
    await db.delete(examples).where(
      eq(examples.tenantId, "tenant-b"),
    );

    // Seed test data for two tenants
    await db.insert(examples).values([
      { tenantId: "tenant-a", title: "A-Item-1", description: "Tenant A first" },
      { tenantId: "tenant-a", title: "A-Item-2", description: "Tenant A second" },
      { tenantId: "tenant-b", title: "B-Item-1", description: "Tenant B first" },
    ]);
  } catch (e) {
    console.warn("PostgreSQL unavailable -- scoped-db tests will be skipped:", (e as Error).message);
    canConnect = false;
  }
});

afterAll(async () => {
  if (!canConnect) return;
  // Cleanup test data
  await db.delete(examples).where(eq(examples.tenantId, "tenant-a"));
  await db.delete(examples).where(eq(examples.tenantId, "tenant-b"));
});

describe("scopedDb", () => {
  test("select only returns rows matching the given tenantId", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }
    const scoped = scopedDb(db, "tenant-a");
    const results = await scoped.select(examples);
    expect(results.length).toBe(2);
    for (const row of results) {
      expect(row.tenantId).toBe("tenant-a");
    }
  });

  test("insert auto-injects tenantId into inserted rows", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }
    const scoped = scopedDb(db, "tenant-a");
    const [inserted] = await scoped.insert(examples).values({
      title: "A-Inserted",
      description: "Auto-injected tenant",
    });
    expect(inserted.tenantId).toBe("tenant-a");
    expect(inserted.title).toBe("A-Inserted");

    // Cleanup the inserted row
    await db.delete(examples).where(
      and(eq(examples.tenantId, "tenant-a"), eq(examples.title, "A-Inserted")),
    );
  });

  test("select with tenant A does NOT return tenant B data", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }
    const scopedA = scopedDb(db, "tenant-a");
    const scopedB = scopedDb(db, "tenant-b");

    const resultsA = await scopedA.select(examples);
    const resultsB = await scopedB.select(examples);

    // Tenant A has 2 items, tenant B has 1
    expect(resultsA.length).toBe(2);
    expect(resultsB.length).toBe(1);

    // No cross-contamination
    for (const row of resultsA) {
      expect(row.tenantId).toBe("tenant-a");
    }
    for (const row of resultsB) {
      expect(row.tenantId).toBe("tenant-b");
    }
  });

  test("update only affects rows belonging to the given tenant", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }
    const scoped = scopedDb(db, "tenant-a");
    await scoped.update(examples).set({ description: "Updated by tenant-a" });

    // Verify tenant-a rows were updated
    const resultsA = await scopedDb(db, "tenant-a").select(examples);
    for (const row of resultsA) {
      expect(row.description).toBe("Updated by tenant-a");
    }

    // Verify tenant-b rows were NOT updated
    const resultsB = await scopedDb(db, "tenant-b").select(examples);
    for (const row of resultsB) {
      expect(row.description).toBe("Tenant B first");
    }
  });

  test("delete only removes rows belonging to the given tenant", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }
    // Insert a row to delete
    await db.insert(examples).values({
      tenantId: "tenant-a",
      title: "A-ToDelete",
      description: "Will be deleted",
    });

    const scoped = scopedDb(db, "tenant-a");
    await scoped.delete(examples);

    // Tenant A rows should be gone
    const resultsA = await scopedDb(db, "tenant-a").select(examples);
    expect(resultsA.length).toBe(0);

    // Tenant B rows should still exist
    const resultsB = await scopedDb(db, "tenant-b").select(examples);
    expect(resultsB.length).toBe(1);

    // Re-seed tenant-a for any subsequent tests
    await db.insert(examples).values([
      { tenantId: "tenant-a", title: "A-Item-1", description: "Tenant A first" },
      { tenantId: "tenant-a", title: "A-Item-2", description: "Tenant A second" },
    ]);
  });
});

describe("scopedDb edge cases", () => {
  test("exposes raw property for unscoped access", () => {
    // Create a minimal mock db to test structural properties
    const mockDb = { select: () => {}, insert: () => {}, update: () => {}, delete: () => {} } as any;
    const scoped = scopedDb(mockDb, "test-tenant");

    // raw should be the original unscoped db instance
    expect(scoped.raw).toBe(mockDb);
  });

  test("tenantId is accessible on the scoped db", () => {
    const mockDb = {} as any;
    const scoped = scopedDb(mockDb, "my-tenant-123");

    expect(scoped.tenantId).toBe("my-tenant-123");
  });

  test("handles empty string tenantId without throwing", () => {
    // scopedDb accepts any string -- empty string is a valid (if unusual) value.
    // It will scope queries to tenantId="" which returns no rows in practice.
    const mockDb = {} as any;
    const scoped = scopedDb(mockDb, "");

    expect(scoped.tenantId).toBe("");
    expect(scoped.raw).toBe(mockDb);
  });

  test("different scoped instances have independent tenantId values", () => {
    const mockDb = {} as any;
    const scopedA = scopedDb(mockDb, "tenant-a");
    const scopedB = scopedDb(mockDb, "tenant-b");

    expect(scopedA.tenantId).toBe("tenant-a");
    expect(scopedB.tenantId).toBe("tenant-b");
    // Both share the same underlying db
    expect(scopedA.raw).toBe(scopedB.raw);
  });

  test("select returns a thenable (query builder) when db is real", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }
    const scoped = scopedDb(db, "nonexistent-tenant");
    const results = await scoped.select(examples);

    // A tenant with no data should return empty array, not crash
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });
});
