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
 * the physical core count; past cores you just thrash). Downscaling is graceful
 * on POSIX: a removed child gets SIGTERM, drains in-flight requests (index.ts
 * shutdown), then exits — with a SIGKILL backstop if it hangs. NOTE: on Windows
 * there is no real SIGTERM; Bun maps kill("SIGTERM") to a hard terminate, so the
 * graceful-drain guarantee holds on Linux (production), not Windows dev.
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
let paused = false; // crash-loop pause — halts ALL respawns (incl. ensureFloor/scaleTick)
let lastScaleAt = 0;

// Scaling decisions use the LIVE (accepting-traffic) count, NOT children.size —
// a draining child has already called server.stop() so it takes no new traffic.
// Counting it would let a second downscale drain the last live worker → 0 listeners.
function liveCount(): number {
  let n = 0;
  for (const c of children.values()) if (!c.draining) n++;
  return n;
}

// Crash-loop detection over a sliding 60s window (avoids monotonic accumulation
// of sporadic crashes over long uptime falsely tripping the pause).
const crashTimes: number[] = [];
function recordCrash(): number {
  const now = Date.now();
  crashTimes.push(now);
  const cutoff = now - 60_000;
  while (crashTimes.length > 0 && crashTimes[0] < cutoff) crashTimes.shift();
  return crashTimes.length;
}

function spawnChild(): void {
  if (shuttingDown || paused) return;
  const id = nextId++;
  const startedAt = Date.now();
  const proc = Bun.spawn(["bun", "run", ENTRY], {
    env: {
      ...process.env,
      INSTANCE_ROLE: "api",
      // Mark as a supervised child so index.ts self-terminates if orphaned, and
      // give it a drain budget strictly LESS than our SIGKILL deadline (DRAIN_MS)
      // so a cleanly-draining child always self-exits before we force-kill it.
      CLUSTER_CHILD: "1",
      SHUTDOWN_DRAIN_MS: String(Math.max(1000, DRAIN_MS - 3000)),
    },
    stdout: "inherit",
    stderr: "inherit",
    onExit(_proc, code, signal) {
      const child = children.get(id);
      children.delete(id);
      if (shuttingDown) return;
      if (child?.draining) {
        log("child drained + exited", { id, live: liveCount() });
        return;
      }
      // Unexpected exit — crash. Protect against tight crash loops.
      const lived = Date.now() - startedAt;
      log("child exited unexpectedly", { id, code, signal, livedMs: lived, live: liveCount() });
      if (lived < 3000) {
        const recent = recordCrash();
        if (recent >= MAX * 3) {
          paused = true; // halts ensureFloor + scaleTick respawns during the pause
          log("crash loop detected — pausing respawns for 30s", { recentCrashes: recent });
          setTimeout(() => {
            paused = false;
            crashTimes.length = 0;
            ensureFloor();
          }, 30_000);
          return;
        }
        setTimeout(ensureFloor, 1000); // brief backoff before respawn
        return;
      }
      ensureFloor();
    },
  });
  children.set(id, { id, proc, startedAt, draining: false });
  log("spawned child", { id, pid: proc.pid, live: liveCount() });
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

/** Respawn until the LIVE pool is back to at least MIN (covers crash/drain losses). */
function ensureFloor(): void {
  while (!shuttingDown && !paused && liveCount() < MIN) spawnChild();
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
  if (shuttingDown || paused) return;
  ensureFloor();
  const util = cpuUtilization();
  const live = liveCount(); // decide on live (accepting-traffic) count, not draining
  const cooled = Date.now() - lastScaleAt >= COOLDOWN_MS;
  const pct = Math.round(util * 100);
  if (util >= CPU_HIGH && live < MAX && cooled) {
    log("scaling up", { cpuPct: pct, from: live, to: live + 1 });
    spawnChild();
    lastScaleAt = Date.now();
  } else if (util <= CPU_LOW && live > MIN && cooled) {
    log("scaling down", { cpuPct: pct, from: live, to: live - 1 });
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
