import { TypeCompiler } from "@sinclair/typebox/compiler";
import type { Static, TSchema } from "@sinclair/typebox";

export type Result<T> = { success: true; data: T } | { success: false; error: string };

export interface HandlerContext {
  tenantId: string;
  userId?: string;
  db: any;
  emit: (event: string, data: unknown) => void;
  enqueue?: (job: string, data: unknown) => Promise<void>;
}

export type CommandHandler<TInput, TOutput> = (
  input: TInput,
  ctx: HandlerContext,
) => Promise<Result<TOutput>>;

export type QueryHandler<TInput, TOutput> = (
  input: TInput,
  ctx: HandlerContext,
) => Promise<Result<TOutput>>;

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
