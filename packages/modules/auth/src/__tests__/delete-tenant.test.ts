import { describe, test, expect, mock, beforeEach } from "bun:test";
import { createMockContext } from "../../../__test-utils__/mock-context";
import { assertResultOk, assertResultErr } from "../../../__test-utils__/assert-result";

const mockDeleteOrganization = mock(() => Promise.resolve({ deleted: true }));

mock.module("../auth", () => ({
  auth: {
    api: {
      deleteOrganization: mockDeleteOrganization,
    },
  },
}));

const { deleteTenant } = await import("../commands/delete-tenant");

describe("deleteTenant", () => {
  beforeEach(() => {
    mockDeleteOrganization.mockClear();
  });

  test("deletes tenant and emits tenant.deleted event", async () => {
    const mockEmit = mock(() => {});
    const ctx = createMockContext({ emit: mockEmit, userId: "user-42" });
    const input = { organizationId: "org-1" };

    const result = await deleteTenant(input, ctx);
    const data = assertResultOk(result);

    expect(data).toEqual({ deleted: true });
    expect(mockEmit).toHaveBeenCalledWith("tenant.deleted", {
      tenantId: "org-1",
      deletedBy: "user-42",
    });
  });

  test("returns error when auth.api throws", async () => {
    mockDeleteOrganization.mockRejectedValueOnce(new Error("Not authorized"));
    const ctx = createMockContext();
    const input = { organizationId: "org-1" };

    const result = await deleteTenant(input, ctx);
    const error = assertResultErr(result);

    expect(error).toBe("Not authorized");
  });

  test("passes organizationId correctly to auth.api", async () => {
    const ctx = createMockContext();
    const input = { organizationId: "org-specific-id" };

    await deleteTenant(input, ctx);

    expect(mockDeleteOrganization).toHaveBeenCalledWith({
      body: { organizationId: "org-specific-id" },
      headers: expect.any(Headers),
    });
  });
});
