/**
 * Declaration-merged interface mapping event names to their payload types.
 *
 * Modules extend this interface to register their domain events, enabling
 * type-safe event emission and subscription via the TypedEventBus. The
 * key is the event name (conventionally `module:action` format), and the
 * value is the payload shape.
 *
 * @example
 * declare module "@baseworks/shared" {
 *   interface DomainEvents {
 *     "billing:subscription-created": { tenantId: string; planId: string };
 *   }
 * }
 */
export interface DomainEvents {
  [key: string]: Record<string, unknown>;
}
