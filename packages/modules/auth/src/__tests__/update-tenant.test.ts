import { beforeEach, describe, expect, mock, test } from "bun:test";
import { assertResultErr, assertResultOk } from "../../../__test-utils__/assert-result";
import { createMockContext } from "../../../__test-utils__/mock-context";
import type { auth as realAuth } from "../auth";

type Org = NonNullable<Awaited<ReturnType<typeof realAuth.api.updateOrganization>>>;

const updatedOrg: Org = {
  id: "org-1",
  name: "Updated Org",
  slug: "updated-org",
  createdAt: new Date(),
};

const mockUpdateOrganization = mock((): Promise<Org | null> => Promise.resolve(updatedOrg));

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

    expect(data).toEqual(updatedOrg);
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
