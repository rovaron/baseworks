import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockGetInvitation = mock(() => Promise.resolve(null));

mock.module("../auth", () => ({
  auth: {
    api: {
      getInvitation: mockGetInvitation,
    },
  },
}));

const { getInvitation } = await import("../queries/get-invitation");

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    db: {},
    emit: mock(() => {}),
    ...overrides,
  };
}

describe("getInvitation", () => {
  beforeEach(() => {
    mockGetInvitation.mockReset();
  });

  test("returns invitation on success", async () => {
    const invitation = {
      id: "inv-1",
      email: "invited@test.com",
      role: "member",
      status: "pending",
      organizationId: "org-1",
      organization: { name: "Test Org" },
      inviter: { user: { name: "Admin User" } },
    };
    mockGetInvitation.mockResolvedValueOnce(invitation);

    const result = await getInvitation(
      { invitationId: "inv-1" },
      createMockCtx(),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(invitation);
    }
    expect(mockGetInvitation).toHaveBeenCalledWith({
      query: { id: "inv-1" },
      headers: expect.any(Headers),
    });
  });

  test("returns error when invitation not found", async () => {
    mockGetInvitation.mockResolvedValueOnce(null);

    const result = await getInvitation(
      { invitationId: "nonexistent" },
      createMockCtx(),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Invitation not found");
    }
  });

  test("returns error when auth.api throws", async () => {
    mockGetInvitation.mockRejectedValueOnce(new Error("Database error"));

    const result = await getInvitation(
      { invitationId: "inv-1" },
      createMockCtx(),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Database error");
    }
  });
});
