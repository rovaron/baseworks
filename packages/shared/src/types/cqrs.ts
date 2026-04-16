import { TypeCompiler } from "@sinclair/typebox/compiler";
import type { Static, TSchema } from "@sinclair/typebox";

/**
 * Discriminated union representing the outcome of a CQRS handler.
 *
 * All command and query handlers return `Result<T>`. Consumers must check
 * `result.success` before accessing `result.data` or `result.error`.
 * This is the standard return type across all Baseworks CQRS handlers.
 */
export type Result<T> = { success: true; data: T } | { success: false; error: string };

/**
 * Context object passed to all CQRS command and query handlers.
 *
 * Provides tenant-scoped database access, user identity, and the
 * ability to emit domain events. Constructed by the route layer
 * from the authenticated session.
 */
export interface HandlerContext {
  /** UUID of the active tenant (organization) for this request. */
  tenantId: string;
  /** UUID of the authenticated user. Undefined for system-level operations. */
  userId?: string;
  /** Tenant-scoped Drizzle database instance (ScopedDb). */
  db: any;
  /** Emit a domain event to the typed event bus. */
  emit: (event: string, data: unknown) => void;
  /** Enqueue a background job via BullMQ. Optional; unavailable in test contexts. */
  enqueue?: (job: string, data: unknown) => Promise<void>;
}

/**
 * Function signature for CQRS command handlers.
 *
 * Accepts validated input of type `TInput` and a `HandlerContext`,
 * returning a `Result<TOutput>` wrapped in a Promise. Commands
 * represent state-changing operations (create, update, delete).
 */
export type CommandHandler<TInput, TOutput> = (
  input: TInput,
  ctx: HandlerContext,
) => Promise<Result<TOutput>>;

/**
 * Function signature for CQRS query handlers.
 *
 * Accepts validated input of type `TInput` and a `HandlerContext`,
 * returning a `Result<TOutput>` wrapped in a Promise. Queries
 * represent read-only operations that do not modify state.
 */
export type QueryHandler<TInput, TOutput> = (
  input: TInput,
  ctx: HandlerContext,
) => Promise<Result<TOutput>>;

/**
 * Define a validated CQRS command handler with TypeBox schema validation.
 *
 * Compiles the TypeBox schema at module load time for fast runtime validation.
 * Returns a wrapped handler that validates input before delegation. Invalid
 * input produces a `Result` with `success: false` and a `VALIDATION_ERROR`
 * message containing all schema violations.
 *
 * @param schema - TypeBox schema defining the command's input shape
 * @param handler - Async function implementing the command logic
 * @returns Wrapped CommandHandler that validates input before executing
 *
 * @example
 * export const createTenant = defineCommand(CreateTenantSchema, async (input, ctx) => {
 *   const tenant = await ctx.db.insert(tenants).values({ name: input.name }).returning();
 *   return ok(tenant[0]);
 * });
 */
export function defineCommand<S extends TSchema, TOutput>(
  schema: S,
  handler: CommandHandler<Static<S>, TOutput>,
): CommandHandler<Static<S>, TOutput> {
  const compiled = TypeCompiler.Compile(schema);
  return async (input: Static<S>, ctx: HandlerContext): Promise<Result<TOutput>> => {
    if (!compiled.Check(input)) {
      const errors = [...compiled.Errors(input)];
      const message = errors.map((e) => `${e.path}: ${e.message}`).join(", ");
      return { success: false, error: `VALIDATION_ERROR: ${message}` };
    }
    return handler(input, ctx);
  };
}

/**
 * Define a validated CQRS query handler with TypeBox schema validation.
 *
 * Compiles the TypeBox schema at module load time for fast runtime validation.
 * Returns a wrapped handler that validates input before delegation. Invalid
 * input produces a `Result` with `success: false` and a `VALIDATION_ERROR`
 * message containing all schema violations.
 *
 * @param schema - TypeBox schema defining the query's input shape
 * @param handler - Async function implementing the query logic
 * @returns Wrapped QueryHandler that validates input before executing
 *
 * @example
 * export const getTenant = defineQuery(GetTenantSchema, async (input, ctx) => {
 *   const tenant = await ctx.db.select(tenants).where(eq(tenants.id, input.tenantId));
 *   return tenant ? ok(tenant) : err("Tenant not found");
 * });
 */
export function defineQuery<S extends TSchema, TOutput>(
  schema: S,
  handler: QueryHandler<Static<S>, TOutput>,
): QueryHandler<Static<S>, TOutput> {
  const compiled = TypeCompiler.Compile(schema);
  return async (input: Static<S>, ctx: HandlerContext): Promise<Result<TOutput>> => {
    if (!compiled.Check(input)) {
      const errors = [...compiled.Errors(input)];
      const message = errors.map((e) => `${e.path}: ${e.message}`).join(", ");
      return { success: false, error: `VALIDATION_ERROR: ${message}` };
    }
    return handler(input, ctx);
  };
}
