import { expect } from "bun:test";
import type { Result } from "@baseworks/shared";

/**
 * Assert that a Result is successful and return the unwrapped data.
 *
 * Calls `expect(result.success).toBe(true)` and throws with
 * the error message if the result is a failure. Returns `result.data`
 * so callers can assign and inspect the value directly.
 *
 * @param result - The Result to assert on
 * @returns The unwrapped data of type T
 * @throws If result.success is false
 */
export function assertResultOk<T>(result: Result<T>): T {
  if (!result.success) {
    throw new Error(
      `Expected Result to be ok, but got error: ${result.error}`,
    );
  }
  expect(result.success).toBe(true);
  return result.data;
}

/**
 * Assert that a Result is a failure, optionally checking the error message.
 *
 * Calls `expect(result.success).toBe(false)`. If `expectedError` is
 * provided, also checks that the error message contains it.
 * Returns the error message string for further assertions.
 *
 * @param result - The Result to assert on
 * @param expectedError - Optional substring to match against the error message
 * @returns The error message string
 */
export function assertResultErr(
  result: Result<unknown>,
  expectedError?: string,
): string {
  expect(result.success).toBe(false);
  if (!result.success) {
    if (expectedError) {
      expect(result.error).toContain(expectedError);
    }
    return result.error;
  }
  // Unreachable — the expect above will throw — but satisfies TypeScript
  throw new Error("Expected Result to be an error");
}
