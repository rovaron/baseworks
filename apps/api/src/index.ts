import { env } from "@baseworks/config";
import { createDb, scopedDb } from "@baseworks/db";
import type { HandlerContext } from "@baseworks/shared";
import { Elysia } from "elysia";
import cors from "@elysiajs/cors";
import swagger from "@elysiajs/swagger";
import { requireRole } from "@baseworks/module-auth";
import { registerBillingHooks } from "@baseworks/module-billing";
import { ModuleRegistry } from "./core/registry";
import { tenantMiddleware } from "./core/middleware/tenant";
import { errorMiddleware } from "./core/middleware/error";
import { adminRoutes } from "./routes/admin";
import { logger } from "./lib/logger";

// Create database instance
const db = createDb(env.DATABASE_URL);

// Create module registry -- auth module loaded alongside example
const registry = new ModuleRegistry({
  role: env.INSTANCE_ROLE as "api" | "worker" | "all",
  modules: ["auth", "billing", "example"],
});

// Load all configured modules
await registry.loadAll();

// Register billing hooks (auto-create Stripe customer on tenant.created)
registerBillingHooks(registry.getEventBus());

// Get module routes for direct .use() chaining
const authRoutes = registry.getAuthRoutes();
const billingModule = registry.getLoaded().get("billing");
const billingApiRoutes = billingModule?.routes;

// Build app via chained .use() calls to preserve type inference for Eden Treaty.
// No `as any` casts -- each plugin is used directly in the chain.
const app = new Elysia()
  // Global error handling -- registered first
  .use(errorMiddleware)
  .use(
    cors({
      credentials: true,
      origin: [env.WEB_URL, env.ADMIN_URL].filter(Boolean),
    }),
  )
  .use(swagger())
  // Health check -- no auth, no tenant context required
  .get("/health", () => ({
    status: "ok",
    modules: registry.getLoadedNames(),
  }))
  // Auth routes -- mounted BEFORE tenant middleware so signup/login/OAuth
  // callbacks do NOT require tenant context (D-16)
  .use(authRoutes ?? new Elysia())
  // Tenant-scoped routes group -- requires authenticated session
  .use(tenantMiddleware)
  .derive({ as: "scoped" }, (ctx: any) => {
    const tenantId: string = ctx.tenantId;
    return {
      handlerCtx: {
        tenantId,
        userId: ctx.userId,
        db: scopedDb(db, tenantId),
        emit: (event: string, data: unknown) => registry.getEventBus().emit(event, data),
      } satisfies HandlerContext,
    };
  })
  // Billing HTTP routes (tenant-scoped commands/queries)
  .use(billingApiRoutes ?? new Elysia())
  // Admin API routes (cross-tenant, owner-only)
  .use(adminRoutes)
  // Owner-only route: delete tenant (per D-13, TNNT-04)
  .group("/api", (group) =>
    group
      .use(requireRole("owner"))
      .delete("/tenant", (ctx: any) => {
        return {
          message: "Tenant deletion initiated",
          tenantId: ctx.tenantId,
        };
      }),
  )
  // Non-auth, non-billing module routes (e.g., example)
  .use(registry.getModuleRoutes());

// Start server
app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, role: env.INSTANCE_ROLE }, "Baseworks API started");
});

// Export app type for Eden Treaty (used by @baseworks/api-client)
export type App = typeof app;
