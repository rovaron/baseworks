import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { auth as realAuth } from "../auth";

type Invitation = NonNullable<Awaited<ReturnType<typeof realAuth.api.getInvitation>>>;

const mockGetInvitation = mock((): Promise<Invitation | null> => Promise.resolve(null));

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

  test("returns whitelisted invitation on success (strips extra fields)", async () => {
    // The provider returns extra fields (organization/inviter/internalToken)
    // beyond the base Invitation type; the query must whitelist them away.
    const invitation: Invitation & {
      organization?: { name?: string };
      inviter?: { user?: { name?: string; email?: string } };
      internalToken?: string;
    } = {
      id: "inv-1",
      email: "invited@test.com",
      role: "member",
      status: "pending",
      organizationId: "org-1",
      inviterId: "user-9",
      expiresAt: new Date(),
      createdAt: new Date(),
      organizationName: "Test Org",
      organizationSlug: "test-org",
      inviterEmail: "admin@test.com",
      organization: { name: "Test Org" },
      inviter: { user: { name: "Admin User", email: "admin@test.com" } },
      // An internal field that must NOT leak through the public endpoint.
      internalToken: "do-not-leak",
    };
    mockGetInvitation.mockResolvedValueOnce(invitation);

    const result = await getInvitation({ invitationId: "inv-1" }, createMockCtx());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        id: "inv-1",
        organizationId: "org-1",
        email: "invited@test.com",
        role: "member",
        status: "pending",
        inviterId: "user-9",
        organization: { name: "Test Org" },
        inviter: { user: { name: "Admin User", email: "admin@test.com" } },
      });
      // The extra provider field is dropped by the whitelist.
      expect((result.data as Record<string, unknown>).internalToken).toBeUndefined();
    }
    expect(mockGetInvitation).toHaveBeenCalledWith({
      query: { id: "inv-1" },
      headers: expect.any(Headers),
    });
  });

  test("returns error when invitation not found", async () => {
    mockGetInvitation.mockResolvedValueOnce(null);

    const result = await getInvitation({ invitationId: "nonexistent" }, createMockCtx());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Invitation not found");
    }
  });

  test("returns error when auth.api throws", async () => {
    mockGetInvitation.mockRejectedValueOnce(new Error("Database error"));

    const result = await getInvitation({ invitationId: "inv-1" }, createMockCtx());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Database error");
    }
  });
});
