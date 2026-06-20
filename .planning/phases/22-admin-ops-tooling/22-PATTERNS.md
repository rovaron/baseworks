# Phase 22: Admin Ops Tooling — Pattern Map

**Mapped:** 2026-04-27
**Files analyzed:** 22 (new + modified)
**Analogs found:** 22 / 22

> Maps each Phase 22 file to its closest existing analog in the Baseworks
> codebase. Planner copies the excerpts below verbatim into PLAN action
> sections. Code-quality concerns (RBAC, CSP, env validation, ALS, raw db,
> i18n) are pre-decided here so plan steps stay one-liner action statements.

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `apps/api/src/routes/bull-board.ts` (NEW) | route plugin | request-response (HTML/asset proxy + RBAC) | `apps/api/src/routes/admin.ts:38-39` | role + flow |
| `apps/api/src/routes/health-detailed.ts` (NEW) | route plugin | request-response (JSON envelope + RBAC) | `apps/api/src/routes/admin.ts:321-349` | exact |
| `apps/api/src/core/health-aggregator.ts` (NEW) | service (aggregator) | parallel fan-out + cache | `packages/observability/src/lib/install-global-error-handlers.ts` (timeout/try-catch shape) + `apps/api/src/index.ts:100-133` (per-check try/catch) | role-match |
| `apps/api/src/core/error-tracker-ringbuffer.ts` (NEW) | wrapper / decorator | event-driven (decorator, in-mem buffer) | `packages/observability/src/wrappers/wrap-cqrs-bus.ts` (decorator preserves underlying surface) + `packages/observability/src/adapters/noop/noop-error-tracker.ts` (full ErrorTracker port shape) | role-match |
| `apps/api/src/core/registry.ts` (MOD) | registry extension | startup wiring | `apps/api/src/core/registry.ts:67-108` (`loadAll` collector loop) | self-extension |
| `apps/api/src/index.ts` (MOD) | bootstrap | route mounting + env probes | `apps/api/src/index.ts:80-170` (chained `.use()` + `requireRole` group) | self-extension |
| `apps/api/src/routes/admin.ts` (MOD — deprecated alias) | route plugin | request-response | `apps/api/src/routes/admin.ts:321-349` | self-extension |
| `apps/api/src/worker.ts` (MOD — heartbeat publisher) | worker bootstrap | scheduled background task + graceful shutdown | `apps/api/src/worker.ts:113-149` (Bun.serve health probe) + `apps/api/src/worker.ts:154-163` (shutdown handler) | self-extension |
| `packages/observability/src/instance-id.ts` (NEW) | utility | pure function | (no direct analog — closest is the resolver chain in `apps/api/src/lib/inbound-trace.ts` and `apps/api/src/lib/request-id.ts`) | role-match |
| `packages/observability/src/index.ts` (MOD — barrel export) | barrel | n/a | `packages/observability/src/index.ts:1-69` (existing pattern) | self-extension |
| `packages/shared/src/types/module.ts` (MOD) | type | n/a | `packages/shared/src/types/module.ts:10-41` (`JobDefinition` + `ModuleDefinition`) | self-extension |
| `packages/config/src/env.ts` (MOD) | env validator | startup validation | `packages/config/src/env.ts:33-48` (z.enum default) + `:189-196` (`assertRedisUrl`) | self-extension |
| `.env.example` (MOD) | config doc | n/a | `.env.example` `WORKER_HEALTH_PORT` block | self-extension |
| `apps/admin/src/routes/jobs.tsx` (NEW) | React route component | request-response (iframe wrapper) | `apps/admin/src/routes/system/health.tsx:60-94` (loading/error/Card pattern) | role-match |
| `apps/admin/src/routes/system/health.tsx` (MOD — replace) | React route component | polling (React Query) | `apps/admin/src/routes/system/health.tsx:60-255` (entire file is the pattern) | self-extension |
| `apps/admin/src/layouts/admin-layout.tsx` (MOD — nav entry) | layout | n/a | `apps/admin/src/layouts/admin-layout.tsx:36-41` (`navItems` array) | self-extension |
| `apps/admin/src/lib/router.ts` (MOD — register `/jobs`) | route table | n/a | `apps/admin/src/lib/router.ts:1-22` (lazy children pattern) | self-extension |
| `apps/admin/vite.config.ts` (MOD — proxy entry) | build config | proxy | `apps/admin/vite.config.ts:13-21` (existing `/api` proxy) | self-extension |
| `packages/i18n/src/locales/en/admin.json` (MOD) | i18n | n/a | `packages/i18n/src/locales/en/admin.json:140-173` (existing `systemHealth.*` block) | self-extension |
| `packages/i18n/src/locales/pt-BR/admin.json` (MOD) | i18n | n/a | (parallel keys to `en/admin.json`) | self-extension |
| Tests: `apps/api/test/admin-bull-board.test.ts`, `health-detailed.test.ts`, `worker-heartbeat.test.ts` | integration test | n/a | `apps/api/src/__tests__/admin-auth.test.ts:1-79` (Elysia + `app.handle(new Request(...))` pattern) | role-match |
| Tests: `apps/api/src/core/__tests__/health-aggregator.test.ts`, `error-tracker-ringbuffer.test.ts` | unit test | n/a | `apps/api/src/core/__tests__/registry.test.ts:1-80` (bun:test, `describe`/`it`/`expect`) | role-match |
| Tests: `apps/admin/src/routes/jobs.test.tsx`, `system/health-detailed.test.tsx` | UI test | n/a | (no React component test in admin yet — use Vitest + `@testing-library/react` per CLAUDE.md; build new) | NO ANALOG |

---

## Pattern Assignments

### `apps/api/src/routes/bull-board.ts` (NEW — route plugin, request-response)

**Analog:** `apps/api/src/routes/admin.ts` (lines 38-39 + general plugin shape)

**Imports pattern** (`apps/api/src/routes/admin.ts:1-7`):
```typescript
import { Elysia, t } from "elysia";
import { createDb, organization, user, member, billingCustomers } from "@baseworks/db";
import { env } from "@baseworks/config";
import { requireRole } from "@baseworks/module-auth";
import { eq, like, or, count } from "drizzle-orm";
import { logger } from "../lib/logger";
```
For `bull-board.ts`, swap drizzle imports for:
```typescript
import { Elysia } from "elysia";
import { env } from "@baseworks/config";
import { requireRole } from "@baseworks/module-auth";
import { ElysiaAdapter } from "@bull-board/elysia";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
```

**Plugin + RBAC mount pattern** (`apps/api/src/routes/admin.ts:38-39`):
```typescript
export const adminRoutes = new Elysia({ prefix: "/api/admin" })
  .use(requireRole("owner"))
  // ... routes
```
Copy verbatim — replace `prefix: "/api/admin"` with the bull-board plugin root.
For bull-board the official adapter exposes `serverAdapter.registerPlugin()` which
returns an Elysia plugin; the file's outer shape is:
```typescript
export const bullBoardRoutes = new Elysia({ name: "bull-board" })
  .use(requireRole("owner"))
  .use(serverAdapter.registerPlugin());
```

**CSP `frame-ancestors` post-handle hook** — no direct analog; new responsibility.
Closest pattern is the `Set-Cookie` append in `apps/api/src/index.ts:228-246`:
```typescript
response.headers.append(
  "Set-Cookie",
  "NEXT_LOCALE=; Max-Age=0; Path=/",
);
```
Use the same `headers.append` (or `set`) idiom inside an Elysia `.onAfterHandle` to
write `Content-Security-Policy: frame-ancestors '${env.ADMIN_URL ?? "'none'"}'`.

---

### `apps/api/src/routes/health-detailed.ts` (NEW — route plugin, request-response)

**Analog:** `apps/api/src/routes/admin.ts:321-349` (current `/system/health`)

**Full handler pattern to mirror** (`apps/api/src/routes/admin.ts:321-349`):
```typescript
.get("/system/health", async () => {
    const health: Record<string, any> = {
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };

    // Check Redis connectivity if Redis is available
    if (env.REDIS_URL) {
      try {
        const redis = await getHealthRedis(env.REDIS_URL);
        const info = await redis.info("memory");
        const usedMemoryMatch = info.match(/used_memory_human:(\S+)/);
        health.redis = {
          connected: true,
          usedMemory: usedMemoryMatch?.[1] || "unknown",
        };
      } catch {
        healthRedis = null;
        health.redis = { connected: false, error: "Failed to connect" };
      }
    } else {
      health.redis = { connected: false, error: "REDIS_URL not configured" };
    }

    return { data: health };
  });
```
Notes:
- Per-section try/catch isolates a failing dependency (do not let one bad probe
  500 the whole endpoint).
- Returns `{ data: ... }` envelope (matches D-07 contract).
- Reads `process.uptime()`, ISO timestamp via `new Date().toISOString()`.

**File shape** (new file follows the same plugin pattern as bull-board.ts):
```typescript
export const healthDetailedRoutes = new Elysia({ name: "health-detailed" })
  .use(requireRole("owner"))
  .get("/health/detailed", async () => {
    const result = await registry.getHealthAggregator().aggregate();
    return { data: result };
  });
```

---

### `apps/api/src/core/health-aggregator.ts` (NEW — service, parallel fan-out)

**Analog (closest):** `apps/api/src/index.ts:100-133` (per-check try/catch, latency
measurement) + `packages/observability/src/lib/install-global-error-handlers.ts`
(bounded `flush(2000)` timeout)

**Per-check probe pattern** (`apps/api/src/index.ts:103-110`):
```typescript
const dbStart = performance.now();
try {
  await db.execute(sql`SELECT 1`);
  checks.database = { status: "up", latency_ms: Math.round(performance.now() - dbStart) };
} catch (err) {
  checks.database = { status: "down", error: "Failed to connect" };
}
```
Use this exact shape for the **DB-lag built-in contributor** (D-07
`db.{connected, lagMs, status}`).

**Bounded timeout pattern** (`packages/observability/src/lib/install-global-error-handlers.ts:35-37`):
```typescript
tracker.captureException(err, { extra: { handler: kind } });
await tracker.flush(2000);
```
Apply `Promise.race([contributor.check(), timeout(2000)])` per contributor;
catch + return `{ status: "unhealthy", details: { error: <stringified> } }`.

**Worst-of-N rollup helper** — no codebase analog; specified directly in CONTEXT
D-10. Inline in this file:
```typescript
function rollup(results: HealthCheckResult[]): "healthy" | "degraded" | "unhealthy" {
  if (results.some(r => r.status === "unhealthy")) return "unhealthy";
  if (results.some(r => r.status === "degraded")) return "degraded";
  return "healthy";
}
```

**Cache (5s)** — no codebase analog. Use plain module-scope variable + timestamp:
```typescript
let cached: { at: number; data: AggregateResult } | null = null;
const CACHE_TTL_MS = 5_000;
// in aggregate(): if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;
```
Mirrors the cached-Redis-connection pattern in `apps/api/src/routes/admin.ts:23-36`.

---

### `apps/api/src/core/error-tracker-ringbuffer.ts` (NEW — decorator)

**Analog:** `packages/observability/src/wrappers/wrap-cqrs-bus.ts:57-80`
(decorator preserving underlying interface) +
`packages/observability/src/adapters/noop/noop-error-tracker.ts:34-80` (full
`ErrorTracker` port shape)

**Decorator pattern** (`wrap-cqrs-bus.ts:62-80`):
```typescript
const origExecute = bus.execute.bind(bus);
const origQuery = bus.query.bind(bus);

(bus as BusLike).execute = async (
  command: string,
  input: unknown,
  ctx: unknown,
) => {
  // ... pre-work
  try {
    return await origExecute(command, input, ctx);
  } catch (err) {
    span.recordException(err);
    // ... capture + rethrow
  }
};
```
Apply the same shape to wrap `tracker.captureException`: store the original,
override with a function that pushes to the ring buffer **and** delegates to
the original. `flush`, `withScope`, `addBreadcrumb`, `captureMessage` pass
through unchanged.

**Port surface** (`noop-error-tracker.ts:34-80`):
```typescript
export class NoopErrorTracker implements ErrorTracker {
  readonly name = "noop";
  captureException(_err: unknown, _scope?: CaptureScope): void {}
  captureMessage(_message: string, _level?: LogLevel): void {}
  addBreadcrumb(_breadcrumb: Breadcrumb): void {}
  withScope<T>(fn: (scope: ErrorTrackerScope) => T): T {
    return fn(new NoopScope());
  }
  async flush(_timeoutMs?: number): Promise<boolean> { return true; }
}
```
The new `RingBufferingErrorTracker` implements the same `ErrorTracker`
interface, holds an inner tracker + a fixed-size buffer (50), and exposes a
`drain(): RecentError[]` accessor for `health-aggregator.ts` to consume.

**Dedup key** — message + first stack frame, computed inside `captureException`:
```typescript
const stack = err instanceof Error ? (err.stack ?? "") : "";
const firstFrame = stack.split("\n")[1] ?? "";
const key = `${(err as Error)?.message ?? String(err)}::${firstFrame}`;
```

---

### `apps/api/src/core/registry.ts` (MOD — collect `def.health`)

**Analog:** self — extend the existing `loadAll()` collector loop at lines 67-108.

**Existing collector pattern** (`apps/api/src/core/registry.ts:86-94`):
```typescript
// Register commands
for (const [key, handler] of Object.entries(def.commands ?? {})) {
  this.cqrs.registerCommand(key, handler);
}

// Register queries
for (const [key, handler] of Object.entries(def.queries ?? {})) {
  this.cqrs.registerQuery(key, handler);
}
```
Add immediately after, mirroring the same `def.X ?? {}` defensive shape:
```typescript
// Register health contributor (Phase 22 / OPS-04)
if (def.health) {
  this.healthAggregator.register(def.health);
}
```

**Getter pattern** (`apps/api/src/core/registry.ts:171-189`):
```typescript
/** Returns the CqrsBus instance used by this registry. */
getCqrs(): CqrsBus {
  return this.cqrs;
}

/** Returns the TypedEventBus instance used by this registry. */
getEventBus(): TypedEventBus {
  return this.eventBus;
}
```
Add `getHealthAggregator(): HealthAggregator { return this.healthAggregator; }`
in the same getter cluster.

**Constructor instantiation pattern** (`apps/api/src/core/registry.ts:51-55`):
```typescript
constructor(config: RegistryConfig) {
  this.config = config;
  this.cqrs = new CqrsBus();
  this.eventBus = new TypedEventBus();
}
```
Add: `this.healthAggregator = new HealthAggregator();`.

---

### `apps/api/src/index.ts` (MOD — mount new plugins)

**Analog:** self — extend the chained `.use()` composition at lines 80-170.

**Existing mount pattern** (`apps/api/src/index.ts:80-170`):
```typescript
const app = new Elysia()
  .use(errorMiddleware)
  .use(observabilityMiddleware)
  .use(requestTraceMiddleware)
  .use(cors({ /* ... */ }))
  .use(swagger())
  .get("/health", async () => { /* unauth Docker probe */ })
  .use(authRoutes ?? new Elysia())
  .use(tenantMiddleware)
  // ...
  .use(adminRoutes)
  .group("/api", (group) =>
    group
      .use(requireRole("owner"))
      .delete("/tenant", (ctx: any) => { /* ... */ }),
  )
```
Insert **after** `/health` and **before** `tenantMiddleware` (per CONTEXT
"Integration Points" — neither new plugin needs tenant context):
```typescript
.use(bullBoardRoutes)
.use(healthDetailedRoutes)
```

**Validation hook pattern** (`apps/api/src/index.ts:45-49`):
```typescript
validatePaymentProviderEnv();
validateObservabilityEnv();
installGlobalErrorHandlers(getErrorTracker());
```
No new validator function added; both new env vars piggy-back on the existing
zod schema in `packages/config/src/env.ts` (crash-hard at import time).

---

### `apps/api/src/routes/admin.ts` (MOD — deprecated alias)

**Analog:** self — replace the body of `/system/health` (lines 321-349) with a
forward to `/health/detailed`. Keep the route + signature for Eden Treaty
client backwards compatibility (D-07).

Copy the existing handler shape; replace body with:
```typescript
.get("/system/health", async () => {
  const result = await registry.getHealthAggregator().aggregate();
  return {
    data: result,
    deprecated: true,
    deprecation: "Use /health/detailed. Removed in v1.4.",
  };
});
```

---

### `apps/api/src/worker.ts` (MOD — heartbeat publisher)

**Analog:** self — extend `worker.ts` after `loadAll()` (line 39) and inside
the existing `shutdown()` (lines 154-163).

**Bun.serve background server pattern** (`apps/api/src/worker.ts:113-149`):
```typescript
const healthServer = Bun.serve({
  port: WORKER_HEALTH_PORT,
  fetch: async (req) => { /* ... */ },
});

logger.info({ port: WORKER_HEALTH_PORT }, "Worker health server started");
```
Heartbeat does **not** start an HTTP server — it starts a `setInterval`. Use
the same "construct after `loadAll()`, log a startup line" rhythm.

**Shutdown handler pattern** (`apps/api/src/worker.ts:154-163`):
```typescript
async function shutdown() {
  logger.info("Worker shutting down...");
  healthServer.stop();
  await Promise.all(workers.map((w) => w.close()));
  await closeConnection();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```
Add `clearInterval(heartbeatTimer)` and best-effort `redis.del(key)` BEFORE
`closeConnection()`.

**Redis usage pattern** (`apps/api/src/worker.ts:124-128`):
```typescript
const { getRedisConnection } = await import("@baseworks/queue");
const redis = getRedisConnection(redisUrl);
await redis.ping();
```
Heartbeat publisher uses **the same** `getRedisConnection(redisUrl)` (CONTEXT
note: heartbeat does NOT use `wrapQueue` — that would mint orphan span trees
per Phase 20 D-02).

**Per-iteration try/catch + warn-not-throw pattern** (`apps/api/src/worker.ts:75-87`):
```typescript
worker.on("failed", (job, err) => {
  logger.error({ /* ... */ }, "Job failed");
  getErrorTracker().captureException(err, { /* ... */ });
});
```
Heartbeat publisher applies the same posture: log warn on Redis hiccup, do NOT
crash the worker (CONTEXT D-14).

---

### `packages/observability/src/instance-id.ts` (NEW — utility, pure function)

**Analog:** No exact analog. Closest resolver-chain shape is in
`apps/api/src/lib/inbound-trace.ts` (function chooses among inputs and falls back).

**Resolution pattern (CONTEXT D-12 specifies the order):**
```typescript
import os from "node:os";

/** Resolve a stable instance ID for heartbeat publishing. */
export function resolveInstanceId(): string {
  return process.env.INSTANCE_ID
    ?? process.env.HOSTNAME
    ?? os.hostname();
}
```
Pure function, no side effects, no env validation (env vars optional). Direct
read of `process.env` mirrors `packages/observability/src/factory.ts:16` header
note ("This file reads `process.env` directly").

---

### `packages/observability/src/index.ts` (MOD — barrel export)

**Analog:** self — append to existing barrel.

**Existing pattern** (`packages/observability/src/index.ts:62-69`):
```typescript
export {
  obsContext,
  getObsContext,
  setTenantContext,
  setSpan,
  setLocale,
} from "./context";
export type { ObservabilityContext } from "./context";
```
Append:
```typescript
// Instance ID resolver (Phase 22 / EXT-02 / D-12)
export { resolveInstanceId } from "./instance-id";
```

---

### `packages/shared/src/types/module.ts` (MOD — add health slot)

**Analog:** self — extend `ModuleDefinition` (lines 28-41).

**Existing type pattern** (`packages/shared/src/types/module.ts:10-41`):
```typescript
export interface JobDefinition {
  /** BullMQ queue name, conventionally `module:action` (e.g., `email-send`). */
  queue: string;
  /** Async function that processes the job payload. */
  handler: (data: unknown) => Promise<void>;
}

export interface ModuleDefinition {
  name: string;
  routes?: ((app: any) => any) | any;
  commands?: Record<string, CommandHandler<any, any>>;
  queries?: Record<string, QueryHandler<any, any>>;
  jobs?: Record<string, JobDefinition>;
  events?: string[];
}
```
Append (CONTEXT D-10 verbatim shape):
```typescript
export interface HealthCheckResult {
  status: "healthy" | "degraded" | "unhealthy";
  details?: Record<string, unknown>;
}

export interface HealthContributor {
  /** Typically the module name; required so the aggregator can label results. */
  name: string;
  check: () => Promise<HealthCheckResult>;
  /** Per-contributor timeout. Defaults to 2000ms. */
  timeoutMs?: number;
}
```
Add to `ModuleDefinition`:
```typescript
  /** Optional health contributor — registered into the central aggregator at loadAll(). */
  health?: HealthContributor;
```

---

### `packages/config/src/env.ts` (MOD — add 2 env vars)

**Analog:** self — extend `serverSchema` at lines 33-48.

**Existing default-string-enum pattern** (`packages/config/src/env.ts:33-38`):
```typescript
TRACER: z.enum(["noop"]).optional().default("noop"),
METRICS_PROVIDER: z.enum(["noop"]).optional().default("noop"),
ERROR_TRACKER: z
  .enum(["noop", "pino", "sentry", "glitchtip"])
  .optional()
  .default("pino"),
```
Use this shape for `BULL_BOARD_READ_ONLY` (D-02):
```typescript
BULL_BOARD_READ_ONLY: z.enum(["true", "false"]).default("true"),
```

**Existing coerced-number pattern** (`packages/config/src/env.ts:13`):
```typescript
PORT: z.coerce.number().default(3000),
```
And `:47`:
```typescript
WORKER_HEALTH_PORT: z.coerce.number().default(3001),
```
Use this shape for `WORKER_HEARTBEAT_INTERVAL_MS` (D-13):
```typescript
WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().min(1000).max(300_000).default(15_000),
```

No new `validate*Env()` function needed — Zod min/max + enum will crash at
import time if the value is out of range, which matches the established
crash-hard discipline (CONTEXT "Established Patterns").

---

### `.env.example` (MOD — append two new vars)

**Analog:** self — follow the existing block style (`# WORKER_HEALTH_PORT` block,
top of file in already-read excerpt above).

**Existing block pattern** (`.env.example` `WORKER_HEALTH_PORT` block):
```
# Worker health check port (optional, default 3001)
WORKER_HEALTH_PORT=3001
```
Append (after the observability vars, before payments):
```
# Bull-board read-only mode (default "true" — flip to "false" only on a
# deployment where operators need to retry/promote/remove jobs).
BULL_BOARD_READ_ONLY=true

# Worker heartbeat publish interval in ms (default 15000, min 1000, max 300000).
# TTL on heartbeat keys is 2× this value; "stale" threshold is 2×, "dead" is 5×.
WORKER_HEARTBEAT_INTERVAL_MS=15000
```

---

### `apps/admin/src/routes/jobs.tsx` (NEW — iframe wrapper page)

**Analog:** `apps/admin/src/routes/system/health.tsx` (UI patterns: loading
skeleton, error card, retry button, i18n).

**Loading + error + content shape** (`apps/admin/src/routes/system/health.tsx:60-94`):
```typescript
export function Component() {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">{t("systemHealth.title")}</h1>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground mb-4">
              {t("systemHealth.loadError")}
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              {tc("retry")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  // ...
}
```
For `jobs.tsx`, the only difference is no React Query — local
`useState<{ loading, error }>` driven by iframe `onLoad`/`onError`. UI shell
(h1, Card, Button, Skeleton) is unchanged.

**Module-export pattern for lazy loading** — `system/health.tsx` exports
`Component` (named export) so `router.ts` can do
`lazy: () => import("../routes/system/health")`. Match this:
```typescript
export function Component() { /* ... */ }
```

**Iframe attributes (UI-SPEC §`/jobs` route):**
```tsx
<iframe
  src="/admin/bull-board"
  title={t("jobs.iframeTitle")}
  className="h-[calc(100vh-3.5rem-6rem)] w-full border-0 rounded-md"
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
  onLoad={() => setLoading(false)}
  onError={() => setError(true)}
/>
```

---

### `apps/admin/src/routes/system/health.tsx` (MOD — replace API + extend UI)

**Analog:** self — extend the existing file. Most of the structure stays.

**React Query polling pattern** (`apps/admin/src/routes/system/health.tsx:64-76`):
```typescript
const {
  data: result,
  isLoading,
  error,
  refetch,
} = useQuery({
  queryKey: ["admin", "system", "health"],
  queryFn: async () => {
    const res = await api.api.admin.system.health.get();
    return res.data;
  },
  refetchInterval: 30000,
});
```
Change `queryFn` to call the Eden Treaty path for the new `/health/detailed`
route — likely `api["health/detailed"].get()` or whatever Eden derives. Bump
`queryKey` to `["admin", "health-detailed"]` to avoid cache collision.

**Status enum → Badge variant** (`apps/admin/src/routes/system/health.tsx:38-53`):
```typescript
function getStatusVariant(
  status: string,
): "default" | "secondary" | "destructive" {
  switch (status) {
    case "healthy":
      return "default";
    case "degraded":
    case "warning":
      return "secondary";
    case "unhealthy":
    case "critical":
      return "destructive";
    default:
      return "secondary";
  }
}
```
Extend with `stale → secondary`, `dead → destructive`, `unknown → outline`
per UI-SPEC §Color "Status → Badge variant mapping".

**Card + grid skeleton** (`apps/admin/src/routes/system/health.tsx:96-108`):
```typescript
if (isLoading) {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <h1 className="text-2xl font-semibold">{t("systemHealth.title")}</h1>
      <Skeleton className="h-24" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
      <span className="sr-only">{tc("loading")}</span>
    </div>
  );
}
```
Reuse verbatim, append a workers/db/errors/modules row of skeletons.

**Per-queue Card pattern** (`apps/admin/src/routes/system/health.tsx:152-184`):
```tsx
<Card key={queue.name}>
  <CardHeader className="pb-2">
    <div className="flex items-center justify-between">
      <CardTitle className="text-sm font-medium">{queue.name}</CardTitle>
      <Badge variant={getStatusVariant(status)}>{status}</Badge>
    </div>
  </CardHeader>
  <CardContent>
    <div className="grid grid-cols-2 gap-2 text-sm">
      <div>
        <p className="text-muted-foreground">{t("systemHealth.queueMetrics.waiting")}</p>
        <p className="font-medium">{queue.waiting ?? 0}</p>
      </div>
      {/* active / completed / failed */}
    </div>
  </CardContent>
</Card>
```
Apply identical Card shape to **workers, modules, recent errors** sections —
just swap the inner metrics grid.

---

### `apps/admin/src/layouts/admin-layout.tsx` (MOD — append nav entry)

**Analog:** self — extend `navItems` array at lines 36-41.

**Existing pattern** (`apps/admin/src/layouts/admin-layout.tsx:31, 36-41`):
```typescript
import { Building2, Users, CreditCard, Activity, LogOut, ChevronUp } from "lucide-react";
// ...
const navItems = [
  { titleKey: "nav.tenants", icon: Building2, href: "/tenants" },
  { titleKey: "nav.users", icon: Users, href: "/users" },
  { titleKey: "nav.billing", icon: CreditCard, href: "/billing" },
  { titleKey: "nav.system", icon: Activity, href: "/system" },
];
```
Add `ListTodo` to the `lucide-react` import; append:
```typescript
{ titleKey: "nav.jobs", icon: ListTodo, href: "/jobs" },
```
Per CONTEXT D-06 the new entry sits **between** `system` and the user
dropdown — the array order above is the correct insertion point (last
position; user dropdown lives in `SidebarFooter`, not `navItems`).

---

### `apps/admin/src/lib/router.ts` (MOD — register `/jobs` route)

**Analog:** self — extend lazy children at lines 12-19.

**Existing pattern** (`apps/admin/src/lib/router.ts:12-19`):
```typescript
{ index: true, lazy: () => import("../routes/tenants/list") },
{ path: "tenants", lazy: () => import("../routes/tenants/list") },
{ path: "tenants/:id", lazy: () => import("../routes/tenants/detail") },
{ path: "users", lazy: () => import("../routes/users/list") },
{ path: "users/:id", lazy: () => import("../routes/users/detail") },
{ path: "billing", lazy: () => import("../routes/billing/overview") },
{ path: "system", lazy: () => import("../routes/system/health") },
```
Append:
```typescript
{ path: "jobs", lazy: () => import("../routes/jobs") },
```

> Note: CONTEXT mentions both `apps/admin/src/main.tsx` and `apps/admin/src/lib/router.ts`
> as integration points. The actual route table lives in `lib/router.ts` (verified above);
> `main.tsx` only renders `<App />`. Modify **`router.ts`** — `main.tsx` stays untouched.

---

### `apps/admin/vite.config.ts` (MOD — add proxy entry)

**Analog:** self — extend `server.proxy` at lines 13-21.

**Existing pattern** (`apps/admin/vite.config.ts:13-21`):
```typescript
server: {
  port: 5173,
  proxy: {
    "/api": {
      target: "http://localhost:3000",
      changeOrigin: true,
    },
  },
},
```
Append a sibling key:
```typescript
"/admin/bull-board": {
  target: "http://localhost:3000",
  changeOrigin: true,
  ws: true, // bull-board uses WebSocket polling
},
"/health/detailed": {
  target: "http://localhost:3000",
  changeOrigin: true,
},
```

---

### `packages/i18n/src/locales/en/admin.json` + `pt-BR/admin.json` (MOD)

**Analog:** self — extend `nav` and `systemHealth` blocks. New `jobs` block.

**Existing nav block** (`packages/i18n/src/locales/en/admin.json:6-11`):
```json
"nav": {
  "tenants": "Tenants",
  "users": "Users",
  "billing": "Billing",
  "system": "System"
},
```
Append `"jobs": "Job Monitor"` (en) / `"jobs": "Monitor de Jobs"` (pt-BR).

**Existing systemHealth block** (`packages/i18n/src/locales/en/admin.json:140-173`):
```json
"systemHealth": {
  "title": "System Health",
  "loadError": "Failed to load data. Check the API server status and try again.",
  "status": { "healthy": "Healthy", "degraded": "Degraded", "unhealthy": "Unhealthy" },
  "statusMessages": { "healthy": "...", "degraded": "...", "unhealthy": "..." },
  "queues": "Queues",
  "queueMetrics": {
    "waiting": "Waiting", "active": "Active", "completed": "Completed", "failed": "Failed"
  },
  "redis": { /* ... */ },
  "apiServer": { "title": "API Server", "loadedModules": "Loaded modules" }
}
```
Append all keys per UI-SPEC §"New i18n keys (admin namespace)" — the
`workers`, `db`, `recentErrors`, `modules`, `queueMetrics.delayed`, `errors.*`,
and `refreshNow` / `updatedAgo` / `updatedJustNow` keys; plus a new
top-level `jobs` block.

Translate the same keys into `pt-BR/admin.json` (UI-SPEC provides the pt-BR
strings inline).

---

## Shared Patterns

### S-1. RBAC: `requireRole("owner")` plugin composition

**Source:** `apps/api/src/routes/admin.ts:38-39`
**Apply to:** `bull-board.ts`, `health-detailed.ts`
```typescript
export const xRoutes = new Elysia({ name: "x" })
  .use(requireRole("owner"))
  // ... routes
```
Single `.use(requireRole("owner"))` on the parent plugin covers every child
route + asset (CONTEXT D-03 verified for static assets via integration test).

---

### S-2. Cross-tenant queries use **raw `db`**, never `scopedDb`

**Source:** `apps/api/src/routes/admin.ts:21`
**Apply to:** `health-detailed.ts` (DB-lag probe), `health-aggregator.ts` (any
DB-touching contributor)
```typescript
const db = createDb(env.DATABASE_URL);
```
**Never** wrap operator-scope queries with `scopedDb(db, tenantId)` — Phase
20.1 D-07 reinforced this. The `/health/detailed` and `/admin/bull-board` are
operator-only views; tenant scoping would corrupt results.

---

### S-3. Crash-hard env validation at boot

**Source:** `packages/config/src/env.ts:33-48` (Zod schema) +
`packages/config/src/env.ts:117-180` (`validateObservabilityEnv`)
**Apply to:** `BULL_BOARD_READ_ONLY`, `WORKER_HEARTBEAT_INTERVAL_MS`
- Zod handles enum + min/max → throws at module import time on bad value.
- No new `validate*Env()` function unless cross-var conditional logic
  (none for Phase 22 — both vars are self-validating).

---

### S-4. Per-check try/catch, never let one failure 500 the response

**Source:** `apps/api/src/index.ts:103-110` + `apps/api/src/routes/admin.ts:328-346`
**Apply to:** `health-aggregator.ts` (every contributor), bull-board CSP hook
```typescript
try {
  /* probe */
  result = { status: "up", ... };
} catch {
  result = { status: "down", error: "Failed to connect" };
}
```
Aggregator extends this with `Promise.race([probe, timeout(2000)])` per
contributor (CONTEXT D-11).

---

### S-5. ALS / observability context inheritance — do not mint orphan spans

**Source:** CONTEXT canonical_refs §Phase 20 + `apps/api/src/index.ts:212-251`
**Apply to:** `worker.ts` heartbeat publisher, `bull-board.ts`, `health-detailed.ts`
- `bull-board` and `/health/detailed` inherit obsContext automatically
  through the existing `observabilityMiddleware` mounted in `index.ts:85`.
- The **heartbeat publisher** must use raw `redis.set(...)`, NOT `wrapQueue` —
  the `setInterval` runs outside any request context, so wrapping would
  produce orphan span trees.

---

### S-6. i18n through `useTranslation("admin")` / `useTranslation("common")`

**Source:** `apps/admin/src/routes/system/health.tsx:61-62`
**Apply to:** `jobs.tsx`, updated `system/health.tsx`
```typescript
const { t } = useTranslation("admin");
const { t: tc } = useTranslation("common");
```
**Zero hardcoded English** in `.tsx` files (UI-SPEC §Copywriting Contract).
The `Retry` CTA uses the existing shared `common.retry` key (UI-SPEC note —
do not introduce a new key for this).

---

### S-7. React Query polling: `refetchInterval: 30000`

**Source:** `apps/admin/src/routes/system/health.tsx:75`
**Apply to:** updated `system/health.tsx` only (jobs.tsx has no API call)
```typescript
useQuery({ queryKey: [...], queryFn: ..., refetchInterval: 30000 });
```
Stale-while-revalidate is React Query's default — matches UI-SPEC
§"Polling, Loading, and Refresh Mechanics".

---

### S-8. Bun.serve + graceful shutdown for background process

**Source:** `apps/api/src/worker.ts:113-149` + `:154-163`
**Apply to:** `worker.ts` heartbeat publisher
- Start the heartbeat **after** `registry.loadAll()` (line 39 of worker.ts).
- Cleanup ordering inside `shutdown()`: `clearInterval` → optional
  `redis.del(key)` → existing `closeConnection()`.

---

### S-9. Test pattern: bun:test + Elysia `app.handle(new Request(...))`

**Source:** `apps/api/src/__tests__/admin-auth.test.ts:38-79`
**Apply to:** `admin-bull-board.test.ts`, `health-detailed.test.ts`
```typescript
import { describe, test, expect, beforeAll } from "bun:test";
import { Elysia } from "elysia";

let app: any;
beforeAll(() => {
  app = new Elysia().use(errorMiddleware).use(targetRoutes);
});

test("rejects unauthenticated", async () => {
  const response = await app.handle(
    new Request("http://localhost/path", { method: "GET" }),
  );
  expect([401, 403]).toContain(response.status);
});
```
Mirror the static `ENDPOINTS` array shape for parameterized RBAC sweeps
(esp. for bull-board static-asset 401/403 coverage per CONTEXT D-03).

---

### S-10. Test pattern: ModuleRegistry unit test

**Source:** `apps/api/src/core/__tests__/registry.test.ts:1-80`
**Apply to:** `health-aggregator.test.ts`, `error-tracker-ringbuffer.test.ts`
```typescript
import { describe, expect, it, spyOn } from "bun:test";
// ...
describe("HealthAggregator", () => {
  it("rolls up worst-of-N", async () => {
    const agg = new HealthAggregator();
    agg.register({ name: "a", check: async () => ({ status: "healthy" }) });
    agg.register({ name: "b", check: async () => ({ status: "unhealthy" }) });
    expect((await agg.aggregate()).status).toBe("unhealthy");
  });
});
```

---

## No Analog Found

| File | Role | Why no analog |
|---|---|---|
| `apps/admin/src/routes/jobs.test.tsx` | UI test (Vitest + RTL) | No React component test exists in `apps/admin` yet. CLAUDE.md §Development Tools mandates Vitest + `@testing-library/react` for the admin app. Build new — there is no in-repo precedent to copy. |
| `apps/admin/src/routes/system/health-detailed.test.tsx` | UI test (Vitest + RTL) | Same as above. Both new tests should establish the admin Vitest harness. |

For both, the planner should reference CLAUDE.md technology stack
(`Vitest ^2.0+`, `@testing-library/react ^16.0+`) and adopt Vitest's standard
`describe`/`it`/`expect` + `render` / `screen` API.

---

## Metadata

**Analog search scope:**
- `apps/api/src/routes/`, `apps/api/src/core/`, `apps/api/src/__tests__/`,
  `apps/api/src/index.ts`, `apps/api/src/worker.ts`
- `apps/admin/src/routes/`, `apps/admin/src/layouts/`,
  `apps/admin/src/lib/`, `apps/admin/vite.config.ts`,
  `apps/admin/src/main.tsx`, `apps/admin/src/App.tsx`
- `packages/observability/src/` (ports, adapters, wrappers, lib, factory, index)
- `packages/shared/src/types/`, `packages/config/src/`,
  `packages/queue/src/`, `packages/i18n/src/locales/en/`
- `.env.example`

**Files scanned (load-bearing reads):** 18

**Pattern extraction date:** 2026-04-27
