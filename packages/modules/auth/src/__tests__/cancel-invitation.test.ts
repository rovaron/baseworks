import { beforeEach, describe, expect, mock, test } from "bun:test";
import { assertResultErr, assertResultOk } from "../../../__test-utils__/assert-result";
import { createMockContext } from "../../../__test-utils__/mock-context";

// Shaped to match better-auth's cancelInvitation return type (the cancelled
// invitation record) so the typed `toEqual` assertion below stays sound.
const mockInvitation = {
  id: "inv-1",
  organizationId: "org-1",
  email: "user@example.com",
  role: "member" as const,
  status: "canceled" as const,
  inviterId: "user-1",
  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
};

const mockCancelInvitation = mock(() => Promise.resolve(mockInvitation));

mock.module("../auth", () => ({
  auth: {
    api: {
      cancelInvitation: mockCancelInvitation,
    },
  },
}));

const { cancelInvitation } = await import("../commands/cancel-invitation");

describe("cancelInvitation", () => {
  beforeEach(() => {
    mockCancelInvitation.mockClear();
  });

  test("cancels invitation and emits invitation.cancelled event", async () => {
    const mockEmit = mock(() => {});
    const ctx = createMockContext({ emit: mockEmit });
    const input = { invitationId: "inv-1", organizationId: "org-1" };

    const result = await cancelInvitation(input, ctx);
    const data = assertResultOk(result);

    expect(data).toEqual(mockInvitation);
    expect(mockCancelInvitation).toHaveBeenCalledWith({
      body: { invitationId: "inv-1" },
      headers: expect.any(Headers),
    });
    expect(mockEmit).toHaveBeenCalledWith("invitation.cancelled", {
      invitationId: "inv-1",
      organizationId: "org-1",
    });
  });

  test("returns error when auth.api throws", async () => {
    mockCancelInvitation.mockRejectedValueOnce(new Error("Not authorized to cancel"));
    const ctx = createMockContext();
    const input = { invitationId: "inv-1", organizationId: "org-1" };

    const result = await cancelInvitation(input, ctx);
    const error = assertResultErr(result);

    expect(error).toBe("Not authorized to cancel");
  });
});
