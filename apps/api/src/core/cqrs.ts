import type { CommandHandler, HandlerContext, QueryHandler, Result } from "@baseworks/shared";
import { err } from "@baseworks/shared";

/**
 * CQRS command/query bus. Dispatches to registered handlers by name.
 */
export class CqrsBus {
  private commands = new Map<string, CommandHandler<any, any>>();
  private queries = new Map<string, QueryHandler<any, any>>();

  registerCommand(name: string, handler: CommandHandler<any, any>): void {
    this.commands.set(name, handler);
  }

  registerQuery(name: string, handler: QueryHandler<any, any>): void {
    this.queries.set(name, handler);
  }

  async execute<T>(command: string, input: unknown, ctx: HandlerContext): Promise<Result<T>> {
    const handler = this.commands.get(command);
    if (!handler) {
      return err("COMMAND_NOT_FOUND");
    }
    return handler(input, ctx);
  }

  async query<T>(queryName: string, input: unknown, ctx: HandlerContext): Promise<Result<T>> {
    const handler = this.queries.get(queryName);
    if (!handler) {
      return err("QUERY_NOT_FOUND");
    }
    return handler(input, ctx);
  }

  hasCommand(name: string): boolean {
    return this.commands.has(name);
  }

  hasQuery(name: string): boolean {
    return this.queries.has(name);
  }
}
