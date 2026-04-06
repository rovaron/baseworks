import { EventEmitter } from "node:events";
import { logger } from "../lib/logger";

/**
 * Typed in-process event bus wrapping Node.js EventEmitter.
 * Async subscriber errors are caught and logged (fire-and-forget).
 */
export class TypedEventBus {
  private emitter = new EventEmitter();

  emit(event: string, data: unknown): void {
    this.emitter.emit(event, data);
  }

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

  off(event: string, handler: (...args: any[]) => void): void {
    this.emitter.off(event, handler);
  }
}
