import { describe, test, expect } from "bun:test";

/**
 * Unit tests for decideInboundTrace (Phase 20.1 / D-12).
 *
 * Phase 20.1 dropped the CIDR + trusted-header trust gate. The helper is now
 * a thin parse-or-fresh wrapper: any well-formed inbound traceparent is
 * adopted (always-trust default for v1.3); malformed or absent → fresh ids.
 */

import { decideInboundTrace } from "../inbound-trace";

const VALID_INBOUND =
  "00-aabbccddeeff00112233445566778899-1122334455667788-01";

describe("decideInboundTrace (Phase 20.1 D-12 — always-trust default)", () => {
  test("inbound traceparent present and well-formed → adopted", () => {
    const req = new Request("https://x.test/", {
      headers: { traceparent: VALID_INBOUND },
    });
    const result = decideInboundTrace(req);

    expect(result.traceId).toBe("aabbccddeeff00112233445566778899");
    expect(result.spanId).toBe("1122334455667788");
  });

  test("inbound traceparent absent → fresh server-side ids", () => {
    const req = new Request("https://x.test/");
    const result = decideInboundTrace(req);

    expect(result.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(result.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  test("malformed inbound traceparent → fresh server-side ids", () => {
    const req = new Request("https://x.test/", {
      headers: { traceparent: "wrong-format" },
    });
    const result = decideInboundTrace(req);

    expect(result.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(result.traceId).not.toBe("aabbccddeeff00112233445566778899");
    expect(result.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  test("inbound traceparent with future version byte → fresh server-side ids", () => {
    // Spec only defines version 00 today; 01+ falls through to the fresh path.
    const req = new Request("https://x.test/", {
      headers: {
        traceparent:
          "01-aabbccddeeff00112233445566778899-1122334455667788-01",
      },
    });
    const result = decideInboundTrace(req);

    expect(result.traceId).not.toBe("aabbccddeeff00112233445566778899");
    expect(result.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  test("each fresh trace produces distinct ids (no module-level state leak)", () => {
    const req = new Request("https://x.test/");
    const a = decideInboundTrace(req);
    const b = decideInboundTrace(req);
    expect(a.traceId).not.toBe(b.traceId);
    expect(a.spanId).not.toBe(b.spanId);
  });
});
