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
 * Update tenant organization display name, slug, or logo.
 *
 * Extracts organizationId from input and forwards remaining
 * fields to better-auth's updateOrganization API.
 *
 * @param input - UpdateTenantInput: organizationId (UUID), name
 *   (optional, 1-100 chars), slug (optional), logo (optional URL)
 * @param ctx   - Handler context: tenantId, userId, db, emit
 * @returns Result<Organization> -- the updated organization
 *   record, or err with failure message
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
