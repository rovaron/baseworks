import { env, validatePaymentProviderEnv } from "@baseworks/config";
import { createDb, scopedDb } from "@baseworks/db";
import type { HandlerContext } from "@baseworks/shared";
import { Elysia } from "elysia";
import { sql } from "drizzle-orm";
import cors from "@elysiajs/cors";
import swagger from "@elysiajs/swagger";
import { requireRole, localeMiddleware } from "@baseworks/module-auth";
import { registerBillingHooks } from "@baseworks/module-billing";
import { ModuleRegistry } from "./core/registry";
import { tenantMiddleware } from "./core/middleware/tenant";
import { errorMiddleware } from "./core/middleware/error";
import { requestTraceMiddleware } from "./core/middleware/request-trace";
import { adminRoutes } from "./routes/admin";
import { logger } from "./lib/logger";

// Create database instance
const db = createDb(env.DATABASE_URL);

// Validate payment provider env vars at startup (T-10-09)
// Prevents starting with PAYMENT_PROVIDER=pagarme but no PAGARME_SECRET_KEY
validatePaymentProviderEnv();

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
  // Request tracing -- generates requestId, logs method/path/status/duration
  .use(requestTraceMiddleware)
  // Locale capture (Phase 12 D-02) -- reads NEXT_LOCALE cookie into AsyncLocalStorage
  // so sendInvitationEmail and other auth callbacks can resolve the request locale
  // without touching better-auth's plugin config.
  .use(localeMiddleware)
  .use(
    cors({
      credentials: true,
      origin: [env.WEB_URL, env.ADMIN_URL].filter(Boolean),
    }),
  )
  .use(swagger())
  // Health check -- no auth, no tenant context required
  // Enhanced with dependency status for Docker HEALTHCHECK and load balancer probes
  .get("/health", async () => {
    const checks: Record<string, { status: string; latency_ms?: number; error?: string }> = {};

    // Database check
    const dbStart = performance.now();
    try {
      await db.execute(sql`SELECT 1`);
      checks.database = { status: "up", latency_ms: Math.round(performance.now() - dbStart) };
    } catch (err) {
      checks.database = { status: "down", error: "Failed to connect" };
    }

    // Redis check (if configured)
    if (env.REDIS_URL) {
      const redisStart = performance.now();
      try {
        const { getRedisConnection } = await import("@baseworks/queue");
        const redis = getRedisConnection(env.REDIS_URL);
        await redis.ping();
        checks.redis = { status: "up", latency_ms: Math.round(performance.now() - redisStart) };
      } catch (err) {
        checks.redis = { status: "down", error: "Failed to connect" };
      }
    }

    const allUp = Object.values(checks).every((c) => c.status === "up");

    return {
      status: allUp ? "ok" : "degraded",
      modules: registry.getLoadedNames(),
      checks,
      uptime: Math.round(process.uptime()),
    };
  })
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
        emit: (event: string, data: unknown) =>
          registry.getEventBus().emit(event, {
            ...((typeof data === "object" && data !== null) ? data : { data }),
            _requestId: ctx.requestId,
          }),
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
