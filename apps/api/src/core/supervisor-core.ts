/**
 * Testable core of the API cluster supervisor (see apps/api/src/supervisor.ts for
 * the entrypoint that wires real Bun/OS dependencies to it).
 *
 * All side effects — spawning children, killing them, reading CPU, timers, logging
 * — are injected via `SupervisorDeps`, so every scaling decision and lifecycle
 * branch is deterministically unit-testable with fakes (no real processes/clock).
 */

/** A spawned child process, from the supervisor's point of view. */
export interface ChildHandle {
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}

/** A cancellable scheduled callback (setTimeout-shaped). */
export interface Timer {
  clear(): void;
}

export interface SupervisorDeps {
  /** Spawn a child; invoke `onExit` when it exits. Returns a handle to signal it. */
  spawn(
    env: Record<string, string>,
    onExit: (code: number | null, signal: string | null) => void,
  ): ChildHandle;
  /** Current time in ms (Date.now-shaped). */
  now(): number;
  /** CPU utilization in [0,1] across all cores since the previous call. */
  cpuUtilization(): number;
  /** Schedule `fn` after `ms`; the returned handle can cancel it. */
  setTimer(fn: () => void, ms: number): Timer;
  /** Structured log line. */
  log(msg: string, extra?: Record<string, unknown>): void;
}

export interface SupervisorConfig {
  min: number;
  max: number;
  cpuHigh: number;
  cpuLow: number;
  cooldownMs: number;
  drainMs: number;
  sampleMs: number;
  /** Sliding window for crash-loop detection. */
  crashWindowMs: number;
  /** Respawn backoff after a fast (crash) exit. */
  crashBackoffMs: number;
  /** How long to halt respawns once a crash loop is detected. */
  crashPauseMs: number;
  /** An exit within this long of spawn counts as a "crash". */
  crashFastMs: number;
}

const numOr = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** Parse + clamp the supervisor config from env. Pure — safe to unit test. */
export function parseConfig(
  env: Record<string, string | undefined>,
  cores: number,
): SupervisorConfig {
  const safeCores = Math.max(1, Math.trunc(cores) || 1);
  const min = clamp(Math.trunc(numOr(env.CLUSTER_MIN, 1)), 1, safeCores);
  const max = clamp(Math.trunc(numOr(env.CLUSTER_MAX, safeCores)), min, safeCores);
  const cpuHigh = clamp(numOr(env.CLUSTER_CPU_HIGH, 0.7), 0.1, 1);
  const cpuLow = clamp(numOr(env.CLUSTER_CPU_LOW, 0.25), 0, cpuHigh - 0.05);
  return {
    min,
    max,
    cpuHigh,
    cpuLow,
    cooldownMs: Math.max(0, numOr(env.CLUSTER_COOLDOWN_MS, 15_000)),
    drainMs: Math.max(1000, numOr(env.CLUSTER_DRAIN_MS, 25_000)),
    sampleMs: Math.max(1000, numOr(env.CLUSTER_SAMPLE_MS, 5000)),
    crashWindowMs: 60_000,
    crashBackoffMs: 1000,
    crashPauseMs: 30_000,
    crashFastMs: 3000,
  };
}

interface CpuTimes {
  idle: number;
  total: number;
}

/**
 * Build a CPU-utilization sampler from a `cpus()`-shaped function. Each call
 * returns utilization in [0,1] across all cores since the previous call (from
 * cumulative time deltas). The first call establishes a baseline (returns 0).
 */
export function makeCpuSampler(cpus: () => Array<{ times: Record<string, number> }>): () => number {
  const sample = (): CpuTimes => {
    let idle = 0;
    let total = 0;
    for (const cpu of cpus()) {
      for (const t of Object.values(cpu.times)) total += t;
      idle += cpu.times.idle ?? 0;
    }
    return { idle, total };
  };
  let last = sample();
  return () => {
    const now = sample();
    const dIdle = now.idle - last.idle;
    const dTotal = now.total - last.total;
    last = now;
    if (dTotal <= 0) return 0;
    return clamp(1 - dIdle / dTotal, 0, 1);
  };
}

interface Child {
  id: number;
  handle: ChildHandle;
  startedAt: number;
  draining: boolean;
  killTimer?: Timer;
}

/**
 * The cluster supervisor state machine. Drive it with `start()` + periodic
 * `tick()` calls (the entrypoint uses setInterval; tests call tick() directly).
 */
export class Supervisor {
  private readonly children = new Map<number, Child>();
  private nextId = 1;
  private shuttingDown = false;
  private paused = false;
  // -Infinity so the very first scale action is never blocked by the cooldown,
  // regardless of the clock's origin (now() - -Infinity is always >= cooldown).
  private lastScaleAt = Number.NEGATIVE_INFINITY;
  private crashTimes: number[] = [];
  private onShutdownComplete?: () => void;

  constructor(
    private readonly cfg: SupervisorConfig,
    private readonly deps: SupervisorDeps,
  ) {}

  /** Number of children currently accepting traffic (not draining). */
  liveCount(): number {
    let n = 0;
    for (const c of this.children.values()) if (!c.draining) n++;
    return n;
  }

  /** Total tracked children (live + draining). */
  size(): number {
    return this.children.size;
  }

  isPaused(): boolean {
    return this.paused;
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  /** Spawn the floor and log startup. Call once. */
  start(): void {
    this.deps.log("supervisor starting", {
      min: this.cfg.min,
      max: this.cfg.max,
      cpuHigh: this.cfg.cpuHigh,
      cpuLow: this.cfg.cpuLow,
      sampleMs: this.cfg.sampleMs,
    });
    for (let i = 0; i < this.cfg.min; i++) this.spawnChild();
  }

  private spawnChild(): void {
    if (this.shuttingDown || this.paused) return;
    const id = this.nextId++;
    const startedAt = this.deps.now();
    const handle = this.deps.spawn(
      {
        INSTANCE_ROLE: "api",
        // Supervised child: self-terminate if orphaned, and self-exit before our
        // SIGKILL deadline (drainMs) so a cleanly-draining child is never killed.
        CLUSTER_CHILD: "1",
        SHUTDOWN_DRAIN_MS: String(Math.max(1000, this.cfg.drainMs - 3000)),
      },
      (code, signal) => this.onExit(id, startedAt, code, signal),
    );
    this.children.set(id, { id, handle, startedAt, draining: false });
    this.deps.log("spawned child", { id, live: this.liveCount() });
  }

  private onExit(id: number, startedAt: number, code: number | null, signal: string | null): void {
    const child = this.children.get(id);
    this.children.delete(id);
    child?.killTimer?.clear();

    if (this.shuttingDown) {
      if (this.children.size === 0) this.finishShutdown();
      return;
    }
    if (child?.draining) {
      this.deps.log("child drained + exited", { id, live: this.liveCount() });
      return;
    }

    // Unexpected exit — crash. Protect against tight crash loops.
    const lived = this.deps.now() - startedAt;
    this.deps.log("child exited unexpectedly", {
      id,
      code,
      signal,
      livedMs: lived,
      live: this.liveCount(),
    });
    if (lived < this.cfg.crashFastMs) {
      const recent = this.recordCrash();
      if (recent >= this.cfg.max * 3) {
        this.paused = true;
        this.deps.log("crash loop detected — pausing respawns", { recentCrashes: recent });
        this.deps.setTimer(() => {
          this.paused = false;
          this.crashTimes = [];
          this.ensureFloor();
        }, this.cfg.crashPauseMs);
        return;
      }
      this.deps.setTimer(() => this.ensureFloor(), this.cfg.crashBackoffMs);
      return;
    }
    this.ensureFloor();
  }

  private recordCrash(): number {
    const now = this.deps.now();
    this.crashTimes.push(now);
    const cutoff = now - this.cfg.crashWindowMs;
    while (this.crashTimes.length > 0 && this.crashTimes[0] < cutoff) this.crashTimes.shift();
    return this.crashTimes.length;
  }

  private drainOne(): void {
    // Newest live child (least-warmed) gets removed first. Tie-break by id
    // (monotonic spawn order) so selection is deterministic when two children
    // start in the same millisecond.
    const candidate = [...this.children.values()]
      .filter((c) => !c.draining)
      .sort((a, b) => b.startedAt - a.startedAt || b.id - a.id)[0];
    if (!candidate) return;
    candidate.draining = true;
    this.deps.log("draining child (SIGTERM)", { id: candidate.id });
    candidate.handle.kill("SIGTERM");
    candidate.killTimer = this.deps.setTimer(() => {
      if (this.children.has(candidate.id)) {
        this.deps.log("child drain timed out — SIGKILL", { id: candidate.id });
        candidate.handle.kill("SIGKILL");
      }
    }, this.cfg.drainMs);
  }

  /** Respawn until the LIVE pool is at least MIN (covers crash/drain losses). */
  ensureFloor(): void {
    while (!this.shuttingDown && !this.paused && this.liveCount() < this.cfg.min) this.spawnChild();
  }

  /** One autoscale decision. Call on an interval. */
  tick(): void {
    if (this.shuttingDown || this.paused) return;
    this.ensureFloor();
    const util = this.deps.cpuUtilization();
    const live = this.liveCount(); // decide on live (accepting-traffic) count
    const cooled = this.deps.now() - this.lastScaleAt >= this.cfg.cooldownMs;
    const pct = Math.round(util * 100);
    if (util >= this.cfg.cpuHigh && live < this.cfg.max && cooled) {
      this.deps.log("scaling up", { cpuPct: pct, from: live, to: live + 1 });
      this.spawnChild();
      this.lastScaleAt = this.deps.now();
    } else if (util <= this.cfg.cpuLow && live > this.cfg.min && cooled) {
      this.deps.log("scaling down", { cpuPct: pct, from: live, to: live - 1 });
      this.drainOne();
      this.lastScaleAt = this.deps.now();
    }
  }

  /**
   * Graceful shutdown: SIGTERM all children and let them drain; SIGKILL any
   * stragglers after drainMs. `onComplete` fires once all children are gone (or
   * the deadline forces it) — the entrypoint uses it to process.exit.
   */
  shutdown(onComplete: () => void): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.onShutdownComplete = onComplete;
    this.deps.log("supervisor shutting down", { live: this.liveCount() });
    for (const c of this.children.values()) c.handle.kill("SIGTERM");
    if (this.children.size === 0) {
      this.finishShutdown();
      return;
    }
    this.deps.setTimer(() => {
      for (const c of this.children.values()) {
        this.deps.log("child did not drain — SIGKILL", { id: c.id });
        c.handle.kill("SIGKILL");
      }
      this.finishShutdown();
    }, this.cfg.drainMs);
  }

  private finishShutdown(): void {
    const done = this.onShutdownComplete;
    this.onShutdownComplete = undefined;
    done?.();
  }
}
