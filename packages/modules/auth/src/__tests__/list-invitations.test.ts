import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockListInvitations = mock(() => Promise.resolve([]));

mock.module("../auth", () => ({
  auth: {
    api: {
      listInvitations: mockListInvitations,
    },
  },
}));

const { listInvitations } = await import("../queries/list-invitations");

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    db: {},
    emit: mock(() => {}),
    ...overrides,
  };
}

describe("listInvitations", () => {
  beforeEach(() => {
    mockListInvitations.mockReset();
  });

  test("returns invitations list", async () => {
    const invitations = [
      { id: "inv-1", email: "a@test.com", role: "member", status: "pending" },
      { id: "inv-2", email: "b@test.com", role: "admin", status: "pending" },
    ];
    mockListInvitations.mockResolvedValueOnce(invitations);

    const result = await listInvitations(
      { organizationId: "org-1" },
      createMockCtx(),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(invitations);
      expect(result.data).toHaveLength(2);
    }
    expect(mockListInvitations).toHaveBeenCalledWith({
      query: { organizationId: "org-1" },
      headers: expect.any(Headers),
    });
  });

  test("returns empty array when no invitations", async () => {
    mockListInvitations.mockResolvedValueOnce([]);

    const result = await listInvitations(
      { organizationId: "org-1" },
      createMockCtx(),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
      expect(result.data).toHaveLength(0);
    }
  });

  test("returns ok with empty array when auth.api returns null", async () => {
    mockListInvitations.mockResolvedValueOnce(null);

    const result = await listInvitations(
      { organizationId: "org-1" },
      createMockCtx(),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  test("returns error when auth.api throws", async () => {
    mockListInvitations.mockRejectedValueOnce(
      new Error("Permission denied"),
    );

    const result = await listInvitations(
      { organizationId: "org-1" },
      createMockCtx(),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Permission denied");
    }
  });
});
