import "./telemetry";
import {
  assertRlsConfigured,
  env,
  validateObservabilityEnv,
  validatePaymentProviderEnv,
} from "@baseworks/config";
import { closeDb, getDb, getRlsDb, scopedDb, withTenant } from "@baseworks/db";
import { defaultLocale } from "@baseworks/i18n";
import { authRoutes, promoteConfiguredAdmins, requirePermission } from "@baseworks/module-auth";
import {
  billingRoutes,
  billingWebhookRoutes,
  registerBillingHooks,
} from "@baseworks/module-billing";
import { exampleRoutes, registerExampleHooks } from "@baseworks/module-example";
import { filesRoutes, registerFilesHooks } from "@baseworks/module-files";
import { notificationRoutes } from "@baseworks/module-notifications";
import {
  getErrorTracker,
  getTracer,
  installGlobalErrorHandlers,
  obsContext,
  RingBufferingErrorTracker,
  readHeartbeats,
  wrapCqrsBus,
  wrapEventBus,
} from "@baseworks/observability";
import { closeConnection, getRedisConnection } from "@baseworks/queue";
import type { HandlerContext } from "@baseworks/shared";
import { validateStorageEnv } from "@baseworks/storage";
import cors from "@elysiajs/cors";
import swagger from "@elysiajs/swagger";
import {
  context,
  ROOT_CONTEXT,
  type SpanContext,
  SpanStatusCode,
  TraceFlags,
  trace,
} from "@opentelemetry/api";
import { Queue } from "bullmq";
import { sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { errorMiddleware } from "./core/middleware/error";
import { observabilityMiddleware } from "./core/middleware/observability";
import { requestTraceMiddleware } from "./core/middleware/request-trace";
import { tenantMiddleware } from "./core/middleware/tenant";
import { ModuleRegistry } from "./core/registry";
import { decideInboundTrace } from "./lib/inbound-trace";
import { hasNextLocaleCookie, parseNextLocaleCookie } from "./lib/locale-cookie";
import { logger } from "./lib/logger";
import { readRequestId } from "./lib/request-id";
import { adminRoutes } from "./routes/admin";
import { createBullBoardPlugin } from "./routes/bull-board";
import { createHealthDetailedPlugin } from "./routes/health-detailed";

// Create database instance — shared process-wide singleton pool (api-multiple-db-pools).
const db = getDb(env.DATABASE_URL);

// Validate payment provider env vars at startup (T-10-09)
// Prevents starting with PAYMENT_PROVIDER=pagarme but no PAGARME_SECRET_KEY
validatePaymentProviderEnv();
// Phase 18 — crash-hard on missing DSN for the selected ERROR_TRACKER (D-09).
validateObservabilityEnv();
// Phase 24 — crash-hard on missing storage adapter env or production-local (D-13/D-14).
validateStorageEnv();
// Tenant RLS — crash-hard in production if the RLS-role connection is unset
// (request paths would otherwise fall back to the RLS-bypassing owner pool).
assertRlsConfigured(env.NODE_ENV, env.DATABASE_URL_RLS);
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
  modules: ["auth", "billing", "example", "files", "notifications"],
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

// Phase 26 / QUO-01 — register files hooks (seed tenant_storage_usage row on
// tenant.created, ON CONFLICT DO NOTHING; resilient, never crashes tenant creation)
registerFilesHooks(registry.getEventBus());

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
    const perQueue = await Promise.all(
      moduleQueues.map(async (q): Promise<"healthy" | "degraded" | "unhealthy"> => {
        try {
          const counts = await q.getJobCounts("waiting");
          const waiting = counts.waiting ?? 0;
          if (waiting >= 1000) return "unhealthy";
          if (waiting >= 100) return "degraded";
          return "healthy";
        } catch {
          return "unhealthy";
        }
      }),
    );
    let worst: "healthy" | "degraded" | "unhealthy" = "healthy";
    for (const status of perQueue) {
      if (status === "unhealthy") worst = "unhealthy";
      else if (status === "degraded" && worst === "healthy") worst = "degraded";
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
  moduleStatuses: () => new Map<string, "healthy" | "degraded" | "unhealthy" | "unknown">(),
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
  // Health check -- no auth, no tenant context required.
  // Kept intentionally minimal (status + uptime only) so the unauthenticated
  // Docker/LB probe does not leak the loaded-module list or dependency topology
  // (health-public-exposes-module-list). The full dependency/module breakdown
  // lives behind the requirePlatformAdmin-gated /health/detailed endpoint.
  .get("/health", () => ({
    status: "ok",
    uptime: Math.round(process.uptime()),
  }))
  // Phase 22 / OPS-01 — bull-board mount (RBAC owner-only, CSP, readOnly env-driven).
  // Mounts AFTER /health (Docker probe stays unauthenticated) and BEFORE auth/tenant
  // middleware: bull-board owns its own auth derive via requirePlatformAdmin, and is
  // operator-scope (not tenant-scope) so it must not require a tenant context.
  .use(bullBoardPlugin)
  // Phase 22 / OPS-03 — /health/detailed endpoint at API root (NOT under /api/admin/)
  // per D-08. Mounted AFTER bullBoardPlugin and BEFORE authRoutes so it sits in the
  // operator-scope band: same RBAC discipline as bull-board, no tenant context required.
  .use(healthDetailedPlugin)
  // Auth routes -- mounted BEFORE tenant middleware so signup/login/OAuth
  // callbacks do NOT require tenant context (D-16). Static-chained as the
  // concrete plugin so its route types reach Eden Treaty's App inference.
  .use(authRoutes)
  // Public Stripe webhook -- mounted in the PRE-TENANT band (alongside authRoutes)
  // so unauthenticated provider callbacks are NOT rejected by the tenant derive
  // (billing-webhook-mounted-inside-tenant-scope). The tenant-scoped billing
  // commands/queries stay in billingApiRoutes, mounted after the handlerCtx derive.
  .use(billingWebhookRoutes)
  // Tenant-scoped routes group -- requires authenticated session
  .use(tenantMiddleware)
  .derive({ as: "scoped" }, (ctx: any) => {
    const tenantId: string = ctx.tenantId;
    const handlerCtx: HandlerContext = {
      tenantId,
      userId: ctx.userId,
      db: scopedDb(db, tenantId),
      // RLS-scoped transaction executor for this request's tenant. Runs DB work
      // on the baseworks_rls (non-owner) pool with app.tenant_id set
      // transaction-locally, so Postgres RLS constrains every statement to
      // ctx.tenantId regardless of WHERE clauses.
      withTenant: <T>(fn: (tx: any) => Promise<T>) => withTenant(getRlsDb(), tenantId, fn),
      // Forward the live request headers so session-bound better-auth calls
      // (auth commands/queries via auth.api.*) can resolve the caller (C2).
      headers: ctx.request.headers,
      emit: (event: string, data: unknown) =>
        registry.getEventBus().emit(event, {
          ...(typeof data === "object" && data !== null ? data : { data }),
          _requestId: ctx.requestId,
        }),
    };
    // Phase 27 / ATT-01, ATT-02 — wire the cross-module dispatch channel. The
    // closure references the SAME handlerCtx object, so a dispatched command
    // receives a fully-formed context (dispatch included) and nested dispatch
    // works. String dispatch through the bus is NOT a module import, so the
    // cross-module-import ban (Phase 26 SC#5 / Phase 29 files<->auth) stays green.
    handlerCtx.dispatch = (command: string, input: unknown) =>
      registry.getCqrs().execute(command, input, handlerCtx);
    return { handlerCtx };
  })
  // Billing HTTP routes (tenant-scoped commands/queries). Static-chained as the
  // concrete plugin so its route types reach Eden Treaty's App inference.
  .use(billingRoutes)
  // Admin API routes (cross-tenant, owner-only)
  .use(adminRoutes)
  // Owner-only route: delete tenant (per D-13, TNNT-04).
  // Dispatches the real auth:delete-tenant command with the tenant-scoped
  // handlerCtx (which now carries the request session headers), so better-auth's
  // deleteOrganization runs and the `tenant.deleted` domain event is emitted
  // (api-delete-tenant-noop / tenant-delete-route-stub-returns-success).
  .group("/api", (group) =>
    group.use(requirePermission("organization", "delete")).delete("/tenant", async (ctx: any) => {
      const tenantId: string = ctx.tenantId;
      const result = await registry
        .getCqrs()
        .execute<{ deleted: true }>(
          "auth:delete-tenant",
          { organizationId: tenantId },
          ctx.handlerCtx,
        );
      if (!result.success) {
        ctx.set.status = 500;
        return { success: false, error: result.error };
      }
      return { deleted: true, tenantId };
    }),
  )
  // Phase 29 / IDA-01 — GET /api/profile (tenant-scoped, any authenticated
  // member). Dispatches auth:get-profile with the scoped handlerCtx so its
  // dispatch channel is present and avatarUrl resolves via files:list-for-record
  // + files:get-read-url (zero auth<->files import). Eden type: api.api.profile.get().
  .group("/api", (group) =>
    group.get("/profile", async (ctx: any) => {
      const result = await registry.getCqrs().execute<{
        id: string;
        name: string | null;
        email: string;
        image: string | null;
        emailVerified: boolean;
        createdAt: Date;
        avatarUrl: string | null;
      }>("auth:get-profile", {}, ctx.handlerCtx);
      if (!result.success) {
        ctx.set.status = 401;
        return { error: result.error };
      }
      return result.data;
    }),
  )
  // Tenant-scoped module route plugins (example, files, notifications).
  // Static-chained as concrete Elysia plugins -- NOT via a runtime registry loop
  // -- so each module's route types flow into App for Eden Treaty inference.
  // They stay in the tenant-scoped band (after tenantMiddleware + handlerCtx
  // derive) because their handlers read the tenant-scoped context. The registry
  // still governs jobs/commands/events at runtime; it no longer attaches routes.
  //
  // COUPLING: this chain must stay in sync with the `modules` config above.
  // Route mounting is now static (Eden types require it), so removing a module
  // from `modules` no longer removes its routes. To disable a module, remove BOTH
  // its `modules` entry AND its `.use(...Routes)` line here. (Routes call their
  // commands directly, so a mismatch degrades jobs/event-subscribers, not routes.)
  .use(exampleRoutes)
  .use(filesRoutes)
  .use(notificationRoutes);

// Phase 19 D-01/D-12 — Bun.serve fetch wrapper is the single ALS seed point for
// every HTTP request. Elysia runs inside `obsContext.run(...)` so every log line,
// span, and error-capture inside the handler sees the same ObservabilityContext.
//
// Phase 20.1 D-11 — wrap `obsContext.run(...)` inside `context.with(otelCtx, ...)`
// where otelCtx carries a synthetic OTel SpanContext built from the same
// {traceId, spanId} the ALS frame is seeded with. Downstream `tracer.startSpan`
// and `propagation.inject(context.active(), ...)` then naturally inherit
// obsContext.traceId end-to-end (producer span, BullMQ carrier, worker log line).
const server = Bun.serve({
  port: env.PORT,
  // SO_REUSEPORT — lets multiple API processes bind the same PORT so the kernel
  // load-balances TCP connections across them. This is what makes vertical scaling
  // work: run N processes (see supervisor.ts) and add/remove them without a proxy.
  reusePort: true,
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
    const localeCookieNeedsClear = parsedLocale === null && hasNextLocaleCookie(cookieHeader);
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
              response.headers.append("Set-Cookie", "NEXT_LOCALE=; Max-Age=0; Path=/");
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

// Bootstrap platform admins from ADMIN_EMAILS (B3). Non-blocking — promotes the
// configured operator emails to user.role = "admin" once at startup. Idempotent.
void promoteConfiguredAdmins(db).catch((e) =>
  logger.error({ err: String(e) }, "[startup] admin bootstrap failed"),
);

// Graceful shutdown (api-no-graceful-shutdown) — mirror worker.ts:176-189.
// On SIGTERM/SIGINT: stop accepting + drain in-flight requests, then close the
// Redis connection(s) and the postgres.js pool before exiting, so rolling
// deploys don't drop requests or leak connections. Guarded against double
// invocation so a second signal can't re-enter teardown mid-flight.
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("API shutting down...");
  // Safety net: if draining hangs (a request never completes), force-exit so a
  // downscale/deploy can't block forever. The supervisor's own SIGKILL timeout is
  // a second backstop; this keeps a standalone process from hanging too.
  const forceExit = setTimeout(
    () => {
      logger.warn("API shutdown drain timed out; forcing exit");
      process.exit(0);
    },
    Number(process.env.SHUTDOWN_DRAIN_MS ?? 25_000),
  );
  forceExit.unref?.();
  try {
    // Stop accepting new connections and let in-flight requests DRAIN (no arg =
    // graceful; `stop(true)` would force-close active requests). This is what makes
    // downscaling a process safe — in-flight requests complete before we tear down.
    await server.stop();
    // Close Redis (shared queue connection) then the DB pool. Order matters:
    // drain the server first so nothing else issues queries/commands.
    await closeConnection();
    await closeDb();
  } catch (err) {
    logger.error({ err: String(err) }, "Error during API shutdown");
  } finally {
    clearTimeout(forceExit);
    process.exit(0);
  }
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Cluster orphan guard: when spawned by the supervisor (CLUSTER_CHILD=1), self-
// terminate if the parent dies — otherwise a SIGKILLed supervisor would leave us
// bound to the shared reusePort socket as a zombie, and a fresh supervisor would
// stack MORE processes on top. On POSIX, ppid becomes 1 (reparented to init) when
// the parent dies; we detect the change and drain out cleanly.
if (process.env.CLUSTER_CHILD) {
  const parentPid = process.ppid;
  const orphanWatch = setInterval(() => {
    if (process.ppid !== parentPid) {
      logger.warn({ parentPid, ppid: process.ppid }, "cluster supervisor gone — self-terminating");
      clearInterval(orphanWatch);
      void shutdown();
    }
  }, 2000);
  orphanWatch.unref?.();
}

// Export app type for Eden Treaty (used by @baseworks/api-client)
export type App = typeof app;
