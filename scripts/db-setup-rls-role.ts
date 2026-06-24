// scripts/db-setup-rls-role.ts
// Applies scripts/db-setup-rls-role.sql to DATABASE_URL (owner connection),
// passing BASEWORKS_RLS_PASSWORD as the psql variable `rls_password`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

const ownerUrl = process.env.DATABASE_URL;
const rlsPassword = process.env.BASEWORKS_RLS_PASSWORD;
if (!ownerUrl) throw new Error("DATABASE_URL is required");
if (!rlsPassword) throw new Error("BASEWORKS_RLS_PASSWORD is required");

const sqlText = readFileSync(resolve(import.meta.dir, "db-setup-rls-role.sql"), "utf8").replace(
  /:'rls_password'/g,
  // postgres.js parameterization can't reach inside DO/format; inline-quote safely.
  `'${rlsPassword.replace(/'/g, "''")}'`,
);

const sql = postgres(ownerUrl, { max: 1 });
try {
  await sql.unsafe(sqlText);
  console.log("rls-role-setup: ok");
} finally {
  await sql.end({ timeout: 5 });
}
