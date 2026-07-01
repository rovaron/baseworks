# Vertical scaling (single machine)

Baseworks is a **modular monolith**: one binary, run as multiple **processes** (not JS threads — Bun runs JS single-threaded per process). Two independently-scaled process pools:

| Pool | Role | Scales | How |
|------|------|--------|-----|
| **API** | `INSTANCE_ROLE=api` | HTTP / route throughput | N processes sharing `PORT` via SO_REUSEPORT |
| **Worker** | `INSTANCE_ROLE=worker` | background jobs | M processes (or per-worker BullMQ `concurrency`) pulling one Redis queue |

## API pool — the cluster supervisor

`Bun.serve` sets `reusePort: true`, so multiple API processes bind the same `PORT` and the **kernel load-balances** TCP connections across them — no userland proxy. The supervisor (`apps/api/src/supervisor.ts`) spawns/kills those processes and autoscales them.

```bash
bun run cluster          # instead of `bun run api` — spawns + autoscales the API pool
```

Autoscaling is CPU-driven (portable, from `os.cpus()` deltas), bounded by `[CLUSTER_MIN, CLUSTER_MAX]` (max defaults to physical core count — past cores you only thrash). Scale-up on high CPU, scale-down on low, with a cooldown to avoid flapping. **Downscaling is graceful**: a removed process gets `SIGTERM`, drains in-flight requests (the `index.ts` shutdown handler waits, then closes the DB/Redis pools), and exits — with a `SIGKILL` backstop if it hangs. Crashed processes are respawned to hold the floor (with crash-loop protection).

### Env knobs

| Var | Default | Meaning |
|-----|---------|---------|
| `CLUSTER_MIN` | `1` | floor process count |
| `CLUSTER_MAX` | CPU cores | ceiling (clamped to cores) |
| `CLUSTER_CPU_HIGH` | `0.70` | scale-up threshold (0..1 across all cores) |
| `CLUSTER_CPU_LOW` | `0.25` | scale-down threshold |
| `CLUSTER_SAMPLE_MS` | `5000` | sample + decide interval |
| `CLUSTER_COOLDOWN_MS` | `15000` | min gap between scale actions |
| `CLUSTER_DRAIN_MS` | `25000` | max drain wait before `SIGKILL` |
| `SHUTDOWN_DRAIN_MS` | `25000` | per-process hard-exit safety timeout (index.ts) |

> **Event-loop lag** is a better scale signal than CPU for an I/O-bound server, but it requires per-process reporting; CPU is a good, portable v1. Swap in a lag signal in `scaleTick()` later if needed.

## Worker pool

Run the BullMQ workers as their own processes:

```bash
INSTANCE_ROLE=worker bun run worker   # run K of these; or raise a job's `concurrency`
```

BullMQ is built for this — multiple workers pull the same Redis queue. Repeatable/scheduled jobs use `upsertJobScheduler` (idempotent by key), so running many workers won't duplicate them. A *true* singleton task would need a Redis leader-lock — don't run it per-process.

## The real vertical-scaling wall: Postgres connections

Each process opens its own pool (`DB_POOL_MAX`, default **10**). `(N api + M worker) × pool` must stay under Postgres `max_connections` (~100 default). So:

- Keep per-process pools small (drop `DB_POOL_MAX` to 5–8 when running many processes).
- Past ~8–10 processes, put **PgBouncer (transaction mode)** in front — hundreds of app connections multiplex onto a small server pool. RLS uses `SET app.tenant_id` *inside each transaction*, so **transaction-mode pooling is compatible** (session mode is not required). See the PgBouncer setup in the deploy docs.

## Notes

- **Stateless** — sessions live in Postgres; SSE fans out via Redis pub/sub — so any process can serve any request. No sticky sessions needed.
- **bull-board** is per-process; pin it to one process/role (or behind the proxy) to avoid N dashboards.
- Observability is per-process and role-tagged (`baseworks-api` / `baseworks-worker`); aggregate by service.
- If a single **module** gets hot, `INSTANCE_ROLE` + the registry's `modules` config let you run a pool serving only that module — same binary, subset config — without leaving the monolith.
