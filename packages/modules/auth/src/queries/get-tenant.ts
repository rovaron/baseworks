import { defineQuery, err, ok } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { auth } from "../auth";

const GetTenantInput = Type.Object({
  organizationId: Type.String(),
});

/**
 * Retrieve full tenant organization details including members.
 *
 * Fetches the organization via better-auth's getFullOrganization
 * API, which includes the member list with roles.
 *
 * @param input - GetTenantInput: organizationId (UUID)
 * @param ctx   - Handler context; ctx.headers forwards the
 *   authenticated session to auth.api
 * @returns Result<FullOrganization> -- organization with members
 *   array, or err if not found
 *
 * Per TNNT-03: Tenant read available via CQRS query.
 * Per Pitfall 6: Uses auth.api, not scopedDb.
 */
export const getTenant = defineQuery(GetTenantInput, async (input, ctx) => {
  try {
    const org = await auth.api.getFullOrganization({
      query: { organizationId: input.organizationId },
      headers: ctx.headers ?? new Headers(),
    });
    if (!org) return err("Tenant not found");
    return ok(org);
  } catch (error: any) {
    return err(error.message || "Failed to get tenant");
  }
});
