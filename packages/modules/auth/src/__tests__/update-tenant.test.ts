import { describe, test, expect, mock, beforeEach } from "bun:test";
import { createMockContext } from "../../../__test-utils__/mock-context";
import { assertResultOk, assertResultErr } from "../../../__test-utils__/assert-result";

const mockUpdateOrganization = mock(() =>
  Promise.resolve({ id: "org-1", name: "Updated Org", slug: "updated-org" }),
);

mock.module("../auth", () => ({
  auth: {
    api: {
      updateOrganization: mockUpdateOrganization,
    },
  },
}));

const { updateTenant } = await import("../commands/update-tenant");

describe("updateTenant", () => {
  beforeEach(() => {
    mockUpdateOrganization.mockClear();
  });

  test("updates tenant successfully and returns updated org", async () => {
    const ctx = createMockContext();
    const input = { organizationId: "org-1", name: "Updated Org", slug: "updated-org" };

    const result = await updateTenant(input, ctx);
    const data = assertResultOk(result);

    expect(data).toEqual({ id: "org-1", name: "Updated Org", slug: "updated-org" });
    expect(mockUpdateOrganization).toHaveBeenCalledTimes(1);
    expect(mockUpdateOrganization).toHaveBeenCalledWith({
      body: {
        organizationId: "org-1",
        data: { name: "Updated Org", slug: "updated-org" },
      },
      headers: expect.any(Headers),
    });
  });

  test("returns error when auth.api throws", async () => {
    mockUpdateOrganization.mockRejectedValueOnce(new Error("Organization not found"));
    const ctx = createMockContext();
    const input = { organizationId: "org-1", name: "Fail" };

    const result = await updateTenant(input, ctx);
    const error = assertResultErr(result);

    expect(error).toBe("Organization not found");
  });

  test("separates organizationId from data fields in API call", async () => {
    const ctx = createMockContext();
    const input = { organizationId: "org-99", logo: "https://example.com/logo.png" };

    await updateTenant(input, ctx);

    expect(mockUpdateOrganization).toHaveBeenCalledWith({
      body: {
        organizationId: "org-99",
        data: { logo: "https://example.com/logo.png" },
      },
      headers: expect.any(Headers),
    });
  });
});
