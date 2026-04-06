import { describe, test, expect } from "bun:test";
import { createDb } from "../connection";

async function isPostgresAvailable(): Promise<boolean> {
  try {
    const databaseUrl =
      process.env.DATABASE_URL || "postgres://baseworks:baseworks@localhost:5432/baseworks";
    const db = createDb(databaseUrl);
    await db.execute("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

describe("database connection", () => {
  test("createDb returns a Drizzle instance", () => {
    // Use a dummy URL -- we are not connecting, just verifying the factory returns an object
    const db = createDb("postgres://user:pass@localhost:5432/testdb");
    expect(db).toBeDefined();
    expect(typeof db).toBe("object");
  });

  test("createDb can execute SELECT 1 against running PostgreSQL", async () => {
    // Requires Docker PostgreSQL running: docker compose up -d postgres
    const available = await isPostgresAvailable();
    if (!available) {
      console.warn("SKIPPED: PostgreSQL not available (start with: docker compose up -d postgres)");
      return;
    }

    const databaseUrl =
      process.env.DATABASE_URL || "postgres://baseworks:baseworks@localhost:5432/baseworks";
    const db = createDb(databaseUrl);

    const result = await db.execute("SELECT 1 as value");
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
  });
});
