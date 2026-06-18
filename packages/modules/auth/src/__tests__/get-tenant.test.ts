import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createMockContext } from "../../../__test-utils__/mock-context";
import type { auth as realAuth } from "../auth";

type FullOrg = NonNullable<Awaited<ReturnType<typeof realAuth.api.getFullOrganization>>>;

const mockGetFullOrganization = mock((): Promise<FullOrg | null> => Promise.resolve(null));

mock.module("../auth", () => ({
  auth: {
    api: {
      getFullOrganization: mockGetFullOrganization,
    },
  },
}));

const { getTenant } = await import("../queries/get-tenant");

describe("getTenant", () => {
  beforeEach(() => {
    mockGetFullOrganization.mockReset();
  });

  test("returns tenant data on success", async () => {
    const orgData: FullOrg = {
      id: "org-1",
      name: "Test Org",
      slug: "test-org",
      createdAt: new Date(),
      invitations: [],
      members: [
        {
          id: "mem-1",
          organizationId: "org-1",
          userId: "user-1",
          role: "owner",
          createdAt: new Date(),
          user: { id: "user-1", email: "owner@test.com", name: "Owner" },
        },
      ],
    };
    mockGetFullOrganization.mockResolvedValueOnce(orgData);

    const result = await getTenant({ organizationId: "org-1" }, createMockContext());

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

    const result = await getTenant({ organizationId: "nonexistent" }, createMockContext());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Tenant not found");
    }
  });

  test("returns error when auth.api throws", async () => {
    mockGetFullOrganization.mockRejectedValueOnce(new Error("Network failure"));

    const result = await getTenant({ organizationId: "org-1" }, createMockContext());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Network failure");
    }
  });
});
