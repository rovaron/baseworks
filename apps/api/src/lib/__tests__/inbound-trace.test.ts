import { describe, test, expect, beforeEach, mock } from "bun:test";

/**
 * Unit tests for decideInboundTrace (Phase 19 / D-07 / D-08).
 *
 * decideInboundTrace reads `@baseworks/config`'s env at module load time,
 * so each test must re-import the module after stubbing env via
 * `mock.module("@baseworks/config", ...)` and the `?t=${Date.now()}`
 * cache-bust dynamic-import pattern established in Phase 18 Plan 02.
 */

async function loadHelper(envOverrides: {
  OBS_TRUST_TRACEPARENT_FROM?: string;
  OBS_TRUST_TRACEPARENT_HEADER?: string;
}): Promise<typeof import("../inbound-trace")> {
  // Stub @baseworks/config BEFORE the dynamic import so the module sees
  // the mocked env during its module-init CIDR parse.
  mock.module("@baseworks/config", () => ({
    env: {
      OBS_TRUST_TRACEPARENT_FROM: envOverrides.OBS_TRUST_TRACEPARENT_FROM,
      OBS_TRUST_TRACEPARENT_HEADER: envOverrides.OBS_TRUST_TRACEPARENT_HEADER,
    },
  }));
  return await import(`../inbound-trace?t=${Date.now()}${Math.random()}`);
}

const VALID_INBOUND =
  "00-aabbccddeeff00112233445566778899-1122334455667788-01";

describe("decideInboundTrace", () => {
  beforeEach(() => {
    // Clear process env between tests so leftover values cannot leak
    // into the mocked `env` object.
    delete process.env.OBS_TRUST_TRACEPARENT_FROM;
    delete process.env.OBS_TRUST_TRACEPARENT_HEADER;
  });

  test("default untrusted (D-07): no env → fresh trace, inboundCarrier preserved for Link", async () => {
    const { decideInboundTrace } = await loadHelper({});
    const req = new Request("https://x.test/", {
      headers: { traceparent: VALID_INBOUND },
    });
    const result = decideInboundTrace(req, "10.1.1.1");

    // Fresh trace — traceId must differ from the inbound.
    expect(result.traceId).not.toBe(
      "aabbccddeeff00112233445566778899",
    );
    expect(result.traceId).toHaveLength(32);
    expect(result.spanId).toHaveLength(16);
    // Inbound preserved in carrier for Phase 21 OTEL Link attachment.
    expect(result.inboundCarrier.traceparent).toBe(VALID_INBOUND);
  });

  test("trusted CIDR match: inbound adopted as parent, carrier cleared", async () => {
    const { decideInboundTrace } = await loadHelper({
      OBS_TRUST_TRACEPARENT_FROM: "10.0.0.0/8",
    });
    const req = new Request("https://x.test/", {
      headers: { traceparent: VALID_INBOUND },
    });
    const result = decideInboundTrace(req, "10.1.2.3");

    expect(result.traceId).toBe("aabbccddeeff00112233445566778899");
    expect(result.spanId).toBe("1122334455667788");
    // Carrier cleared once adopted — it's now the parent, not a Link.
    expect(result.inboundCarrier).toEqual({});
  });

  test("trusted CIDR miss: non-matching remote-addr → fresh trace, carrier preserved", async () => {
    const { decideInboundTrace } = await loadHelper({
      OBS_TRUST_TRACEPARENT_FROM: "10.0.0.0/8",
    });
    const req = new Request("https://x.test/", {
      headers: { traceparent: VALID_INBOUND },
    });
    const result = decideInboundTrace(req, "192.168.1.1");

    expect(result.traceId).not.toBe(
      "aabbccddeeff00112233445566778899",
    );
    expect(result.traceId).toHaveLength(32);
    expect(result.spanId).toHaveLength(16);
    expect(result.inboundCarrier.traceparent).toBe(VALID_INBOUND);
  });

  test("trusted header present (D-08 alt path): inbound adopted", async () => {
    const { decideInboundTrace } = await loadHelper({
      OBS_TRUST_TRACEPARENT_HEADER: "X-Internal-Source",
    });
    const req = new Request("https://x.test/", {
      headers: {
        traceparent: VALID_INBOUND,
        "x-internal-source": "gateway",
      },
    });
    const result = decideInboundTrace(req, "203.0.113.1");

    expect(result.traceId).toBe("aabbccddeeff00112233445566778899");
    expect(result.spanId).toBe("1122334455667788");
    expect(result.inboundCarrier).toEqual({});
  });

  test("trusted header absent: fresh trace even with valid inbound", async () => {
    const { decideInboundTrace } = await loadHelper({
      OBS_TRUST_TRACEPARENT_HEADER: "X-Internal-Source",
    });
    const req = new Request("https://x.test/", {
      headers: { traceparent: VALID_INBOUND },
    });
    const result = decideInboundTrace(req, "203.0.113.1");

    expect(result.traceId).not.toBe(
      "aabbccddeeff00112233445566778899",
    );
    expect(result.traceId).toHaveLength(32);
    expect(result.inboundCarrier.traceparent).toBe(VALID_INBOUND);
  });

  test("malformed inbound traceparent (trusted CIDR): regex guard → fresh trace", async () => {
    const { decideInboundTrace } = await loadHelper({
      OBS_TRUST_TRACEPARENT_FROM: "10.0.0.0/8",
    });
    const req = new Request("https://x.test/", {
      headers: { traceparent: "wrong-format" },
    });
    const result = decideInboundTrace(req, "10.1.1.1");

    expect(result.traceId).toHaveLength(32);
    expect(result.spanId).toHaveLength(16);
    // Bad-format inbound still preserved in carrier for debugging.
    expect(result.inboundCarrier.traceparent).toBe("wrong-format");
  });

  test("malformed remote-addr: no throw, fresh trace", async () => {
    const { decideInboundTrace } = await loadHelper({
      OBS_TRUST_TRACEPARENT_FROM: "10.0.0.0/8",
    });
    const req = new Request("https://x.test/", {
      headers: { traceparent: VALID_INBOUND },
    });
    // ipaddr.parse("not-an-ip") throws internally — helper must catch it.
    const result = decideInboundTrace(req, "not-an-ip");

    expect(result.traceId).not.toBe(
      "aabbccddeeff00112233445566778899",
    );
    expect(result.traceId).toHaveLength(32);
    expect(result.inboundCarrier.traceparent).toBe(VALID_INBOUND);
  });

  test("IPv6 CIDR match: ::1/128 + ::1 remote → adopted", async () => {
    const { decideInboundTrace } = await loadHelper({
      OBS_TRUST_TRACEPARENT_FROM: "::1/128",
    });
    const req = new Request("https://x.test/", {
      headers: { traceparent: VALID_INBOUND },
    });
    const result = decideInboundTrace(req, "::1");

    expect(result.traceId).toBe("aabbccddeeff00112233445566778899");
    expect(result.spanId).toBe("1122334455667788");
    expect(result.inboundCarrier).toEqual({});
  });
});
