import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Create a Drizzle ORM instance connected to PostgreSQL via postgres.js driver.
 *
 * Initializes the connection pool and binds all schema definitions for
 * relational query support. Enables query logging in development mode.
 *
 * @param connectionString - PostgreSQL connection URL (e.g., `postgres://user:pass@host/db`)
 * @returns Configured Drizzle ORM instance with schema bindings
 *
 * @example
 * const db = createDb(process.env.DATABASE_URL);
 */
export function createDb(connectionString: string) {
  const sql = postgres(connectionString);
  return drizzle(sql, {
    schema,
    logger: process.env.NODE_ENV === "development",
  });
}

/**
 * Drizzle ORM instance type for PostgreSQL with postgres.js driver.
 *
 * Inferred from the return type of `createDb`. Used throughout the codebase
 * as the base database type before tenant scoping is applied.
 */
export type DbInstance = ReturnType<typeof createDb>;
