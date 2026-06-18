/**
 * Phase 31 / OPS-02 — module-scoped event sink for the cleanup jobs.
 *
 * Mirrors `transform-events.ts`: BullMQ job handlers receive only `job.data` —
 * they have no `ctx.emit`, and the registry `TypedEventBus` is per-process
 * (instantiated in apps/api). The orphan reaper emits `file.deleted` per reaped
 * row for observability; the worker BINDS this sink to its registry event bus at
 * boot (`setCleanupEventSink((e, d) => registry.getEventBus().emit(e, d))`).
 *
 * Default is a no-op: in tests / a no-bus context the handler still runs and the
 * emit is dropped (best-effort observability, never load-bearing — the DB
 * tombstone is authoritative). A throwing sink never escapes `emitCleanupEvent`.
 */

export type CleanupEventSink = (event: string, data: unknown) => void;

let sink: CleanupEventSink | null = null;

/** Bind (worker) or capture (tests) the cleanup event sink. `null` clears it. */
export function setCleanupEventSink(next: CleanupEventSink | null): void {
  sink = next;
}

/** Best-effort emit; swallows sink errors so the job's control flow stays exact. */
export function emitCleanupEvent(event: string, data: unknown): void {
  try {
    sink?.(event, data);
  } catch {
    // Observability emit is fire-and-forget — never let it alter job control flow.
  }
}
