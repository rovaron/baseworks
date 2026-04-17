import { expect } from "bun:test";
import type { Result } from "@baseworks/shared";

/**
 * Assert that a Result is successful and narrow its type.
 *
 * Calls `expect(result.success).toBe(true)` and throws with
 * the error message if the result is a failure. After this
 * assertion, TypeScript narrows the result to `{ success: true; data: T }`.
 *
 * @param result - The Result to assert on
 * @throws If result.success is false
 */
export function assertResultOk<T>(
  result: Result<T>,
): asserts result is { success: true; data: T } {
  if (!result.success) {
    throw new Error(
      `Expected Result to be ok, but got error: ${result.error}`,
    );
  }
  expect(result.success).toBe(true);
}

/**
 * Assert that a Result is a failure, optionally checking the error message.
 *
 * Calls `expect(result.success).toBe(false)`. If `expectedError` is
 * provided, also checks that the error message contains it.
 *
 * @param result - The Result to assert on
 * @param expectedError - Optional substring to match against the error message
 */
export function assertResultErr(
  result: Result<unknown>,
  expectedError?: string,
): void {
  expect(result.success).toBe(false);
  if (expectedError && !result.success) {
    expect(result.error).toContain(expectedError);
  }
}
