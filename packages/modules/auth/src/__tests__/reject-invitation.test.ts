import { beforeEach, describe, expect, mock, test } from "bun:test";
import { assertResultErr, assertResultOk } from "../../../__test-utils__/assert-result";
import { createMockContext } from "../../../__test-utils__/mock-context";
import type { auth as realAuth } from "../auth";

type RejectResult = Awaited<ReturnType<typeof realAuth.api.rejectInvitation>>;

const rejectionResult: RejectResult = {
  invitation: {
    id: "inv-1",
    organizationId: "org-1",
    email: "invited@test.com",
    role: "member",
    status: "rejected",
    inviterId: "user-9",
    expiresAt: new Date(),
    createdAt: new Date(),
  },
  member: null,
};

const mockRejectInvitation = mock((): Promise<RejectResult> => Promise.resolve(rejectionResult));

mock.module("../auth", () => ({
  auth: {
    api: {
      rejectInvitation: mockRejectInvitation,
    },
  },
}));

const { rejectInvitation } = await import("../commands/reject-invitation");

describe("rejectInvitation", () => {
  beforeEach(() => {
    mockRejectInvitation.mockClear();
  });

  test("rejects invitation and emits invitation.rejected event", async () => {
    const mockEmit = mock(() => {});
    const ctx = createMockContext({ emit: mockEmit });
    const input = { invitationId: "inv-1" };

    const result = await rejectInvitation(input, ctx);
    const data = assertResultOk(result);

    expect(data).toEqual(rejectionResult);
    expect(mockRejectInvitation).toHaveBeenCalledWith({
      body: { invitationId: "inv-1" },
      headers: expect.any(Headers),
    });
    expect(mockEmit).toHaveBeenCalledWith("invitation.rejected", {
      invitationId: "inv-1",
    });
  });

  test("forwards ctx.headers to auth.api for session resolution", async () => {
    const customHeaders = new Headers({ authorization: "Bearer token-456" });
    const ctx = createMockContext({ headers: customHeaders });
    const input = { invitationId: "inv-2" };

    await rejectInvitation(input, ctx);

    expect(mockRejectInvitation).toHaveBeenCalledWith({
      body: { invitationId: "inv-2" },
      headers: customHeaders,
    });
  });

  test("returns error when auth.api throws", async () => {
    mockRejectInvitation.mockRejectedValueOnce(new Error("Invitation not found"));
    const ctx = createMockContext();
    const input = { invitationId: "inv-missing" };

    const result = await rejectInvitation(input, ctx);
    const error = assertResultErr(result);

    expect(error).toBe("Invitation not found");
  });
});
