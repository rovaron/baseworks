import { describe, expect, test } from "bun:test";
import { assertRlsConfigured } from "../env";

/**
 * Tenant RLS prod-gating: production must have DATABASE_URL_RLS so tenant request
 * paths use the RLS-enforced role rather than silently falling back to the
 * RLS-bypassing owner connection. Dev/test may omit it.
 */
describe("assertRlsConfigured", () => {
  test("throws in production when DATABASE_URL_RLS is unset", () => {
    expect(() => assertRlsConfigured("production", undefined)).toThrow(/DATABASE_URL_RLS/);
  });

  test("passes in production when DATABASE_URL_RLS is set", () => {
    expect(() =>
      assertRlsConfigured("production", "postgres://baseworks_rls:x@db:5432/app"),
    ).not.toThrow();
  });

  test("allows dev/test without it", () => {
    expect(() => assertRlsConfigured("test", undefined)).not.toThrow();
    expect(() => assertRlsConfigured("development", undefined)).not.toThrow();
  });
});
