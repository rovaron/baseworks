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
import { Queue } from "bullmq";
import { getRedisConnection } from "@baseworks/queue";
import { createBullBoardPlugin } from "./routes/bull-board";
import { logger } from "./lib/logger";
import {
  getErrorTracker,
  getTracer,
  installGlobalErrorHandlers,
  obsContext,
  readHeartbeats,
  RingBufferingErrorTracker,
  wrapCqrsBus,
  wrapEventBus,
} from "@baseworks/observability";
import { validateStorageEnv } from "@baseworks/storage";
import { createHealthDetailedPlugin } from "./routes/health-detailed";
import { defaultLocale } from "@baseworks/i18n";
import { parseNextLocaleCookie, hasNextLocaleCookie } from "./lib/locale-cookie";
import { decideInboundTrace } from "./lib/inbound-trace";
import { readRequestId } from "./lib/request-id";
import {
  context,
  ROOT_CONTEXT,
  type SpanContext,
  SpanStatusCode,
  TraceFlags,
  trace,
} from "@opentelemetry/api";

// Create database instance
const db = createDb(env.DATABASE_URL);

// Validate payment provider env vars at startup (T-10-09)
// Prevents starting with PAYMENT_PROVIDER=pagarme but no PAGARME_SECRET_KEY
validatePaymentProviderEnv();
// Phase 18 — crash-hard on missing DSN for the selected ERROR_TRACKER (D-09).
validateObservabilityEnv();
// Phase 24 — crash-hard on missing storage adapter env or production-local (D-13/D-14).
validateStorageEnv();
// Phase 22 / D-15 — wrap the env-selected ErrorTracker in a ring buffer so the
// /health/detailed endpoint (Plan 22-05) can surface a process-local rolling window
// of recent errors without needing a Sentry/GlitchTip API token. Capacity 50 entries
// (~30 KB/process). Inner tracker still receives every captureException/captureMessage
// — this decorator is a side-buffer, NOT a redirect.
const errorTracker = new RingBufferingErrorTracker(getErrorTracker(), 50);
// Phase 18 D-02 — register global uncaughtException + unhandledRejection handlers.
installGlobalErrorHandlers(errorTracker);

// Create module registry -- auth module loaded alongside example
const registry = new ModuleRegistry({
  role: env.INSTANCE_ROLE as "api" | "worker" | "all",
  modules: ["auth", "billing", "example"],
});

// Load all configured modules
await registry.loadAll();

// Phase 18 D-01 — wrap the CqrsBus so thrown handler exceptions are captured.
// External wrapper; zero edits to apps/api/src/core/cqrs.ts (D-01 invariant).
// Phase 22 D-15 — pass the ring-buffered tracker so CQRS-source errors flow into
// the /health/detailed envelope.
wrapCqrsBus(registry.getCqrs(), errorTracker);
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

// Phase 22 / OPS-01 / Pitfall 10 — collect all module-registered queue names and construct
// read-only Queue references for bull-board to introspect. The API process does NOT run
// BullMQ Workers (those live in worker.ts); we only construct Queue handles for inspection.
const moduleQueues: Queue[] = [];
if (env.REDIS_URL) {
  const redisConnection = getRedisConnection(env.REDIS_URL);
  const seenQueues = new Set<string>();
  for (const [, def] of registry.getLoaded()) {
    if (!def.jobs) continue;
    for (const jobDef of Object.values(def.jobs)) {
      if (seenQueues.has(jobDef.queue)) continue;
      seenQueues.add(jobDef.queue);
      moduleQueues.push(new Queue(jobDef.queue, { connection: redisConnection }));
    }
  }
} else {
  logger.warn("REDIS_URL not configured — bull-board will mount with zero queues");
}
const bullBoardPlugin = await createBullBoardPlugin(moduleQueues);

// Phase 22 / OPS-04 — register built-in contributors with the aggregator owned by
// the registry. Each contributor reports a HealthCheckResult; the aggregator
// performs a parallel fan-out and worst-of-N rollup that surfaces in
// /health/detailed's `data.status`. Module-supplied contributors (def.health)
// were already registered during registry.loadAll(); these four cover the
// cross-cutting infra signals every fork's operator wants.
const aggregator = registry.getHealthAggregator();

// DB lag probe — round-trip latency from SELECT 1 (D-07 db.{connected,lagMs,status}).
// healthy < 500ms; degraded ≥ 500ms; unhealthy on connection failure.
aggregator.register({
  name: "db",
  timeoutMs: 1000,
  check: async () => {
    const start = performance.now();
    try {
      await db.execute(sql`SELECT 1`);
      const lagMs = Math.round(performance.now() - start);
      return {
        status: lagMs < 500 ? "healthy" : "degraded",
        details: { connected: true, lagMs },
      };
    } catch (err) {
      return {
        status: "unhealthy",
        details: { connected: false, lagMs: null, error: String(err) },
      };
    }
  },
});

// Queue-depth contributor — overall status reflects the worst per-queue threshold breach.
// Mirrors the per-queue thresholds in /health/detailed (D-09 hardcoded warn=100, critical=1000).
aggregator.register({
  name: "queueDepth",
  check: async () => {
    let worst: "healthy" | "degraded" | "unhealthy" = "healthy";
    for (const q of moduleQueues) {
      try {
        const counts = await q.getJobCounts("waiting");
        const waiting = counts.waiting ?? 0;
        if (waiting >= 1000) worst = "unhealthy";
        else if (waiting >= 100 && worst === "healthy") worst = "degraded";
      } catch {
        worst = "unhealthy";
      }
    }
    return { status: worst };
  },
});

// Worker-heartbeat contributor — degraded if any heartbeat is stale, unhealthy if any
// is dead OR no heartbeats are reporting. Mirrors the freshness thresholds in
// /health/detailed (D-13: 2× / 5× heartbeat interval).
aggregator.register({
  name: "workerHeartbeat",
  check: async () => {
    if (!env.REDIS_URL) {
      return {
        status: "unhealthy",
        details: { error: "REDIS_URL not configured" },
      };
    }
    const redis = getRedisConnection(env.REDIS_URL);
    try {
      const heartbeats = await readHeartbeats(redis);
      if (heartbeats.length === 0) {
        return {
          status: "unhealthy",
          details: { error: "no workers reporting" },
        };
      }
      const intervalMs = env.WORKER_HEARTBEAT_INTERVAL_MS;
      const now = Date.now();
      let worst: "healthy" | "degraded" | "unhealthy" = "healthy";
      for (const hb of heartbeats) {
        const ageMs = now - new Date(hb.lastHeartbeat).getTime();
        if (ageMs >= 5 * intervalMs) worst = "unhealthy";
        else if (ageMs >= 2 * intervalMs && worst === "healthy") worst = "degraded";
      }
      return { status: worst, details: { count: heartbeats.length } };
    } catch (err) {
      return { status: "unhealthy", details: { error: String(err) } };
    }
  },
});

// Recent-errors contributor (D-15) — informational only. Buffer presence never
// drives status; operators read the `recentErrors` array in the envelope directly.
aggregator.register({
  name: "recentErrors",
  check: async () => ({
    status: "healthy",
    details: { count: errorTracker.snapshot().length },
  }),
});

// Phase 22 / OPS-03 — /health/detailed plugin (mounted in the app chain below).
// moduleStatuses() intentionally returns an empty Map for v1.3 — no module ships a
// HealthContributor in this phase, so every loaded module falls through to the D-16
// default ("healthy") at the endpoint. The aggregator's worst-of-N rollup IS still
// reflected in `data.status` (overall) and IS used by the four built-in contributors
// above. Wiring agg.contributors results into modules[].status (so a module's own
// contributor result shows up on its module card) is documented in CONTEXT 'Deferred
// Ideas' as a v1.4 follow-up. See 22-05-PLAN.md must_haves for the partial-OPS-04 note.
const healthDetailedPlugin = createHealthDetailedPlugin({
  aggregator,
  moduleQueues,
  redis: env.REDIS_URL ? getRedisConnection(env.REDIS_URL) : null,
  heartbeatIntervalMs: env.WORKER_HEARTBEAT_INTERVAL_MS,
  loadedModuleNames: () => registry.getLoadedNames(),
  moduleStatuses: () =>
    new Map<string, "healthy" | "degraded" | "unhealthy" | "unknown">(),
  recentErrorsSnapshot: () => errorTracker.snapshot(),
});

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
  // Phase 22 / OPS-01 — bull-board mount (RBAC owner-only, CSP, readOnly env-driven).
  // Mounts AFTER /health (Docker probe stays unauthenticated) and BEFORE auth/tenant
  // middleware: bull-board owns its own auth derive via requireRole, and is
  // operator-scope (not tenant-scope) so it must not require a tenant context.
  .use(bullBoardPlugin)
  // Phase 22 / OPS-03 — /health/detailed endpoint at API root (NOT under /api/admin/)
  // per D-08. Mounted AFTER bullBoardPlugin and BEFORE authRoutes so it sits in the
  // operator-scope band: same RBAC discipline as bull-board, no tenant context required.
  .use(healthDetailedPlugin)
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
//
// Phase 20.1 D-11 — wrap `obsContext.run(...)` inside `context.with(otelCtx, ...)`
// where otelCtx carries a synthetic OTel SpanContext built from the same
// {traceId, spanId} the ALS frame is seeded with. Downstream `tracer.startSpan`
// and `propagation.inject(context.active(), ...)` then naturally inherit
// obsContext.traceId end-to-end (producer span, BullMQ carrier, worker log line).
Bun.serve({
  port: env.PORT,
  fetch(req) {
    const cookieHeader = req.headers.get("cookie");
    const parsedLocale = parseNextLocaleCookie(cookieHeader);
    const locale = parsedLocale ?? defaultLocale;
    // Phase 20.1 WR-04 — when the inbound NEXT_LOCALE cookie is present but
    // unparseable (malformed escape OR unsupported locale), the request
    // safely falls back to defaultLocale here, but the bad cookie persists
    // in the browser. Without an explicit clear, every subsequent request
    // repeats the silent fallback and the user is stuck on defaultLocale
    // forever with no signal. Stamp the response with a clearing Set-Cookie
    // so the browser drops the bad value on the next round-trip.
    const localeCookieNeedsClear =
      parsedLocale === null && hasNextLocaleCookie(cookieHeader);
    const requestId = readRequestId(req);
    const { traceId, spanId } = decideInboundTrace(req);
    const reqSpanCtx: SpanContext = {
      traceId,
      spanId,
      traceFlags: TraceFlags.SAMPLED,
      isRemote: false,
    };
    const otelCtxWithReqSpan = trace.setSpanContext(ROOT_CONTEXT, reqSpanCtx);
    // Phase 20.1 D-18 / H-03 — try/catch around app.handle so 5xx paths in the
    // composed Elysia stack annotate the active OTel span with recordException +
    // setStatus(ERROR). Without this, errorMiddleware halts Elysia's onError
    // chain before observabilityMiddleware.onError fires, leaving HTTP 5xx
    // spans visible as green in Tempo. Pattern adapted from
    // packages/observability/src/wrappers/wrap-queue.ts:85-97. Re-throw
    // preserves Elysia's existing 500-response chain.
    return context.with(otelCtxWithReqSpan, () =>
      obsContext.run(
        { requestId, traceId, spanId, locale, tenantId: null, userId: null },
        async () => {
          let response: Response;
          try {
            response = await app.handle(req);
          } catch (err) {
            const active = trace.getActiveSpan();
            if (active) {
              active.recordException(err as Error);
              active.setStatus({ code: SpanStatusCode.ERROR });
            }
            throw err;
          }
          // Phase 20.1 WR-04 — append the clearing Set-Cookie. Use append (not
          // set) so any auth/session Set-Cookie already on the response is
          // preserved. Path=/ matches the cookie scope used by the Next.js
          // i18n integration; Max-Age=0 instructs the browser to delete it.
          if (localeCookieNeedsClear) {
            try {
              response.headers.append(
                "Set-Cookie",
                "NEXT_LOCALE=; Max-Age=0; Path=/",
              );
            } catch {
              // Headers are immutable on some Response shapes — rebuild.
              const headers = new Headers(response.headers);
              headers.append("Set-Cookie", "NEXT_LOCALE=; Max-Age=0; Path=/");
              response = new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers,
              });
            }
          }
          return response;
        },
      ),
    );
  },
});

logger.info({ port: env.PORT, role: env.INSTANCE_ROLE }, "Baseworks API started");

// Export app type for Eden Treaty (used by @baseworks/api-client)
export type App = typeof app;
