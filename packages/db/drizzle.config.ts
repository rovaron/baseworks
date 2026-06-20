import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

// Resolve schema/out paths against THIS file's directory so `bun run db:migrate`
// works regardless of process.cwd() (drizzle-kit otherwise resolves against
// process.cwd(), which breaks the repo-root `bun run db:*` scripts).
const here = dirname(fileURLToPath(import.meta.url));

// drizzle-kit globs the schema path with POSIX ("/") semantics; on Windows
// resolve() yields backslashes that its matcher fails to glob, producing
// "No schema files found for path". Normalize to forward slashes.
// `out` is different: drizzle-kit joins it onto process.cwd(), so an absolute
// path doubles ("C:\repo\C:\repo\..."). Make `out` relative to cwd instead.
// Both stay correct as long as the db:* scripts run from the repo root.
// See drizzle-team/drizzle-orm#4997.
const toPosix = (p: string) => p.replace(/\\/g, "/");

export default defineConfig({
  schema: toPosix(resolve(here, "./src/schema/index.ts")),
  out: toPosix(relative(process.cwd(), resolve(here, "./migrations"))),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
