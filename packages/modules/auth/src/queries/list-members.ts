import { Type } from "@sinclair/typebox";
import { defineQuery, ok, err } from "@baseworks/shared";
import { auth } from "../auth";

const ListMembersInput = Type.Object({
  organizationId: Type.String(),
});

/**
 * List members of a tenant (organization).
 *
 * Uses getFullOrganization to get member list.
 * Per TNNT-03: Tenant member listing via CQRS query.
 * Per Pitfall 6: Uses auth.api, not scopedDb.
 */
export const listMembers = defineQuery(
  ListMembersInput,
  async (input, _ctx) => {
    try {
      const org = await auth.api.getFullOrganization({
        query: { organizationId: input.organizationId },
        headers: new Headers(),
      });
      if (!org) return err("Tenant not found");
      return ok(org.members || []);
    } catch (error: any) {
      return err(error.message || "Failed to list members");
    }
  },
);
