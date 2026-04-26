import { describe, test, expect } from "bun:test";
import { readRequestId } from "../request-id";

/**
 * Phase 20.1 D-17 / H-02 — readRequestId validation regression tests.
 *
 * 19-REVIEW.md H-02: the Bun.serve fetch wrapper trusted inbound
 * `x-request-id` verbatim, opening log-injection / correlation-poisoning /
 * cardinality surfaces. Helper now validates against
 * ^[A-Za-z0-9_-]{1,128}$ and falls through to crypto.randomUUID() on
 * invalid / absent input.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reqWith(headers: Record<string, string>): Request {
  return new Request("http://localhost/", { headers });
}

describe("readRequestId — Phase 20.1 D-17 / H-02 validation", () => {
  test("valid id (alnum + _ + -) is preserved", () => {
    expect(readRequestId(reqWith({ "x-request-id": "abc-123_XYZ" }))).toBe(
      "abc-123_XYZ",
    );
  });

  test("UUID is preserved", () => {
    const u = "550e8400-e29b-41d4-a716-446655440000";
    expect(readRequestId(reqWith({ "x-request-id": u }))).toBe(u);
  });

  test("id with newline is rejected; falls through to fresh UUID", () => {
    const result = readRequestId(
      reqWith({ "x-request-id": "foo\n[CRITICAL] fake" }),
    );
    expect(result).toMatch(UUID_RE);
  });

  test("id over 128 chars is rejected; falls through to fresh UUID", () => {
    const result = readRequestId(
      reqWith({ "x-request-id": "a".repeat(200) }),
    );
    expect(result).toMatch(UUID_RE);
  });

  test("missing header returns a fresh UUID", () => {
    expect(readRequestId(reqWith({}))).toMatch(UUID_RE);
  });

  test("id with disallowed chars (semicolon) is rejected", () => {
    const result = readRequestId(
      reqWith({ "x-request-id": "foo;DROP TABLE users" }),
    );
    expect(result).toMatch(UUID_RE);
  });
});
