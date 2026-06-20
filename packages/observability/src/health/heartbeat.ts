// Phase 22 / EXT-02 — worker heartbeat publisher + reader.
// References:
//   - 22-RESEARCH.md Pattern 5 (verbatim)
//   - D-12: key shape `worker:heartbeat:{instanceId}` + SCAN (not KEYS)
//   - D-13: TTL = 2 × intervalMs
//   - D-14: setInterval + try/catch warn-not-throw + cleanup on shutdown
//   - Phase 20 D-02 / 20-CONTEXT.md: NEVER use the queue producer wrapper or the
//     ALS processor wrapper here (heartbeat is a self-report, not a
//     producer/consumer pair — wrapping would mint orphan span trees)
import type IORedis from "ioredis";

/** Phase 22 / D-12 — payload shape persisted to `worker:heartbeat:{instanceId}`. */
export interface HeartbeatPayload {
  instanceId: string;
  queues: string[];
  lastHeartbeat: string; // ISO 8601
  version?: string;
}

export interface HeartbeatPublisherOptions {
  redis: IORedis;
  instanceId: string;
  /** Lazy — re-evaluated on every tick so workers added late are picked up. */
  getQueues: () => string[];
  intervalMs: number;
  version?: string;
  /** Optional logger; falls back to no-op if not provided. */
  logger?: { warn: (data: unknown, message?: string) => void };
}

export interface HeartbeatPublisherHandle {
  stop: () => Promise<void>;
}

/**
 * Phase 22 / EXT-02 / D-12..D-14 — start a heartbeat publisher.
 *
 * Writes `worker:heartbeat:{instanceId}` to Redis with TTL `2 × intervalMs`
 * on every interval tick. Publishes once immediately so the dashboard sees
 * the worker without waiting for the first tick. Logs (warn) on Redis errors;
 * never throws or crashes the worker (D-14).
 *
 * Cleanup: handle.stop() clears the interval AND DELs the key (so dashboard
 * transitions worker from healthy → absent immediately on graceful shutdown).
 * SIGKILL'd workers leave the key for ≤ TTL — the irreducible window.
 */
export function startHeartbeatPublisher(opts: HeartbeatPublisherOptions): HeartbeatPublisherHandle {
  const key = `worker:heartbeat:${opts.instanceId}`;
  const ttlSec = Math.ceil((opts.intervalMs * 2) / 1000);
  const noopLogger = { warn: () => {} };
  const log = opts.logger ?? noopLogger;

  const publish = async () => {
    const payload: HeartbeatPayload = {
      instanceId: opts.instanceId,
      queues: opts.getQueues(),
      lastHeartbeat: new Date().toISOString(),
      version: opts.version,
    };
    try {
      await opts.redis.set(key, JSON.stringify(payload), "EX", ttlSec);
    } catch (err) {
      // D-14 — Redis hiccup logs warn, does NOT crash the worker.
      log.warn({ err: String(err), key }, "worker heartbeat publish failed");
    }
  };

  // Publish once immediately (synchronous fire-and-forget) so the dashboard
  // sees the worker without waiting for the first interval tick.
  void publish();

  const timer = setInterval(publish, opts.intervalMs);

  // Pitfall 7 — Bun 1.2.11+ exposes process.unref(timer); older Bun lacks it.
  // We try, but do not rely on success: clearInterval in stop() is the
  // canonical termination path either way.
  try {
    const procUnref = (process as unknown as { unref?: (t: unknown) => void }).unref;
    if (typeof procUnref === "function") procUnref.call(process, timer);
  } catch {
    // Older Bun — tolerable; explicit clearInterval below handles cleanup.
  }

  return {
    stop: async () => {
      clearInterval(timer);
      // D-14 — DEL the key on graceful shutdown so the dashboard transitions
      // the worker from healthy → absent immediately, rather than waiting
      // for TTL expiry.
      try {
        await opts.redis.del(key);
      } catch (err) {
        log.warn({ err: String(err), key }, "worker heartbeat DEL failed during shutdown");
      }
    },
  };
}

/**
 * Phase 22 / D-12 — read all live heartbeats via SCAN (NOT KEYS — production-safe).
 * Used by the worker-heartbeat health contributor in Plan 03.
 */
export async function readHeartbeats(redis: IORedis): Promise<HeartbeatPayload[]> {
  const out: HeartbeatPayload[] = [];
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", "worker:heartbeat:*", "COUNT", 100);
    cursor = next;
    if (keys.length) {
      const values = await redis.mget(...keys);
      for (const v of values) {
        if (!v) continue;
        try {
          out.push(JSON.parse(v) as HeartbeatPayload);
        } catch {
          // Malformed entry — ignore (Open Question 3 resolution).
        }
      }
    }
  } while (cursor !== "0");
  return out;
}
