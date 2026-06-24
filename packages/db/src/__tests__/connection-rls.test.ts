// packages/db/src/__tests__/connection-rls.test.ts
import { describe, expect, test } from "bun:test";
import { getRlsDb } from "../connection";

describe("getRlsDb", () => {
  test("returns a singleton when DATABASE_URL_RLS is set", () => {
    process.env.DATABASE_URL_RLS ??=
      "postgres://baseworks_rls:baseworks_rls_dev@localhost:5432/baseworks";
    const a = getRlsDb();
    const b = getRlsDb();
    expect(a).toBe(b);
  });
});
