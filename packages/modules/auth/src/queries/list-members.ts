import { Type } from "@sinclair/typebox";
import { defineQuery, ok, err } from "@baseworks/shared";
import { auth } from "../auth";

const ListMembersInput = Type.Object({
  organizationId: Type.String(),
});

/**
 * List all members of a tenant organization with their roles.
 *
 * Fetches the full organization via better-auth and extracts
 * the members array. Returns err if the organization is not
 * found.
 *
 * @param input - ListMembersInput: organizationId (UUID)
 * @param ctx   - Handler context (unused; auth.api is not
 *   tenant-scoped)
 * @returns Result<Member[]> -- array of member records with
 *   userId and role, or err if tenant not found
 *
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
