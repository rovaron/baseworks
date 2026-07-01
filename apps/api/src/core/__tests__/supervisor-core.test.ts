import { describe, expect, test } from "bun:test";
import {
  type ChildHandle,
  makeCpuSampler,
  parseConfig,
  Supervisor,
  type SupervisorConfig,
  type SupervisorDeps,
  type Timer,
} from "../supervisor-core";

// ---------- deterministic test harness ----------

/** Controllable clock + timer scheduler. `advance(ms)` fires due timers in order. */
class FakeClock {
  time = 0;
  private seq = 0;
  private timers: Array<{ id: number; at: number; fn: () => void }> = [];

  now = (): number => this.time;

  setTimer = (fn: () => void, ms: number): Timer => {
    const id = this.seq++;
    this.timers.push({ id, at: this.time + ms, fn });
    return {
      clear: () => {
        this.timers = this.timers.filter((t) => t.id !== id);
      },
    };
  };

  advance(ms: number): void {
    const target = this.time + ms;
    let guard = 0;
    for (;;) {
      if (++guard > 100_000) throw new Error("timer loop");
      const due = this.timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.time = due.at;
      this.timers = this.timers.filter((t) => t.id !== due.id);
      due.fn();
    }
    this.time = target;
  }

  pendingTimers(): number {
    return this.timers.length;
  }
}

interface FakeChild {
  env: Record<string, string>;
  onExit: (code: number | null, signal: string | null) => void;
  kills: string[];
}

function makeHarness(cfgOverrides: Partial<SupervisorConfig> = {}) {
  const clock = new FakeClock();
  const spawned: FakeChild[] = [];
  let cpu = 0.5;
  const logs: Array<{ msg: string; extra: Record<string, unknown> }> = [];

  const deps: SupervisorDeps = {
    spawn(env, onExit): ChildHandle {
      const child: FakeChild = { env, onExit, kills: [] };
      spawned.push(child);
      return { kill: (signal) => child.kills.push(signal) };
    },
    now: clock.now,
    cpuUtilization: () => cpu,
    setTimer: clock.setTimer,
    log: (msg, extra = {}) => logs.push({ msg, extra }),
  };

  const cfg: SupervisorConfig = {
    min: 1,
    max: 2,
    cpuHigh: 0.7,
    cpuLow: 0.25,
    cooldownMs: 0,
    drainMs: 25_000,
    sampleMs: 5000,
    crashWindowMs: 60_000,
    crashBackoffMs: 1000,
    crashPauseMs: 30_000,
    crashFastMs: 3000,
    ...cfgOverrides,
  };

  const sup = new Supervisor(cfg, deps);
  /** Exit a child by index (default: crash immediately unless clock was advanced). */
  const exit = (i: number, code: number | null = 0, signal: string | null = null) =>
    spawned[i].onExit(code, signal);

  return {
    sup,
    clock,
    spawned,
    logs,
    cfg,
    setCpu: (v: number) => {
      cpu = v;
    },
    exit,
  };
}

// ---------- parseConfig ----------

describe("parseConfig", () => {
  test("defaults", () => {
    const c = parseConfig({}, 8);
    expect(c).toMatchObject({ min: 1, max: 8, cpuHigh: 0.7, cpuLow: 0.25, cooldownMs: 15_000 });
    expect(c.drainMs).toBe(25_000);
    expect(c.sampleMs).toBe(5000);
  });

  test("min clamped to cores; max clamped to [min, cores]", () => {
    const c = parseConfig({ CLUSTER_MIN: "10", CLUSTER_MAX: "2" }, 4);
    expect(c.min).toBe(4); // min clamped up-to cores
    expect(c.max).toBe(4); // max clamped to >= min
  });

  test("max clamped down to cores", () => {
    expect(parseConfig({ CLUSTER_MAX: "99" }, 4).max).toBe(4);
  });

  test("cpuLow cannot invert past cpuHigh", () => {
    const c = parseConfig({ CLUSTER_CPU_LOW: "0.9", CLUSTER_CPU_HIGH: "0.5" }, 4);
    expect(c.cpuHigh).toBe(0.5);
    expect(c.cpuLow).toBeLessThanOrEqual(0.45);
  });

  test("non-numeric env falls back to defaults", () => {
    const c = parseConfig({ CLUSTER_MIN: "abc", CLUSTER_SAMPLE_MS: "x" }, 4);
    expect(c.min).toBe(1);
    expect(c.sampleMs).toBe(5000);
  });

  test("cores=0 treated as 1", () => {
    expect(parseConfig({}, 0).max).toBe(1);
  });

  test("sample/cooldown/drain floors applied", () => {
    const c = parseConfig(
      { CLUSTER_SAMPLE_MS: "10", CLUSTER_DRAIN_MS: "10", CLUSTER_COOLDOWN_MS: "-5" },
      4,
    );
    expect(c.sampleMs).toBe(1000);
    expect(c.drainMs).toBe(1000);
    expect(c.cooldownMs).toBe(0);
  });
});

// ---------- makeCpuSampler ----------

describe("makeCpuSampler", () => {
  const cpus = (idle: number, busy: number) => [
    { times: { idle, user: busy, sys: 0, nice: 0, irq: 0 } },
  ];

  test("first call is baseline 0; then utilization from deltas", () => {
    let state = cpus(100, 100);
    const sample = makeCpuSampler(() => state);
    expect(sample()).toBe(0); // baseline
    state = cpus(150, 250); // dIdle=50, dTotal=200 → util = 1 - 50/200 = 0.75
    expect(sample()).toBeCloseTo(0.75, 5);
  });

  test("no delta (dTotal<=0) → 0", () => {
    const state = cpus(100, 100);
    const sample = makeCpuSampler(() => state);
    sample();
    expect(sample()).toBe(0);
  });

  test("missing idle key coerces to 0", () => {
    let state: Array<{ times: Record<string, number> }> = [{ times: { user: 100 } }];
    const sample = makeCpuSampler(() => state);
    sample();
    state = [{ times: { user: 200 } }]; // dIdle=0, dTotal=100 → util 1
    expect(sample()).toBe(1);
  });
});

// ---------- lifecycle: start / spawn env ----------

describe("start + spawn", () => {
  test("start spawns MIN children", () => {
    const h = makeHarness({ min: 2 });
    h.sup.start();
    expect(h.spawned.length).toBe(2);
    expect(h.sup.liveCount()).toBe(2);
    expect(h.sup.size()).toBe(2);
  });

  test("child env marks CLUSTER_CHILD + drain budget < drainMs", () => {
    const h = makeHarness({ drainMs: 25_000 });
    h.sup.start();
    expect(h.spawned[0].env.CLUSTER_CHILD).toBe("1");
    expect(h.spawned[0].env.INSTANCE_ROLE).toBe("api");
    expect(h.spawned[0].env.SHUTDOWN_DRAIN_MS).toBe("22000");
  });

  test("tiny drainMs floors child drain budget at 1000", () => {
    const h = makeHarness({ drainMs: 1500 });
    h.sup.start();
    expect(h.spawned[0].env.SHUTDOWN_DRAIN_MS).toBe("1000");
  });
});

// ---------- scale up ----------

describe("scale up", () => {
  test("high CPU scales up one per tick, capped at MAX", () => {
    const h = makeHarness({ min: 1, max: 3 });
    h.sup.start();
    h.setCpu(0.9);
    h.sup.tick();
    expect(h.sup.liveCount()).toBe(2);
    h.sup.tick();
    expect(h.sup.liveCount()).toBe(3);
    h.sup.tick(); // at MAX — no further growth
    expect(h.sup.liveCount()).toBe(3);
    expect(h.spawned.length).toBe(3);
  });

  test("respects cooldown between scale actions", () => {
    const h = makeHarness({ min: 1, max: 3, cooldownMs: 10_000 });
    h.sup.start();
    h.setCpu(0.9);
    h.sup.tick(); // scales to 2, lastScaleAt=0
    expect(h.sup.liveCount()).toBe(2);
    h.sup.tick(); // not cooled (time still 0) → no scale
    expect(h.sup.liveCount()).toBe(2);
    h.clock.advance(10_000);
    h.sup.tick(); // cooled → scales to 3
    expect(h.sup.liveCount()).toBe(3);
  });
});

// ---------- scale down (incl. the review's HIGH bug) ----------

describe("scale down", () => {
  test("low CPU drains the newest child; live decreases", () => {
    const h = makeHarness({ min: 1, max: 3 });
    h.sup.start();
    h.setCpu(0.9);
    h.sup.tick();
    h.sup.tick(); // now 3 live
    expect(h.sup.liveCount()).toBe(3);
    h.setCpu(0.1);
    h.sup.tick(); // drain newest (id 3)
    expect(h.sup.liveCount()).toBe(2);
    expect(h.spawned[2].kills).toContain("SIGTERM"); // newest was drained
  });

  test("NEVER drains below MIN live even with a still-draining child (HIGH regression)", () => {
    const h = makeHarness({ min: 1, max: 3, cooldownMs: 0, drainMs: 25_000 });
    h.sup.start();
    h.setCpu(0.9);
    h.sup.tick(); // 2 live
    h.setCpu(0.1);
    h.sup.tick(); // drain one → 1 live, 1 draining (still tracked)
    expect(h.sup.liveCount()).toBe(1);
    expect(h.sup.size()).toBe(2); // draining child still present
    h.sup.tick(); // live(1) is NOT > min(1) → must NOT drain the last live worker
    expect(h.sup.liveCount()).toBe(1);
    // the surviving live child was never SIGTERM'd
    const live = h.spawned.find((c) => c.kills.length === 0);
    expect(live).toBeDefined();
  });

  test("does not drain when at MIN", () => {
    const h = makeHarness({ min: 2, max: 3 });
    h.sup.start();
    h.setCpu(0.1);
    h.sup.tick();
    expect(h.sup.liveCount()).toBe(2);
    expect(h.spawned.every((c) => c.kills.length === 0)).toBe(true);
  });

  test("mid-range CPU is a no-op", () => {
    const h = makeHarness({ min: 1, max: 3 });
    h.sup.start();
    h.setCpu(0.5);
    h.sup.tick();
    expect(h.sup.liveCount()).toBe(1);
  });
});

// ---------- drain / SIGKILL backstop ----------

describe("drain backstop", () => {
  test("SIGKILLs a child that does not exit within drainMs", () => {
    const h = makeHarness({ min: 1, max: 3, drainMs: 5000 });
    h.sup.start();
    h.setCpu(0.9);
    h.sup.tick(); // 2 live
    h.setCpu(0.1);
    h.sup.tick(); // drain newest
    const drained = h.spawned[1];
    expect(drained.kills).toEqual(["SIGTERM"]);
    h.clock.advance(5000); // deadline — still alive
    expect(drained.kills).toEqual(["SIGTERM", "SIGKILL"]);
  });

  test("no SIGKILL if the child drains cleanly first", () => {
    const h = makeHarness({ min: 1, max: 3, drainMs: 5000 });
    h.sup.start();
    h.setCpu(0.9);
    h.sup.tick();
    h.setCpu(0.1);
    h.sup.tick();
    const drained = h.spawned[1];
    h.clock.advance(1000);
    drained.onExit(0, "SIGTERM"); // exits before deadline
    h.clock.advance(10_000); // deadline passes — timer guarded by children.has()
    expect(drained.kills).toEqual(["SIGTERM"]); // no SIGKILL
  });
});

// ---------- crash handling ----------

describe("crash handling", () => {
  test("a crash respawns to hold the floor after backoff", () => {
    const h = makeHarness({ min: 1, crashBackoffMs: 1000 });
    h.sup.start();
    expect(h.sup.liveCount()).toBe(1);
    h.exit(0, 1, null); // crash (lived 0 < crashFastMs)
    expect(h.sup.liveCount()).toBe(0);
    h.clock.advance(1000); // backoff → ensureFloor respawns
    expect(h.sup.liveCount()).toBe(1);
    expect(h.spawned.length).toBe(2);
  });

  test("a healthy (long-lived) exit respawns immediately", () => {
    const h = makeHarness({ min: 1, crashFastMs: 3000 });
    h.sup.start();
    h.clock.advance(10_000); // child lived long
    h.exit(0, 0, null); // graceful/healthy exit, not a crash
    expect(h.sup.liveCount()).toBe(1); // respawned without backoff
    expect(h.spawned.length).toBe(2);
  });

  test("crash loop pauses respawns, then resumes after crashPauseMs", () => {
    const h = makeHarness({ min: 1, max: 2, crashBackoffMs: 1000, crashPauseMs: 30_000 });
    h.sup.start();
    // max*3 = 6 fast crashes → pause. Each backoff respawns the next victim.
    for (let i = 0; i < 6; i++) {
      h.exit(h.spawned.length - 1, 1, null); // crash the latest child
      h.clock.advance(1000); // fire backoff respawn (until pause trips)
    }
    expect(h.sup.isPaused()).toBe(true);
    const countAtPause = h.spawned.length;
    // during the pause, ticks/ensureFloor must NOT spawn
    h.sup.tick();
    h.sup.ensureFloor();
    expect(h.spawned.length).toBe(countAtPause);
    // after the pause window, respawns resume
    h.clock.advance(30_000);
    expect(h.sup.isPaused()).toBe(false);
    expect(h.sup.liveCount()).toBe(1);
  });

  test("crash counter is windowed (old crashes decay)", () => {
    const h = makeHarness({ min: 1, max: 2, crashWindowMs: 60_000, crashBackoffMs: 1000 });
    h.sup.start();
    // 5 fast crashes (below the 6 threshold), spaced so the first ages out.
    for (let i = 0; i < 5; i++) {
      h.exit(h.spawned.length - 1, 1, null);
      h.clock.advance(1000);
    }
    expect(h.sup.isPaused()).toBe(false);
    // jump past the window so those crashes decay, then crash a few more —
    // without decay this would cross the threshold; with decay it must not.
    h.clock.advance(61_000);
    for (let i = 0; i < 5; i++) {
      h.exit(h.spawned.length - 1, 1, null);
      h.clock.advance(1000);
    }
    expect(h.sup.isPaused()).toBe(false);
  });
});

// ---------- shutdown ----------

describe("shutdown", () => {
  test("SIGTERMs all children then SIGKILLs stragglers at drainMs; onComplete fires", () => {
    const h = makeHarness({ min: 1, max: 3, drainMs: 5000 });
    h.sup.start();
    h.setCpu(0.9);
    h.sup.tick(); // 2 live
    let done = false;
    h.sup.shutdown(() => {
      done = true;
    });
    expect(h.spawned.slice(0, 2).every((c) => c.kills.includes("SIGTERM"))).toBe(true);
    expect(done).toBe(false);
    h.clock.advance(5000); // deadline → SIGKILL + complete
    expect(h.spawned.slice(0, 2).every((c) => c.kills.includes("SIGKILL"))).toBe(true);
    expect(done).toBe(true);
  });

  test("completes early when all children drain before the deadline", () => {
    const h = makeHarness({ min: 2, drainMs: 5000 });
    h.sup.start();
    let done = false;
    h.sup.shutdown(() => {
      done = true;
    });
    h.exit(0, 0, "SIGTERM");
    expect(done).toBe(false);
    h.exit(1, 0, "SIGTERM"); // last child → finishShutdown
    expect(done).toBe(true);
    // no SIGKILL needed
    expect(h.spawned.every((c) => !c.kills.includes("SIGKILL"))).toBe(true);
  });

  test("shutdown with zero children completes immediately", () => {
    const h = makeHarness({ min: 1 });
    // don't start() → no children
    let done = false;
    h.sup.shutdown(() => {
      done = true;
    });
    expect(done).toBe(true);
  });

  test("second shutdown is a no-op; ticks are ignored while shutting down", () => {
    const h = makeHarness({ min: 1, max: 3 });
    h.sup.start();
    let calls = 0;
    h.sup.shutdown(() => calls++);
    h.sup.shutdown(() => calls++); // ignored
    expect(h.sup.isShuttingDown()).toBe(true);
    h.setCpu(0.9);
    h.sup.tick(); // ignored during shutdown
    expect(h.spawned.length).toBe(1);
    h.exit(0, 0, "SIGTERM"); // completes the (single) onComplete
    expect(calls).toBe(1);
  });
});
