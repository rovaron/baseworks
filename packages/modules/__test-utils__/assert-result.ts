import { expect } from "bun:test";

/**
 * Assert that a Result is successful and return the data.
 */
export function assertResultOk<T>(result: { success: boolean; data?: T; error?: string }): T {
  expect(result.success).toBe(true);
  return (result as any).data;
}

/**
 * Assert that a Result is an error and return the error message.
 */
export function assertResultErr(result: { success: boolean; data?: any; error?: string }): string {
  expect(result.success).toBe(false);
  return (result as any).error;
}
