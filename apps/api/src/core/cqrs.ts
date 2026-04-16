import type { CommandHandler, HandlerContext, QueryHandler, Result } from "@baseworks/shared";
import { err } from "@baseworks/shared";

/**
 * Command-Query Responsibility Segregation bus.
 *
 * Routes typed command and query dispatches to registered handlers.
 * Each handler is registered with a namespaced key (e.g.,
 * `"auth:create-tenant"`) and receives validated input plus a
 * {@link HandlerContext}. The ModuleRegistry populates handlers
 * during module loading; route handlers call `execute` and `query`
 * at request time.
 */
export class CqrsBus {
  private commands = new Map<string, CommandHandler<any, any>>();
  private queries = new Map<string, QueryHandler<any, any>>();

  /**
   * Register a command handler under a namespaced key.
   *
   * Called by ModuleRegistry during module loading. Overwrites any
   * previously registered handler for the same key.
   *
   * @param name - Namespaced command identifier (e.g., "auth:create-tenant")
   * @param handler - CommandHandler function to invoke on dispatch
   */
  registerCommand(name: string, handler: CommandHandler<any, any>): void {
    this.commands.set(name, handler);
  }

  /**
   * Register a query handler under a namespaced key.
   *
   * Called by ModuleRegistry during module loading. Overwrites any
   * previously registered handler for the same key.
   *
   * @param name - Namespaced query identifier (e.g., "auth:get-tenant")
   * @param handler - QueryHandler function to invoke on dispatch
   */
  registerQuery(name: string, handler: QueryHandler<any, any>): void {
    this.queries.set(name, handler);
  }

  /**
   * Dispatch a command to its registered handler.
   *
   * Validates that the command key exists and passes input + context
   * to the handler. Returns `err("COMMAND_NOT_FOUND")` if no handler
   * is registered for the given key.
   *
   * @param command - Namespaced command identifier
   * @param input - Validated command input
   * @param ctx - HandlerContext with tenantId, userId, db, emit
   * @returns Promise<Result<T>> from the handler
   *
   * @example
   * const result = await bus.execute("auth:create-tenant",
   *   { name: "Acme" }, ctx);
   * if (!result.success) throw new Error(result.error);
   * return result.data; // { id: "...", name: "Acme" }
   */
  async execute<T>(command: string, input: unknown, ctx: HandlerContext): Promise<Result<T>> {
    const handler = this.commands.get(command);
    if (!handler) {
      return err("COMMAND_NOT_FOUND");
    }
    return handler(input, ctx);
  }

  /**
   * Dispatch a query to its registered handler.
   *
   * Validates that the query key exists and passes input + context
   * to the handler. Returns `err("QUERY_NOT_FOUND")` if no handler
   * is registered for the given key.
   *
   * @param queryName - Namespaced query identifier
   * @param input - Validated query input
   * @param ctx - HandlerContext with tenantId, userId, db, emit
   * @returns Promise<Result<T>> from the handler
   *
   * @example
   * const result = await bus.query("auth:get-tenant",
   *   { tenantId: ctx.tenantId }, ctx);
   * if (!result.success) return notFound();
   * return result.data;
   */
  async query<T>(queryName: string, input: unknown, ctx: HandlerContext): Promise<Result<T>> {
    const handler = this.queries.get(queryName);
    if (!handler) {
      return err("QUERY_NOT_FOUND");
    }
    return handler(input, ctx);
  }

  /** Check whether a command handler is registered for the given key. */
  hasCommand(name: string): boolean {
    return this.commands.has(name);
  }

  /** Check whether a query handler is registered for the given key. */
  hasQuery(name: string): boolean {
    return this.queries.has(name);
  }
}
