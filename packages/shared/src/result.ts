import type { Result } from "./types/cqrs";

export function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

export function err(error: string): Result<never> {
  return { success: false, error };
}
