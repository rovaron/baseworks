import { defineConfig } from "drizzle-kit";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Resolve schema/out paths against THIS file's directory so `bun run db:migrate`
// works regardless of process.cwd() (drizzle-kit otherwise resolves against
// process.cwd(), which breaks the repo-root `bun run db:*` scripts).
const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  schema: resolve(here, "./src/schema/index.ts"),
  out: resolve(here, "./migrations"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
