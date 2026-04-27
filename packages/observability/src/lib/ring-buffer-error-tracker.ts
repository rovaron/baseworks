import type {
  Breadcrumb,
  CaptureScope,
  ErrorTracker,
  ErrorTrackerScope,
} from "../ports/error-tracker";
import type { LogLevel } from "../ports/types";

/**
 * Phase 22 / D-15 — public snapshot entry shape.
 * Surfaced to /health/detailed via the recentErrors aggregator contributor.
 */
export interface RingBufferEntry {
  /** ISO 8601 timestamp of the most recent capture in this dedup bucket. */
  timestamp: string;
  /** Truncated error message, max 500 chars (Pitfall 9 mitigation). */
  message: string;
  /** Capture origin tag — set via scope.tags.source on captureException. */
  source: "cqrs" | "http" | "worker" | "global";
  /** Number of dedup'd captures within the current window. */
  count: number;
  /** First non-internal stack frame (max 200 chars) — used as part of dedup key. */
  firstFrame: string;
}

const DEFAULT_CAPACITY = 50;
const MAX_MESSAGE_LEN = 500;
const MAX_FRAME_LEN = 200;

/**
 * Phase 22 / D-15 — ErrorTracker decorator that retains a process-local rolling
 * window of recent error reports for the /health/detailed admin UI.
 *
 * Delegates EVERY port method to the inner tracker (Sentry/GlitchTip/Pino/Noop)
 * for actual reporting AND keeps an in-memory ring buffer (capacity 50, deduped
 * by message + first non-internal stack frame).
 *
 * NOT exposed as a routing/transport boundary — `snapshot()` exposes the buffer
 * to in-process aggregator code only.
 */
export class RingBufferingErrorTracker implements ErrorTracker {
  readonly name: string;
  private buffer: RingBufferEntry[] = [];
  private dedupIndex = new Map<string, number>(); // dedupKey → buffer index

  constructor(
    private inner: ErrorTracker,
    private capacity: number = DEFAULT_CAPACITY,
  ) {
    this.name = `ringbuffer(${inner.name})`;
  }

  // --- ErrorTracker port: every method delegates to inner ---
  captureException(err: unknown, scope?: CaptureScope): void {
    this.inner.captureException(err, scope);
    this.append(err, scope);
  }

  captureMessage(message: string, level?: LogLevel): void {
    this.inner.captureMessage(message, level);
    // No CaptureScope on captureMessage per port — message captures default to "global" source.
    this.append(new Error(message));
  }

  addBreadcrumb(breadcrumb: Breadcrumb): void {
    this.inner.addBreadcrumb(breadcrumb);
  }

  withScope<T>(fn: (scope: ErrorTrackerScope) => T): T {
    return this.inner.withScope(fn);
  }

  flush(timeoutMs?: number): Promise<boolean> {
    return this.inner.flush(timeoutMs);
  }

  // --- Buffer accessor ---
  /**
   * Read-only snapshot for the health aggregator. Returns a NEW array each call;
   * the caller may mutate the returned array safely.
   */
  snapshot(): RingBufferEntry[] {
    return [...this.buffer];
  }

  private append(err: unknown, scope?: CaptureScope): void {
    const rawMessage = err instanceof Error ? err.message : String(err);
    const message = rawMessage.slice(0, MAX_MESSAGE_LEN);
    const stack = err instanceof Error && err.stack ? err.stack : "";
    // First non-internal frame — strips node_modules paths.
    const firstFrame = (
      stack.split("\n").slice(1).find((l) => !l.includes("node_modules")) ?? ""
    )
      .trim()
      .slice(0, MAX_FRAME_LEN);
    const dedupKey = `${message}::${firstFrame}`;
    const sourceTag = scope?.tags?.source;
    const source: RingBufferEntry["source"] =
      sourceTag === "cqrs" || sourceTag === "http" || sourceTag === "worker"
        ? sourceTag
        : "global";

    const existingIdx = this.dedupIndex.get(dedupKey);
    if (existingIdx !== undefined && this.buffer[existingIdx]) {
      this.buffer[existingIdx].count++;
      this.buffer[existingIdx].timestamp = new Date().toISOString();
      return;
    }

    if (this.buffer.length >= this.capacity) {
      const evicted = this.buffer.shift()!;
      const evictedKey = `${evicted.message}::${evicted.firstFrame}`;
      this.dedupIndex.delete(evictedKey);
      // Reindex remaining entries — every buffer index dropped by 1 after shift().
      for (const [k, idx] of this.dedupIndex) {
        this.dedupIndex.set(k, idx - 1);
      }
    }

    const entry: RingBufferEntry = {
      timestamp: new Date().toISOString(),
      message,
      firstFrame,
      source,
      count: 1,
    };
    this.buffer.push(entry);
    this.dedupIndex.set(dedupKey, this.buffer.length - 1);
  }
}
