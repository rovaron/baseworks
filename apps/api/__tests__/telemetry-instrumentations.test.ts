import { describe, test, expect } from "bun:test";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

/**
 * Phase 17 D-11 in-process probe. Bidirectional check on the
 * auto-instrumentation matrix: positive on enabled (HTTP/api-only, pino,
 * ioredis), negative on disabled (fs, dns, net). Catches drift where
 * someone re-enables a disabled instrumentation or removes pino/ioredis.
 *
 * Mirrors the exact matrix construction from apps/api/src/telemetry.ts —
 * if you change one, change both.
 */

type InstrConfig = { enabled?: boolean };
type InstrLike = {
  instrumentationName: string;
  getConfig?: () => InstrConfig;
};

function buildMatrix(role: "api" | "worker"): InstrLike[] {
  const isApiFlavour = role === "api";
  return getNodeAutoInstrumentations({
    "@opentelemetry/instrumentation-http":    { enabled: isApiFlavour },
    "@opentelemetry/instrumentation-ioredis": { enabled: true },
    "@opentelemetry/instrumentation-pino":    { enabled: true },
    "@opentelemetry/instrumentation-fs":      { enabled: false },
    "@opentelemetry/instrumentation-dns":     { enabled: false },
    "@opentelemetry/instrumentation-net":     { enabled: false },
  }) as unknown as InstrLike[];
}

function findByName(
  matrix: InstrLike[],
  suffix: string,
): InstrLike | undefined {
  return matrix.find((i) => i.instrumentationName?.endsWith(suffix));
}

function isEnabled(instr: InstrLike | undefined): boolean {
  if (!instr) return false;
  const cfg = instr.getConfig?.();
  // Treat unset enabled as "enabled" (OTEL default).
  return cfg?.enabled !== false;
}

describe("auto-instrumentation matrix (OBS-04 / D-11)", () => {
  const apiMatrix = buildMatrix("api");
  const workerMatrix = buildMatrix("worker");

  test("enabled in api role: http, ioredis, pino", () => {
    expect(isEnabled(findByName(apiMatrix, "instrumentation-http"))).toBe(true);
    expect(isEnabled(findByName(apiMatrix, "instrumentation-ioredis"))).toBe(
      true,
    );
    expect(isEnabled(findByName(apiMatrix, "instrumentation-pino"))).toBe(true);
  });

  test("disabled in api role: fs, dns, net", () => {
    expect(isEnabled(findByName(apiMatrix, "instrumentation-fs"))).toBe(false);
    expect(isEnabled(findByName(apiMatrix, "instrumentation-dns"))).toBe(false);
    expect(isEnabled(findByName(apiMatrix, "instrumentation-net"))).toBe(false);
  });

  test("worker role disables http (D-04)", () => {
    expect(isEnabled(findByName(workerMatrix, "instrumentation-http"))).toBe(
      false,
    );
  });

  test("worker role still enables ioredis and pino", () => {
    expect(isEnabled(findByName(workerMatrix, "instrumentation-ioredis"))).toBe(
      true,
    );
    expect(isEnabled(findByName(workerMatrix, "instrumentation-pino"))).toBe(
      true,
    );
  });

  test("no bullmq instrumentation in Phase 17 (D-12)", () => {
    const allNames = apiMatrix.map((i) => i.instrumentationName ?? "");
    expect(allNames.some((n) => n.includes("bullmq"))).toBe(false);
  });
});
