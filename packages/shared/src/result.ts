import type { Result } from "./types/cqrs";

/**
 * Wrap a value in a successful Result.
 *
 * Use as the return value from CQRS handlers on success paths.
 * The returned object has `success: true` and the value accessible
 * via `data`.
 *
 * @param data - The success payload to wrap
 * @returns Result with `success: true` and `data` set to the provided value
 *
 * @example
 * const result = ok({ id: "tenant-123", name: "Acme" });
 * // result.success === true, result.data.id === "tenant-123"
 */
export function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

/**
 * Wrap an error message in a failed Result.
 *
 * Use for expected failures such as validation errors, not-found
 * conditions, or permission denied. Do not use for unexpected
 * exceptions -- let those propagate to the error middleware.
 *
 * @param error - Human-readable error message describing the failure
 * @returns Result with `success: false` and `error` set to the message
 *
 * @example
 * const result = err("Tenant not found");
 * // result.success === false, result.error === "Tenant not found"
 */
export function err(error: string): Result<never> {
  return { success: false, error };
}
