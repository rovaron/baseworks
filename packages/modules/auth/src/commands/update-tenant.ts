import { Type } from "@sinclair/typebox";
import { defineCommand, ok, err } from "@baseworks/shared";
import { auth } from "../auth";

const UpdateTenantInput = Type.Object({
  organizationId: Type.String(),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  slug: Type.Optional(
    Type.String({ minLength: 1, maxLength: 50, pattern: "^[a-z0-9-]+$" }),
  ),
  logo: Type.Optional(Type.String()),
});

/**
 * Update tenant (organization) settings.
 *
 * Per D-13: Admin-level action (role enforcement at route level).
 * Per Pitfall 6: Uses auth.api, not scopedDb.
 */
export const updateTenant = defineCommand(
  UpdateTenantInput,
  async (input, ctx) => {
    try {
      const { organizationId, ...data } = input;
      const org = await auth.api.updateOrganization({
        body: { organizationId, data },
        headers: new Headers(),
      });
      return ok(org);
    } catch (error: any) {
      return err(error.message || "Failed to update tenant");
    }
  },
);
