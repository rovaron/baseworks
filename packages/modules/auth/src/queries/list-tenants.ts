import { Type } from "@sinclair/typebox";
import { defineQuery, ok, err } from "@baseworks/shared";
import { auth } from "../auth";

const ListTenantsInput = Type.Object({});

/**
 * List all tenants the authenticated user belongs to.
 *
 * Returns all organizations where the user has a membership
 * record. Used for tenant switching in the frontend sidebar.
 *
 * @param input - ListTenantsInput (empty object, no filters)
 * @param ctx   - Handler context (unused; auth.api resolves
 *   user from session headers)
 * @returns Result<Organization[]> -- array of organizations,
 *   or empty array if none
 *
 * Per TNNT-03: Tenant listing via CQRS query.
 * Per Pitfall 6: Uses auth.api, not scopedDb.
 */
export const listTenants = defineQuery(
  ListTenantsInput,
  async (_input, _ctx) => {
    try {
      const orgs = await auth.api.listOrganizations({
        headers: new Headers(),
      });
      return ok(orgs || []);
    } catch (error: any) {
      return err(error.message || "Failed to list tenants");
    }
  },
);
