import type { CommandHandler, QueryHandler } from "./cqrs";

export interface JobDefinition {
  queue: string;
  handler: (data: unknown) => Promise<void>;
}

/**
 * Module definition contract. Each module exports a single object satisfying this interface.
 *
 * The `routes` function receives an Elysia app instance. The type is left generic here
 * to avoid a runtime dependency on elysia in the shared package. Modules that implement
 * routes will import Elysia in their own package.
 */
export interface ModuleDefinition {
  name: string;
  routes?: ((app: any) => any) | any;
  commands?: Record<string, CommandHandler<any, any>>;
  queries?: Record<string, QueryHandler<any, any>>;
  jobs?: Record<string, JobDefinition>;
  events?: string[];
}
