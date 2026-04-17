import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockGetFullOrganization = mock(() => Promise.resolve(null));

mock.module("../auth", () => ({
  auth: {
    api: {
      getFullOrganization: mockGetFullOrganization,
    },
  },
}));

const { getTenant } = await import("../queries/get-tenant");

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    db: {},
    emit: mock(() => {}),
    ...overrides,
  };
}

describe("getTenant", () => {
  beforeEach(() => {
    mockGetFullOrganization.mockReset();
  });

  test("returns tenant data on success", async () => {
    const orgData = {
      id: "org-1",
      name: "Test Org",
      slug: "test-org",
      members: [{ userId: "user-1", role: "owner" }],
    };
    mockGetFullOrganization.mockResolvedValueOnce(orgData);

    const result = await getTenant(
      { organizationId: "org-1" },
      createMockCtx(),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(orgData);
    }
    expect(mockGetFullOrganization).toHaveBeenCalledWith({
      query: { organizationId: "org-1" },
      headers: expect.any(Headers),
    });
  });

  test("returns error when tenant not found", async () => {
    mockGetFullOrganization.mockResolvedValueOnce(null);

    const result = await getTenant(
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
      new Error("Network failure"),
    );

    const result = await getTenant(
      { organizationId: "org-1" },
      createMockCtx(),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Network failure");
    }
  });
});
