import { EventEmitter } from "node:events";
import { logger } from "../lib/logger";

/**
 * Typed in-process event bus wrapping Node.js EventEmitter.
 *
 * Modules emit domain events after state changes (e.g.,
 * `"auth:tenant-created"`); other modules subscribe to react
 * asynchronously. Async subscriber errors are caught and logged
 * with error isolation -- a failing listener does not prevent
 * other listeners from executing.
 *
 * Event names and payload types are declared via the
 * {@link DomainEvents} interface using declaration merging.
 */
export class TypedEventBus {
  private emitter = new EventEmitter();
  // Maps each (event → original handler → wrapped listener) so off() can remove
  // the exact wrapper on() registered, instead of the original reference (which
  // the emitter never saw). Without this, off() silently fails to unsubscribe.
  private wrappers = new Map<
    string,
    Map<(data: any) => void | Promise<void>, (data: unknown) => void>
  >();

  /**
   * Emit a typed domain event to all registered listeners.
   *
   * Executes listeners synchronously in registration order. Each
   * listener runs with error isolation -- a failing listener does
   * not prevent other listeners from executing.
   *
   * @param event - Event name (key of DomainEvents interface)
   * @param data - Event payload matching the DomainEvents type
   *
   * @example
   * eventBus.emit("auth:tenant-created",
   *   { tenantId: "t-123", name: "Acme" });
   */
  emit(event: string, data: unknown): void {
    this.emitter.emit(event, data);
  }

  /**
   * Register a listener for a typed domain event.
   *
   * Wraps the handler with error isolation: synchronous throws
   * and rejected promises are caught and logged via pino without
   * crashing the process.
   *
   * @param event - Event name (key of DomainEvents interface)
   * @param handler - Async or sync callback receiving the payload
   *
   * @example
   * eventBus.on("auth:tenant-created", async (payload) => {
   *   await createBillingCustomer(payload.tenantId);
   * });
   */
  on(event: string, handler: (data: any) => void | Promise<void>): void {
    const wrapped = (data: unknown) => {
      try {
        const result = handler(data);
        // Handle async errors
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch((err) => {
            logger.error({ err, event }, "Event subscriber error (async)");
          });
        }
      } catch (err) {
        logger.error({ err, event }, "Event subscriber error (sync)");
      }
    };
    let perEvent = this.wrappers.get(event);
    if (!perEvent) {
      perEvent = new Map();
      this.wrappers.set(event, perEvent);
    }
    perEvent.set(handler, wrapped);
    this.emitter.on(event, wrapped);
  }

  /**
   * Remove a previously-registered listener using the ORIGINAL handler
   * reference passed to `on()`. The wrapped listener actually held by the
   * emitter is resolved via the per-event wrapper map.
   *
   * @param event - Event name to unsubscribe from
   * @param handler - The original handler reference passed to `on()`
   */
  off(event: string, handler: (data: any) => void | Promise<void>): void {
    const perEvent = this.wrappers.get(event);
    const wrapped = perEvent?.get(handler);
    if (perEvent && wrapped) {
      this.emitter.off(event, wrapped);
      perEvent.delete(handler);
      if (perEvent.size === 0) this.wrappers.delete(event);
    } else {
      // Fallback: a listener added outside on() (raw reference).
      this.emitter.off(event, handler as (data: unknown) => void);
    }
  }
}
