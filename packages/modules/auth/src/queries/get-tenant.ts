import { Type } from "@sinclair/typebox";
import { defineQuery, ok, err } from "@baseworks/shared";
import { auth } from "../auth";

const GetTenantInput = Type.Object({
  organizationId: Type.String(),
});

/**
 * Get full tenant (organization) details including members.
 *
 * Per TNNT-03: Tenant read available via CQRS query.
 * Per Pitfall 6: Uses auth.api, not scopedDb.
 */
export const getTenant = defineQuery(GetTenantInput, async (input, _ctx) => {
  try {
    const org = await auth.api.getFullOrganization({
      query: { organizationId: input.organizationId },
      headers: new Headers(),
    });
    if (!org) return err("Tenant not found");
    return ok(org);
  } catch (error: any) {
    return err(error.message || "Failed to get tenant");
  }
});
