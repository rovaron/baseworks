import { beforeEach, describe, expect, mock, test } from "bun:test";
import { assertResultErr, assertResultOk } from "../../../__test-utils__/assert-result";
import { createMockContext } from "../../../__test-utils__/mock-context";
import type { auth as realAuth } from "../auth";

type AcceptResult = NonNullable<Awaited<ReturnType<typeof realAuth.api.acceptInvitation>>>;

// Mirror the real better-auth acceptInvitation contract ({ invitation, member })
// so the pass-through assertion type-checks against the command's return type.
const acceptResult: AcceptResult = {
  invitation: {
    id: "inv-1",
    organizationId: "org-1",
    email: "invited@test.com",
    role: "member",
    status: "accepted",
    inviterId: "user-9",
    expiresAt: new Date(),
    createdAt: new Date(),
  },
  member: {
    id: "member-1",
    organizationId: "org-1",
    userId: "user-1",
    role: "member",
    createdAt: new Date(),
  },
};

const mockAcceptInvitation = mock((): Promise<AcceptResult> => Promise.resolve(acceptResult));

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

    expect(data).toEqual(acceptResult);
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
