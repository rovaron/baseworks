import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import os from "node:os";
import { resolveInstanceId } from "../instance-id";

const ORIGINAL_INSTANCE_ID = process.env.INSTANCE_ID;
const ORIGINAL_HOSTNAME = process.env.HOSTNAME;

function reset() {
  delete process.env.INSTANCE_ID;
  delete process.env.HOSTNAME;
}

beforeEach(reset);
afterEach(() => {
  reset();
  if (ORIGINAL_INSTANCE_ID !== undefined) process.env.INSTANCE_ID = ORIGINAL_INSTANCE_ID;
  if (ORIGINAL_HOSTNAME !== undefined) process.env.HOSTNAME = ORIGINAL_HOSTNAME;
});

describe("resolveInstanceId() — Phase 22 / D-12 fallback chain", () => {
  test("returns INSTANCE_ID when set", () => {
    process.env.INSTANCE_ID = "pod-abc";
    process.env.HOSTNAME = "host-1";
    expect(resolveInstanceId()).toBe("pod-abc");
  });

  test("returns HOSTNAME when INSTANCE_ID unset", () => {
    process.env.HOSTNAME = "host-1";
    expect(resolveInstanceId()).toBe("host-1");
  });

  test("returns os.hostname() when both INSTANCE_ID and HOSTNAME unset", () => {
    // os.hostname() returns a non-empty string on every supported OS.
    expect(resolveInstanceId()).toBe(os.hostname());
    expect(resolveInstanceId().length).toBeGreaterThan(0);
  });

  test("prefers INSTANCE_ID over HOSTNAME when BOTH set", () => {
    process.env.INSTANCE_ID = "explicit";
    process.env.HOSTNAME = "implicit";
    expect(resolveInstanceId()).toBe("explicit");
  });
});
