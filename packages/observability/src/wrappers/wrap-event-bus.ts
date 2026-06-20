/**
 * External EventBus wrapper (TRC-02 / Phase 19 D-15, D-16).
 *
 * Wraps `bus.emit` and `bus.on` so every emit opens an `event.publish`
 * span (kind=producer) and every listener runs inside an `event.handle`
 * child span (kind=consumer). No edits to apps/api/src/core/event-bus.ts;
 * this wrapper attaches at registry boot time immediately after the
 * existing wrapCqrsBus call (see apps/api/src/index.ts + worker.ts wire-up
 * in Plans 06/07).
 *
 * Design rules (mirror wrap-cqrs-bus.ts):
 * - EventBusLike type intentionally narrow (emit + on only) to avoid
 *   cross-package type cycles. TypedEventBus in apps/api/src/core/event-bus.ts
 *   satisfies it structurally — no runtime import needed here.
 * - Listener errors: span.recordException + setStatus('error') THEN rethrow.
 *   The existing try/catch-and-log at event-bus.ts:54-64 remains the single
 *   log/swallow site — this wrapper adds telemetry, not an alternate handler.
 * - Pitfall 6 (Phase 19 RESEARCH.md): the wrapper is deliberately scoped to
 *   telemetry only — no error-capture port is wired into listener failures
 *   here. Listener errors emit span status only (avoids double-capture noise
 *   for known-flaky subscribers; aligns with the CONTEXT.md D-15 discretion
 *   note on double-capture avoidance). The emitting command handler keeps
 *   the single error-capture path via the existing CQRS wrapper.
 * - `wrapEventBus<B extends EventBusLike>(bus: B, tracer: Tracer): B` —
 *   two arguments, bus mutated in place and returned for call-site ergonomics.
 */
import { obsContext } from "../context";
import type { Tracer } from "../ports/tracer";

/**
 * Minimal EventBus shape the wrapper needs. The real TypedEventBus in
 * apps/api/src/core/event-bus.ts satisfies this structurally. Keeping it
 * narrow avoids a cross-package type cycle between @baseworks/observability
 * and apps/api.
 */
export interface EventBusLike {
  emit(event: string, data: unknown): void;
  // biome-ignore lint/suspicious/noExplicitAny: structural compatibility with EventEmitter semantics
  on(event: string, handler: (data: any) => void | Promise<void>): void;
  // Optional: if present, off() is wrapped too so unsubscribing the original
  // handler reference removes the span-wrapped listener this wrapper registered.
  // biome-ignore lint/suspicious/noExplicitAny: structural compatibility with EventEmitter semantics
  off?(event: string, handler: (data: any) => void | Promise<void>): void;
}

/**
 * Wrap an EventBus-like object so every `emit` opens an `event.publish`
 * span (producer) and every `on`-registered listener runs inside its own
 * `event.handle` span (consumer). Listener errors annotate the span and
 * rethrow — the host bus's existing error-isolation try/catch swallows +
 * logs, keeping this wrapper log-free.
 *
 * @param bus - EventBus-like instance (mutated in place; also returned)
 * @param tracer - Tracer used to open spans (Noop by default)
 * @returns The same bus instance, with emit/on wrapped
 */
export function wrapEventBus<B extends EventBusLike>(bus: B, tracer: Tracer): B {
  const origEmit = bus.emit.bind(bus);
  const origOn = bus.on.bind(bus);
  const origOff = bus.off?.bind(bus);
  // Tracks each (event → original handler → span-wrapped listener) so the
  // wrapped off() can resolve and remove the same listener this wrapper passed
  // to the host bus. Without this, off() cannot match the span wrapper.
  const wrapperMap = new Map<
    string,
    // biome-ignore lint/suspicious/noExplicitAny: matches EventBusLike surface
    Map<(data: any) => void | Promise<void>, (data: any) => Promise<void>>
  >();

  (bus as EventBusLike).emit = (event: string, data: unknown): void => {
    const store = obsContext.getStore();
    // Fire-and-forget: EventEmitter.emit is synchronous — withSpan's promise
    // resolves after the synchronous origEmit inside its body has already run.
    // Swallow-inside-span only; the caller's emit signature is void.
    void tracer.withSpan(
      "event.publish",
      () => {
        origEmit(event, data);
      },
      {
        kind: "producer",
        attributes: {
          "event.name": event,
          "tenant.id": store?.tenantId ?? "",
          "request.id": store?.requestId ?? "",
        },
      },
    );
  };

  let listenerIndex = 0;
  (bus as EventBusLike).on = (
    event: string,
    // biome-ignore lint/suspicious/noExplicitAny: matches EventBusLike surface
    handler: (data: any) => void | Promise<void>,
  ): void => {
    const idx = listenerIndex++;
    // biome-ignore lint/suspicious/noExplicitAny: matches EventBusLike surface
    const wrapped = async (data: any): Promise<void> => {
      const store = obsContext.getStore();
      await tracer.withSpan(
        "event.handle",
        async (span) => {
          try {
            await handler(data);
          } catch (err) {
            // Span telemetry then rethrow — existing event-bus.ts try/catch
            // at lines 54-64 is the single log/swallow site.
            span.recordException(err);
            span.setStatus({ code: "error" });
            throw err;
          }
        },
        {
          kind: "consumer",
          attributes: {
            "event.name": event,
            "event.listener.index": idx,
            "tenant.id": store?.tenantId ?? "",
            "request.id": store?.requestId ?? "",
          },
        },
      );
    };
    let perEvent = wrapperMap.get(event);
    if (!perEvent) {
      perEvent = new Map();
      wrapperMap.set(event, perEvent);
    }
    perEvent.set(handler, wrapped);
    origOn(event, wrapped);
  };

  // Wrap off() so unsubscribing by the original handler removes the span wrapper.
  if (origOff) {
    (bus as EventBusLike).off = (
      event: string,
      // biome-ignore lint/suspicious/noExplicitAny: matches EventBusLike surface
      handler: (data: any) => void | Promise<void>,
    ): void => {
      const perEvent = wrapperMap.get(event);
      const wrapped = perEvent?.get(handler);
      if (perEvent && wrapped) {
        origOff(event, wrapped);
        perEvent.delete(handler);
        if (perEvent.size === 0) wrapperMap.delete(event);
      } else {
        origOff(event, handler);
      }
    };
  }

  return bus;
}
