import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockGetFullOrganization = mock(() => Promise.resolve(null));

mock.module("../auth", () => ({
  auth: {
    api: {
      getFullOrganization: mockGetFullOrganization,
    },
  },
}));

const { listMembers } = await import("../queries/list-members");

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    db: {},
    emit: mock(() => {}),
    ...overrides,
  };
}

describe("listMembers", () => {
  beforeEach(() => {
    mockGetFullOrganization.mockReset();
  });

  test("returns members list for tenant", async () => {
    const members = [
      { userId: "user-1", role: "owner" },
      { userId: "user-2", role: "member" },
    ];
    mockGetFullOrganization.mockResolvedValueOnce({
      id: "org-1",
      name: "Test Org",
      members,
    });

    const result = await listMembers(
      { organizationId: "org-1" },
      createMockCtx(),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(members);
      expect(result.data).toHaveLength(2);
    }
  });

  test("returns empty array when org has no members field", async () => {
    mockGetFullOrganization.mockResolvedValueOnce({
      id: "org-1",
      name: "Test Org",
      members: undefined,
    });

    const result = await listMembers(
      { organizationId: "org-1" },
      createMockCtx(),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  test("returns error when tenant not found", async () => {
    mockGetFullOrganization.mockResolvedValueOnce(null);

    const result = await listMembers(
      { organizationId: "nonexistent" },
      createMockCtx(),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Tenant not found");
    }
  });

  test("returns error when auth.api throws", async () => {
    mockGetFullOrganization.mockRejectedValueOnce(
      new Error("Connection refused"),
    );

    const result = await listMembers(
      { organizationId: "org-1" },
      createMockCtx(),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Connection refused");
    }
  });
});
