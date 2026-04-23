import "./telemetry";
import { env, validatePaymentProviderEnv, validateObservabilityEnv } from "@baseworks/config";
import { createDb, scopedDb } from "@baseworks/db";
import type { HandlerContext } from "@baseworks/shared";
import { Elysia } from "elysia";
import { sql } from "drizzle-orm";
import cors from "@elysiajs/cors";
import swagger from "@elysiajs/swagger";
import { requireRole } from "@baseworks/module-auth";
import { registerBillingHooks } from "@baseworks/module-billing";
import { registerExampleHooks } from "@baseworks/module-example";
import { ModuleRegistry } from "./core/registry";
import { tenantMiddleware } from "./core/middleware/tenant";
import { errorMiddleware } from "./core/middleware/error";
import { requestTraceMiddleware } from "./core/middleware/request-trace";
import { observabilityMiddleware } from "./core/middleware/observability";
import { adminRoutes } from "./routes/admin";
import { logger } from "./lib/logger";
import {
  getErrorTracker,
  getTracer,
  installGlobalErrorHandlers,
  obsContext,
  wrapCqrsBus,
  wrapEventBus,
} from "@baseworks/observability";
import { defaultLocale } from "@baseworks/i18n";
import { parseNextLocaleCookie } from "./lib/locale-cookie";
import { decideInboundTrace } from "./lib/inbound-trace";

// Create database instance
const db = createDb(env.DATABASE_URL);

// Validate payment provider env vars at startup (T-10-09)
// Prevents starting with PAYMENT_PROVIDER=pagarme but no PAGARME_SECRET_KEY
validatePaymentProviderEnv();
// Phase 18 — crash-hard on missing DSN for the selected ERROR_TRACKER (D-09).
validateObservabilityEnv();
// Phase 18 D-02 — register global uncaughtException + unhandledRejection handlers.
installGlobalErrorHandlers(getErrorTracker());

// Create module registry -- auth module loaded alongside example
const registry = new ModuleRegistry({
  role: env.INSTANCE_ROLE as "api" | "worker" | "all",
  modules: ["auth", "billing", "example"],
});

// Load all configured modules
await registry.loadAll();

// Phase 18 D-01 — wrap the CqrsBus so thrown handler exceptions are captured.
// External wrapper; zero edits to apps/api/src/core/cqrs.ts (D-01 invariant).
wrapCqrsBus(registry.getCqrs(), getErrorTracker());
// Phase 19 D-16 — wrap the EventBus so emit/on get producer/consumer spans.
// External wrapper; zero edits to apps/api/src/core/event-bus.ts (TRC-02 invariant).
wrapEventBus(registry.getEventBus(), getTracer());

// Register billing hooks (auto-create Stripe customer on tenant.created)
registerBillingHooks(registry.getEventBus());

// Register example hooks (enqueue process-followup on example.created)
registerExampleHooks(registry.getEventBus());

// Get module routes for direct .use() chaining
const authRoutes = registry.getAuthRoutes();
const billingModule = registry.getLoaded().get("billing");
const billingApiRoutes = billingModule?.routes;

// Build app via chained .use() calls to preserve type inference for Eden Treaty.
// No `as any` casts -- each plugin is used directly in the chain.
const app = new Elysia()
  // Global error handling -- registered first
  .use(errorMiddleware)
  // Phase 19 D-22 — observability middleware (HTTP span + outbound traceparent + x-request-id)
  // mounts BEFORE requestTraceMiddleware so the span is open for the whole hook chain.
  .use(observabilityMiddleware)
  // Request tracing — generates per-request logger; requestId now sourced from ALS (D-23)
  .use(requestTraceMiddleware)
  // (Phase 19 D-10/D-22 — Phase 12 locale middleware DELETED. Cookie-to-locale
  //  parsing happens in the Bun.serve fetch wrapper below, seeding ALS once
  //  per request.)
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

// Phase 19 D-01/D-12 — Bun.serve fetch wrapper is the single ALS seed point for
// every HTTP request. Elysia runs inside `obsContext.run(...)` so every log line,
// span, and error-capture inside the handler sees the same ObservabilityContext.
Bun.serve({
  port: env.PORT,
  fetch(req, server) {
    const remoteAddr = server.requestIP(req)?.address ?? "";
    const cookieHeader = req.headers.get("cookie");
    const locale = parseNextLocaleCookie(cookieHeader) ?? defaultLocale;
    const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const { traceId, spanId, inboundCarrier } = decideInboundTrace(req, remoteAddr);
    return obsContext.run(
      { requestId, traceId, spanId, locale, tenantId: null, userId: null, inboundCarrier },
      () => app.handle(req),
    );
  },
});

logger.info({ port: env.PORT, role: env.INSTANCE_ROLE }, "Baseworks API started");

// Export app type for Eden Treaty (used by @baseworks/api-client)
export type App = typeof app;
