import { describe, test, expect, spyOn } from "bun:test";
import { processFollowup } from "../jobs/process-followup";

/**
 * Behavioral tests for the processFollowup BullMQ job handler.
 *
 * No mock.module(...) block is required because process-followup.ts has
 * zero external imports beyond standard globals. The handler is a demo
 * log-and-resolve implementation per Phase 15 RESEARCH Open Question 1;
 * these tests exercise its two observable truths: it resolves on valid
 * input and it logs both id fields so operators can correlate.
 */

describe("processFollowup", () => {
  test("resolves without throwing on valid payload", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    await expect(
      processFollowup({ exampleId: "ex-1", tenantId: "tenant-1" }),
    ).resolves.toBeUndefined();

    logSpy.mockRestore();
  });

  test("logs example id and tenant id", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    await processFollowup({ exampleId: "ex-42", tenantId: "tenant-99" });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const callArg = logSpy.mock.calls[0]?.[0] as string;
    expect(callArg).toContain("ex-42");
    expect(callArg).toContain("tenant-99");

    logSpy.mockRestore();
  });
});
