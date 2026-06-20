/**
 * Phase 28 / IMG-01 — module-scoped event sink for the image-transform job.
 *
 * BullMQ job handlers receive only `job.data` — they have no `ctx.emit` like CQRS
 * commands do, and the registry `TypedEventBus` is per-process (instantiated in
 * apps/api). To let `transform-image.ts` emit lifecycle events
 * (`file.transformed` / `file.transform-failed`) without coupling the handler to
 * a concrete bus, the worker BINDS this sink to its registry event bus at boot
 * (`setTransformEventSink((e, d) => registry.getEventBus().emit(e, d))`).
 *
 * Default is a no-op: in tests / a no-bus context the handler still runs and the
 * emit is simply dropped (best-effort observability, never load-bearing). Tests
 * set a capturing sink to assert emitted events. A throwing sink never escapes
 * `emitTransformEvent` (the catch keeps the handler's failure path deterministic).
 */

export type TransformEventSink = (event: string, data: unknown) => void;

let sink: TransformEventSink | null = null;

/** Bind (worker) or capture (tests) the transform event sink. `null` clears it. */
export function setTransformEventSink(next: TransformEventSink | null): void {
  sink = next;
}

/** Best-effort emit; swallows sink errors so the job's failure path stays exact. */
export function emitTransformEvent(event: string, data: unknown): void {
  try {
    sink?.(event, data);
  } catch {
    // Observability emit is fire-and-forget — never let it alter job control flow.
  }
}
