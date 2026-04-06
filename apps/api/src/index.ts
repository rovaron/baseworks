import { env } from "@baseworks/config";
import { createDb, scopedDb } from "@baseworks/db";
import type { HandlerContext } from "@baseworks/shared";
import { Elysia } from "elysia";
import cors from "@elysiajs/cors";
import swagger from "@elysiajs/swagger";
import { ModuleRegistry } from "./core/registry";
import { tenantMiddleware } from "./core/middleware/tenant";
import { errorMiddleware } from "./core/middleware/error";
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
  // Global error handling -- registered first
  .use(errorMiddleware)
  .use(cors())
  .use(swagger())
  // Health check -- registered BEFORE tenantMiddleware so it does not require tenant context
  .get("/health", () => ({
    status: "ok",
    modules: registry.getLoadedNames(),
  }))
  // Tenant-scoped routes group
  .use(tenantMiddleware)
  .derive({ as: "scoped" }, (ctx: any) => {
    const tenantId: string = ctx.tenantId;
    return {
      handlerCtx: {
        tenantId,
        db: scopedDb(db, tenantId),
        emit: (event: string, data: unknown) => registry.getEventBus().emit(event, data),
      } satisfies HandlerContext,
    };
  });

// Attach module routes (cast needed due to Elysia's complex generic inference)
registry.attachRoutes(app as any);

// Start server
app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, role: env.INSTANCE_ROLE }, "Baseworks API started");
});

// Export app type for Eden Treaty (used in Phase 4)
export type App = typeof app;
