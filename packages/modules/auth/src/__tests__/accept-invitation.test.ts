import { describe, test, expect, mock, beforeEach } from "bun:test";
import { createMockContext } from "../../../__test-utils__/mock-context";
import { assertResultOk, assertResultErr } from "../../../__test-utils__/assert-result";

const mockAcceptInvitation = mock(() =>
  Promise.resolve({ accepted: true }),
);

mock.module("../auth", () => ({
  auth: {
    api: {
      acceptInvitation: mockAcceptInvitation,
    },
  },
}));

const { acceptInvitation } = await import("../commands/accept-invitation");

describe("acceptInvitation", () => {
  beforeEach(() => {
    mockAcceptInvitation.mockClear();
  });

  test("accepts invitation and emits invitation.accepted event", async () => {
    const mockEmit = mock(() => {});
    const ctx = createMockContext({ emit: mockEmit });
    const input = { invitationId: "inv-1" };

    const result = await acceptInvitation(input, ctx);
    const data = assertResultOk(result);

    expect(data).toEqual({ accepted: true });
    expect(mockAcceptInvitation).toHaveBeenCalledWith({
      body: { invitationId: "inv-1" },
      headers: expect.any(Headers),
    });
    expect(mockEmit).toHaveBeenCalledWith("invitation.accepted", {
      invitationId: "inv-1",
    });
  });

  test("forwards ctx.headers to auth.api for session resolution", async () => {
    const customHeaders = new Headers({ authorization: "Bearer token-123" });
    const ctx = createMockContext({ headers: customHeaders });
    const input = { invitationId: "inv-2" };

    await acceptInvitation(input, ctx);

    expect(mockAcceptInvitation).toHaveBeenCalledWith({
      body: { invitationId: "inv-2" },
      headers: customHeaders,
    });
  });

  test("returns error when auth.api throws", async () => {
    mockAcceptInvitation.mockRejectedValueOnce(new Error("Invitation expired"));
    const ctx = createMockContext();
    const input = { invitationId: "inv-expired" };

    const result = await acceptInvitation(input, ctx);
    const error = assertResultErr(result);

    expect(error).toBe("Invitation expired");
  });
});
