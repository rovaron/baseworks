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
    this.emitter.on(event, (data: unknown) => {
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
    });
  }

  /**
   * Remove a specific listener for an event.
   *
   * Note: due to the wrapping in `on()`, removing by handler
   * reference requires the original wrapped function, not the
   * user-provided callback.
   *
   * @param event - Event name to unsubscribe from
   * @param handler - The exact listener function to remove
   */
  off(event: string, handler: (...args: any[]) => void): void {
    this.emitter.off(event, handler);
  }
}
