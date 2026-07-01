/**
 * API cluster supervisor — vertical scaling on a single machine.
 *
 * Spawns a pool of API worker PROCESSES (not JS threads — Bun runs JS single-
 * threaded per process) that all bind the same PORT via SO_REUSEPORT (see
 * `reusePort: true` in index.ts). The kernel load-balances TCP connections across
 * them, so scaling = spawning/killing processes, no userland proxy.
 *
 * It autoscales on CPU utilization (portable, computed from os.cpus() deltas —
 * works on Linux and Windows), within [CLUSTER_MIN, CLUSTER_MAX] (max defaults to
 * the physical core count; past cores you just thrash). Downscaling is graceful:
 * a removed child gets SIGTERM, drains in-flight requests (index.ts shutdown),
 * then exits — with a SIGKILL backstop if it hangs.
 *
 * Run: `bun run apps/api/src/supervisor.ts` (or the `cluster` package script).
 *
 * Env knobs:
 *   CLUSTER_MIN            floor process count (default 1)
 *   CLUSTER_MAX            ceiling (default = CPU cores)
 *   CLUSTER_CPU_HIGH       scale-up threshold, 0..1 (default 0.70)
 *   CLUSTER_CPU_LOW        scale-down threshold, 0..1 (default 0.25)
 *   CLUSTER_SAMPLE_MS      how often to sample CPU + decide (default 5000)
 *   CLUSTER_COOLDOWN_MS    min gap between scale actions, anti-flap (default 15000)
 *   CLUSTER_DRAIN_MS       max wait for a child to drain before SIGKILL (default 25000)
 *   CLUSTER_ENTRY          child entrypoint (default ./index.ts — override for tests)
 */
import os from "node:os";
import path from "node:path";

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

const CORES = os.cpus().length || 1;
const MIN = clamp(Math.trunc(num(process.env.CLUSTER_MIN, 1)), 1, CORES);
const MAX = clamp(Math.trunc(num(process.env.CLUSTER_MAX, CORES)), MIN, CORES);
const CPU_HIGH = clamp(num(process.env.CLUSTER_CPU_HIGH, 0.7), 0.1, 1);
const CPU_LOW = clamp(num(process.env.CLUSTER_CPU_LOW, 0.25), 0, CPU_HIGH - 0.05);
const SAMPLE_MS = Math.max(1000, num(process.env.CLUSTER_SAMPLE_MS, 5000));
const COOLDOWN_MS = Math.max(0, num(process.env.CLUSTER_COOLDOWN_MS, 15_000));
const DRAIN_MS = Math.max(1000, num(process.env.CLUSTER_DRAIN_MS, 25_000));
const ENTRY = process.env.CLUSTER_ENTRY
  ? path.resolve(process.env.CLUSTER_ENTRY)
  : path.join(import.meta.dir, "index.ts");

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), scope: "supervisor", msg, ...extra }));

interface Child {
  id: number;
  proc: Bun.Subprocess;
  startedAt: number;
  draining: boolean;
}

const children = new Map<number, Child>();
let nextId = 1;
let shuttingDown = false;
let lastScaleAt = 0;
let recentCrashes = 0; // simple crash-loop guard

function spawnChild(): void {
  if (shuttingDown) return;
  const id = nextId++;
  const startedAt = Date.now();
  const proc = Bun.spawn(["bun", "run", ENTRY], {
    env: { ...process.env, INSTANCE_ROLE: "api" },
    stdout: "inherit",
    stderr: "inherit",
    onExit(_proc, code, signal) {
      const child = children.get(id);
      children.delete(id);
      if (shuttingDown) return;
      const graceful = child?.draining ?? false;
      if (graceful) {
        log("child drained + exited", { id, poolSize: children.size });
        return;
      }
      // Unexpected exit — crash. Protect against tight crash loops.
      const lived = Date.now() - startedAt;
      log("child exited unexpectedly", {
        id,
        code,
        signal,
        livedMs: lived,
        poolSize: children.size,
      });
      if (lived < 3000) {
        recentCrashes++;
        if (recentCrashes >= MAX * 3) {
          log("crash loop detected — pausing respawns for 30s", { recentCrashes });
          setTimeout(() => {
            recentCrashes = 0;
            ensureFloor();
          }, 30_000);
          return;
        }
        setTimeout(ensureFloor, 1000); // brief backoff before respawn
        return;
      }
      recentCrashes = 0;
      ensureFloor();
    },
  });
  children.set(id, { id, proc, startedAt, draining: false });
  log("spawned child", { id, pid: proc.pid, poolSize: children.size });
}

function drainOne(): void {
  // Remove the NEWEST non-draining child (least-warmed connections/caches).
  const candidate = [...children.values()]
    .filter((c) => !c.draining)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  if (!candidate) return;
  candidate.draining = true;
  log("draining child (SIGTERM)", { id: candidate.id, pid: candidate.proc.pid });
  candidate.proc.kill("SIGTERM");
  setTimeout(() => {
    if (children.has(candidate.id)) {
      log("child drain timed out — SIGKILL", { id: candidate.id });
      candidate.proc.kill("SIGKILL");
    }
  }, DRAIN_MS);
}

/** Respawn until the pool is back to at least MIN (covers crash losses). */
function ensureFloor(): void {
  while (!shuttingDown && children.size < MIN) spawnChild();
}

// CPU utilization across all cores, 0..1, from cumulative os.cpus() time deltas.
function cpuSample(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const t of Object.values(cpu.times)) total += t;
    idle += cpu.times.idle;
  }
  return { idle, total };
}
let lastCpu = cpuSample();
function cpuUtilization(): number {
  const now = cpuSample();
  const dIdle = now.idle - lastCpu.idle;
  const dTotal = now.total - lastCpu.total;
  lastCpu = now;
  if (dTotal <= 0) return 0;
  return clamp(1 - dIdle / dTotal, 0, 1);
}

function scaleTick(): void {
  if (shuttingDown) return;
  ensureFloor();
  const util = cpuUtilization();
  const size = children.size;
  const cooled = Date.now() - lastScaleAt >= COOLDOWN_MS;
  const pct = Math.round(util * 100);
  if (util >= CPU_HIGH && size < MAX && cooled) {
    log("scaling up", { cpuPct: pct, from: size, to: size + 1 });
    spawnChild();
    lastScaleAt = Date.now();
  } else if (util <= CPU_LOW && size > MIN && cooled) {
    log("scaling down", { cpuPct: pct, from: size, to: size - 1 });
    drainOne();
    lastScaleAt = Date.now();
  }
}

async function shutdown(sig: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log("supervisor shutting down — draining all children", { signal: sig, poolSize: children.size });
  for (const c of children.values()) c.proc.kill("SIGTERM");
  const deadline = Date.now() + DRAIN_MS;
  while (children.size > 0 && Date.now() < deadline) await Bun.sleep(200);
  for (const c of children.values()) {
    log("child did not drain in time — SIGKILL", { id: c.id });
    c.proc.kill("SIGKILL");
  }
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Boot the floor, then autoscale on an interval.
log("supervisor starting", {
  cores: CORES,
  min: MIN,
  max: MAX,
  cpuHigh: CPU_HIGH,
  cpuLow: CPU_LOW,
  sampleMs: SAMPLE_MS,
  entry: ENTRY,
});
for (let i = 0; i < MIN; i++) spawnChild();
setInterval(scaleTick, SAMPLE_MS);
