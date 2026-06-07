import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Create a Drizzle ORM instance connected to PostgreSQL via postgres.js driver.
 *
 * Initializes the connection pool with bounded sizing (configurable via
 * `DB_POOL_MAX`) and binds all schema definitions for relational query support.
 * Enables query logging in development mode. The underlying postgres.js handle
 * is exposed on the instance as `$sql` so callers can close the pool during
 * graceful shutdown.
 *
 * This stays a factory (each call opens a fresh pool); for shared
 * process-wide usage prefer the lazy `getDb()` singleton below.
 *
 * @param connectionString - PostgreSQL connection URL (e.g., `postgres://user:pass@host/db`)
 * @returns Configured Drizzle ORM instance with schema bindings
 *
 * @example
 * const db = createDb(process.env.DATABASE_URL);
 */
export function createDb(connectionString: string) {
  const sql = postgres(connectionString, {
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idle_timeout: 20,
    max_lifetime: 60 * 30,
  });
  const db = drizzle(sql, {
    schema,
    logger: process.env.NODE_ENV === "development",
  });
  (db as DbInstance & { $sql?: typeof sql }).$sql = sql; // expose handle for graceful shutdown
  return db;
}

/**
 * Drizzle ORM instance type for PostgreSQL with postgres.js driver.
 *
 * Inferred from the return type of `createDb`. Used throughout the codebase
 * as the base database type before tenant scoping is applied.
 */
export type DbInstance = ReturnType<typeof createDb>;

let _db: DbInstance | undefined;

/**
 * Lazily-initialized, process-wide Drizzle singleton.
 *
 * Reuses one connection pool across the process instead of opening a new pool
 * per call. Prefer this over `createDb` for application code; reserve
 * `createDb` for tests and migration/scratch scripts that need disposable pools.
 *
 * @param connectionString - PostgreSQL connection URL (defaults to `DATABASE_URL`)
 * @returns The shared Drizzle ORM instance
 */
export function getDb(connectionString: string = process.env.DATABASE_URL as string): DbInstance {
  return (_db ??= createDb(connectionString));
}

/**
 * Close the shared singleton's connection pool for graceful shutdown.
 *
 * Ends the underlying postgres.js handle (with a short drain timeout) and
 * clears the singleton so a subsequent `getDb()` opens a fresh pool. Safe to
 * call when no singleton has been created.
 */
export async function closeDb(): Promise<void> {
  const sql = (_db as (DbInstance & { $sql?: { end: (o?: { timeout?: number }) => Promise<void> } }) | undefined)?.$sql;
  if (sql) await sql.end({ timeout: 5 });
  _db = undefined;
}
