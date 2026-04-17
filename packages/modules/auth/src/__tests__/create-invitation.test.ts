import { describe, test, expect, mock, beforeEach } from "bun:test";
import { FormatRegistry } from "@sinclair/typebox";
import { createMockContext } from "../../../__test-utils__/mock-context";
import { assertResultOk, assertResultErr } from "../../../__test-utils__/assert-result";

// Register email format so TypeBox validation accepts email strings
if (!FormatRegistry.Has("email")) {
  FormatRegistry.Set("email", (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
}

const mockCreateInvitation = mock(() =>
  Promise.resolve({ id: "inv-1", email: "test@example.com", role: "member" }),
);

mock.module("../auth", () => ({
  auth: {
    api: {
      createInvitation: mockCreateInvitation,
    },
  },
}));

mock.module("nanoid", () => ({
  nanoid: () => "mock-id-123",
}));

const { createInvitation } = await import("../commands/create-invitation");

describe("createInvitation", () => {
  beforeEach(() => {
    mockCreateInvitation.mockClear();
    mockCreateInvitation.mockResolvedValue({
      id: "inv-1",
      email: "test@example.com",
      role: "member",
    });
  });

  test("creates email invitation and emits invitation.created event", async () => {
    const mockEmit = mock(() => {});
    const ctx = createMockContext({ emit: mockEmit });
    const input = {
      email: "new@example.com",
      role: "member" as const,
      organizationId: "org-1",
      mode: "email" as const,
    };

    const result = await createInvitation(input, ctx);
    const data = assertResultOk(result);

    expect(data.id).toBe("inv-1");
    expect(mockCreateInvitation).toHaveBeenCalledWith({
      body: {
        email: "new@example.com",
        role: "member",
        organizationId: "org-1",
      },
      headers: expect.any(Headers),
    });
    expect(mockEmit).toHaveBeenCalledWith("invitation.created", {
      invitationId: "inv-1",
      organizationId: "org-1",
      email: "new@example.com",
      mode: "email",
    });
  });

  test("creates link invitation with @internal placeholder email", async () => {
    mockCreateInvitation.mockResolvedValue({
      id: "inv-2",
      email: "link-invite-mock-id-123@internal",
      role: "admin",
    });
    const mockEmit = mock(() => {});
    const ctx = createMockContext({ emit: mockEmit });
    const input = {
      role: "admin" as const,
      organizationId: "org-1",
      mode: "link" as const,
    };

    const result = await createInvitation(input, ctx);
    assertResultOk(result);

    expect(mockCreateInvitation).toHaveBeenCalledWith({
      body: {
        email: "link-invite-mock-id-123@internal",
        role: "admin",
        organizationId: "org-1",
      },
      headers: expect.any(Headers),
    });
    expect(mockEmit).toHaveBeenCalledWith("invitation.created", {
      invitationId: "inv-2",
      organizationId: "org-1",
      email: "link-invite-mock-id-123@internal",
      mode: "link",
    });
  });

  test("returns error when auth.api.createInvitation throws", async () => {
    mockCreateInvitation.mockRejectedValueOnce(new Error("Duplicate invitation"));
    const ctx = createMockContext();
    const input = {
      email: "dup@example.com",
      role: "member" as const,
      organizationId: "org-1",
      mode: "email" as const,
    };

    const result = await createInvitation(input, ctx);
    const error = assertResultErr(result);

    expect(error).toBe("Duplicate invitation");
  });
});
