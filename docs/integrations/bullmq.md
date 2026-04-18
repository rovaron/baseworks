# BullMQ

## Overview

BullMQ is the job queue Baseworks uses for asynchronous work — email sends, webhook processing, and module-level follow-up jobs. Queues and workers are constructed via helpers in `packages/queue/src/index.ts`. Modules declare job handlers inside their `ModuleDefinition.jobs` map, and the worker process (`apps/api/src/worker.ts`) auto-starts one BullMQ `Worker` per declared job. No module has to manage its own worker lifecycle.

## Upstream Documentation

- [BullMQ documentation](https://docs.bullmq.io)
- [BullMQ job options](https://docs.bullmq.io/guide/jobs/job-options)
- [BullMQ worker concurrency](https://docs.bullmq.io/guide/workers/concurrency)

## Setup

### Env vars

| Env var | Required | Purpose |
| --- | --- | --- |
| `REDIS_URL` | yes for `worker` or `all` roles | BullMQ's backing Redis. `assertRedisUrl(role, redisUrl)` throws at startup when the role requires Redis but the URL is absent. |
| `WORKER_HEALTH_PORT` | no (default `3001`) | HTTP port for the worker process's liveness endpoint. |

### Module wire-up

Modules declare jobs in their `ModuleDefinition.jobs` map — see [add-a-module.md](../add-a-module.md) §"Step 6" for the step-by-step. Each entry is `"module:action": { queue: "module:action", handler }`. The worker process iterates every loaded module's `def.jobs` and calls `createWorker(...)` once per entry (`apps/api/src/worker.ts:32-77`). No manual worker registration is required for the default case.

### Smoke test

```bash
bun docker:up
bun worker
# From another shell, trigger a command that enqueues a job, e.g., a password reset:
curl -X POST http://localhost:3000/api/auth/forget-password \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

The worker logs `Worker started for job` for every registered job on boot. After an enqueue, it logs `Job started` and `Job completed` (or `Job handler error` on exception) — see `apps/api/src/worker.ts:43-51` for the child-logger pattern.

## Wiring in Baseworks

### Queue defaults

`createQueue(name, redisUrl)` in `packages/queue/src/index.ts:14-29` returns a BullMQ `Queue` preconfigured with the Baseworks defaults:

- `removeOnComplete.age = 259200` (3 days)
- `removeOnFail.age = 604800` (7 days)
- `attempts = 3`
- `backoff = { type: "exponential", delay: 1000 }`

Callers can construct a `Queue` directly with their own `defaultJobOptions` when a job needs different retention or retry semantics, but the defaults suit most module jobs.

### Worker defaults

`createWorker(name, processor, redisUrl, opts?)` in `packages/queue/src/index.ts:39-51` returns a BullMQ `Worker` with `concurrency: 5` and an inline processor. The inline processor is a hard constraint on Bun — sandboxed processors (processors passed as file paths) are broken on the Bun runtime.

### Queue naming convention

Every queue name follows `module:action`. Current queues in the repo:

- `email:send` — auth and billing modules enqueue here; the billing module's `sendEmail` worker drains it.
- `billing:process-webhook` — the billing webhook route enqueues normalized events for async processing.
- `example:process-followup` — the example module's demonstration queue.

Names are used verbatim as the BullMQ queue name AND as the job-map key in `ModuleDefinition.jobs`. Keeping them identical makes the wiring greppable from any call site.

### Worker entrypoint flow

The worker process in `apps/api/src/worker.ts:32-77` iterates every loaded module's `def.jobs` and starts one `createWorker(...)` per entry. Each worker wraps the handler in a structured child logger so job starts, completions, and errors carry the queue name and job ID.

```mermaid
sequenceDiagram
  participant Cmd as Command handler
  participant Q as BullMQ Queue
  participant Redis
  participant W as BullMQ Worker
  participant H as Job handler

  Cmd->>Q: ctx.enqueue("example:process-followup", payload)
  Q->>Redis: persist job
  W->>Redis: poll / pop
  Redis-->>W: job
  W->>H: handler(job.data)
  alt success
    H-->>W: resolve
    W->>Redis: removeOnComplete after 3 days
  else error (transient)
    H-->>W: throw
    W->>Redis: reschedule with exponential backoff
    Note over W,Redis: up to 3 attempts; then removeOnFail after 7 days
  end
```

Cite `apps/api/src/worker.ts:32-77` for the worker entrypoint loop and `packages/queue/src/index.ts:14-51` for the `createQueue` and `createWorker` helpers.

## Gotchas

- **Sandboxed workers are broken on Bun.** BullMQ's sandboxed-processor mode (processor as a file path) does not work under the Bun runtime. All processors are declared inline as JavaScript functions in the main worker process — see `packages/queue/src/index.ts:32-38`. Do not pass a processor file path to `createWorker`.
- **Redis connection sharing.** `getRedisConnection(redisUrl)` in `packages/queue/src/connection.ts` memoizes an `ioredis` instance per URL. Do not construct ad-hoc `new IORedis(...)` connections alongside it; let BullMQ use the shared connection so socket leaks do not accumulate across modules.
- **`ctx.enqueue` is optional.** `HandlerContext.enqueue` is declared as `Promise<void> | undefined`. Test contexts receive a no-op via the mock factory; production command handlers invoke `await ctx.enqueue?.(...)` — the optional chaining preserves type safety if a future context skips queue wiring entirely.
- **Worker health check is independent of readiness.** The worker process starts a separate `Bun.serve` on `WORKER_HEALTH_PORT` (default 3001) for liveness probes (`apps/api/src/worker.ts:84-125`). A healthy Redis plus at least one registered worker returns `"status": "ok"`; Redis down or zero workers returns `"status": "degraded"`.

## Extending

### Add a new queue + worker + job type

1. Write a job handler function with signature `(data: unknown) => Promise<void>` in your module. Reference: `packages/modules/example/src/jobs/process-followup.ts` (log-only demo) or `packages/modules/billing/src/jobs/send-email.ts` (real dispatcher). Validate `data` at the top of the handler — the payload crosses the app ↔ Redis trust boundary, and TypeScript types on `job.data` are not enforced by Redis.
2. In your module's `index.ts`, add the job to the `jobs` map:

   ```typescript
   // Module definition — jobs map entry
   jobs: {
     "yourmodule:action": {
       queue: "yourmodule:action",
       handler: yourHandler,
     },
   },
   ```

3. Ensure your module name is listed in the `modules` array in `apps/api/src/worker.ts:21-24` so the worker process loads it. No separate worker-registration call is required — `apps/api/src/worker.ts:32-77` iterates all `def.jobs` automatically on boot.
4. Enqueue from a command handler: `await ctx.enqueue?.("yourmodule:action", payload)`. The enqueue flows through `HandlerContext.enqueue`, which `ModuleRegistry` wires to `createQueue(queueName, redisUrl).add(...)`.
5. If your job needs non-default BullMQ options (custom retention, custom attempts, scheduled delivery), construct the queue directly with `new Queue(...)` and your own `defaultJobOptions` instead of relying on the auto-created `createQueue` instance.

## Security

- Job payloads cross the app ↔ Redis trust boundary. Validate the payload shape at the top of the handler. Never trust that a job retrieved from Redis has the shape your TypeScript types claim; a malicious or corrupt payload could trigger unexpected behavior otherwise.
- Workers run with the worker role's env vars. If a job handler needs tenant-scoped database access, derive `scopedDb(tenantId)` inside the handler from a `tenantId` field in the job payload — the request-time `ctx.db` is not available inside a worker.
- Retention defaults (3-day complete, 7-day fail) are designed to aid debugging. Adjust `removeOnComplete` / `removeOnFail` for jobs whose payloads contain sensitive data so history is pruned on the tighter schedule you need.

## Dashboard (optional)

Bull Board and bull-monitor are optional dashboards for queue visibility. Neither is wired in the current codebase. See [Bull Board](https://github.com/felixmosh/bull-board) if a deployment needs an operational UI for queue inspection and retry. Adding one is a mount-plus-auth exercise — deferred until an operational need drives it.

## Next steps

- [Email integration](./email.md) — the `email:send` queue and its `sendEmail` dispatcher.
- [Billing integration](./billing.md) — the `billing:process-webhook` queue and the webhook-enqueue route.
- [Add a module](../add-a-module.md) — where module-level jobs are declared in `ModuleDefinition.jobs`.
