/**
 * API cluster supervisor — vertical scaling on a single machine.
 *
 * Spawns a pool of API worker PROCESSES (not JS threads — Bun runs JS single-
 * threaded per process) that all bind the same PORT via SO_REUSEPORT (see
 * `reusePort: true` in index.ts). The kernel load-balances TCP connections across
 * them, so scaling = spawning/killing processes, no userland proxy.
 *
 * It autoscales on CPU utilization (portable, from os.cpus() deltas — Linux and
 * Windows), within [CLUSTER_MIN, CLUSTER_MAX] (max defaults to the physical core
 * count; past cores you just thrash). Downscaling is graceful on POSIX: a removed
 * child gets SIGTERM, drains in-flight requests (index.ts shutdown), then exits —
 * SIGKILL backstop if it hangs. NOTE: Windows has no real SIGTERM (Bun maps it to
 * a hard terminate), so the graceful-drain guarantee holds on Linux, not Win dev.
 *
 * This file is the thin entrypoint: it builds the real Bun/OS dependencies and
 * hands them to the testable state machine in ./core/supervisor-core.ts.
 *
 * Run: `bun run apps/api/src/supervisor.ts` (or the `cluster` package script).
 * Env knobs: CLUSTER_MIN, CLUSTER_MAX, CLUSTER_CPU_HIGH, CLUSTER_CPU_LOW,
 * CLUSTER_SAMPLE_MS, CLUSTER_COOLDOWN_MS, CLUSTER_DRAIN_MS, CLUSTER_ENTRY.
 */
import os from "node:os";
import path from "node:path";
import {
  type ChildHandle,
  makeCpuSampler,
  parseConfig,
  Supervisor,
  type SupervisorDeps,
} from "./core/supervisor-core";

const ENTRY = process.env.CLUSTER_ENTRY
  ? path.resolve(process.env.CLUSTER_ENTRY)
  : path.join(import.meta.dir, "index.ts");

const cfg = parseConfig(process.env, os.cpus().length);
const cpuUtilization = makeCpuSampler(() => os.cpus());

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), scope: "supervisor", msg, ...extra }));

const deps: SupervisorDeps = {
  spawn(env, onExit) {
    const proc = Bun.spawn(["bun", "run", ENTRY], {
      env: { ...process.env, ...env },
      stdout: "inherit",
      stderr: "inherit",
      // Bun reports the signal as a numeric code; the core only logs it as a string.
      onExit: (_proc, code, signal) => onExit(code, signal === null ? null : String(signal)),
    });
    return { kill: (signal) => proc.kill(signal) } satisfies ChildHandle;
  },
  now: () => Date.now(),
  cpuUtilization,
  setTimer(fn, ms) {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return { clear: () => clearTimeout(t) };
  },
  log,
};

const supervisor = new Supervisor(cfg, deps);

let shuttingDown = false;
const onSignal = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  log("received signal", { signal });
  supervisor.shutdown(() => process.exit(0));
};
process.on("SIGTERM", () => onSignal("SIGTERM"));
process.on("SIGINT", () => onSignal("SIGINT"));

log("supervisor entrypoint", { cores: os.cpus().length, entry: ENTRY });
supervisor.start();
setInterval(() => supervisor.tick(), cfg.sampleMs);
