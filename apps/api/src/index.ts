import { env } from "@baseworks/config";
import { createDb } from "@baseworks/db";
import { Elysia } from "elysia";
import cors from "@elysiajs/cors";
import swagger from "@elysiajs/swagger";
import { ModuleRegistry } from "./core/registry";
import { logger } from "./lib/logger";

// Create database instance
const db = createDb(env.DATABASE_URL);

// Create module registry
const registry = new ModuleRegistry({
  role: env.INSTANCE_ROLE as "api" | "worker" | "all",
  modules: ["example"],
});

// Load all configured modules
await registry.loadAll();

// Create Elysia app
const app = new Elysia()
  .use(cors())
  .use(swagger())
  .state("db", db)
  .state("tenantId", "dev-tenant") // TODO: Plan 03 wires real tenant from session
  .state("emit", (event: string, data: unknown) => registry.getEventBus().emit(event, data))
  .state("registry", registry)
  .get("/health", () => ({
    status: "ok",
    modules: registry.getLoadedNames(),
  }));

// Attach module routes (cast needed due to Elysia's complex generic inference)
registry.attachRoutes(app as any);

// Start server
app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, role: env.INSTANCE_ROLE }, "Baseworks API started");
});

// Export app type for Eden Treaty (used in Phase 4)
export type App = typeof app;
