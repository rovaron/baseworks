import type { CommandHandler, QueryHandler } from "./cqrs";

/**
 * Defines a background job that a module registers for BullMQ processing.
 *
 * Each job specifies a named queue and an async handler function. The module
 * registry registers these with the worker entrypoint, which creates BullMQ
 * Worker instances for each queue.
 */
export interface JobDefinition {
  /** BullMQ queue name, conventionally `module:action` (e.g., `email:send`). */
  queue: string;
  /** Async function that processes the job payload. */
  handler: (data: unknown) => Promise<void>;
}

/**
 * Contract that all Baseworks modules must satisfy.
 *
 * Declares routes, commands, queries, jobs, and events that the module
 * provides. The ModuleRegistry loads modules listed in config and wires
 * their declarations into the CQRS bus, event bus, and Elysia route tree.
 *
 * The `routes` function receives an Elysia app instance. The type is left
 * generic here to avoid a runtime dependency on Elysia in the shared package.
 * Modules that implement routes will import Elysia in their own package.
 */
export interface ModuleDefinition {
  /** Unique module identifier used for CQRS command/query namespacing. */
  name: string;
  /** Elysia plugin factory or plugin instance providing HTTP routes. */
  routes?: ((app: any) => any) | any;
  /** Map of command names to validated CommandHandler functions. */
  commands?: Record<string, CommandHandler<any, any>>;
  /** Map of query names to validated QueryHandler functions. */
  queries?: Record<string, QueryHandler<any, any>>;
  /** Map of job names to JobDefinition for BullMQ worker registration. */
  jobs?: Record<string, JobDefinition>;
  /** List of domain event names this module may emit. */
  events?: string[];
}
