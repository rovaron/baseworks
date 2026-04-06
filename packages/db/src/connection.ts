import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function createDb(connectionString: string) {
  const sql = postgres(connectionString);
  return drizzle(sql, {
    schema,
    logger: process.env.NODE_ENV === "development",
  });
}

export type DbInstance = ReturnType<typeof createDb>;
