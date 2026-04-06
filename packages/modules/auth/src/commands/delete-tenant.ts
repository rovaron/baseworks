import { Type } from "@sinclair/typebox";
import { defineCommand, ok, err } from "@baseworks/shared";
import { auth } from "../auth";

const DeleteTenantInput = Type.Object({
  organizationId: Type.String(),
});

/**
 * Delete a tenant (organization). Owner-only action.
 *
 * Per D-13: Owner-only action. Role enforcement happens at the route
 * level via requireRole("owner").
 * Per Pitfall 6: Uses auth.api, not scopedDb.
 */
export const deleteTenant = defineCommand(
  DeleteTenantInput,
  async (input, ctx) => {
    try {
      await auth.api.deleteOrganization({
        body: { organizationId: input.organizationId },
        headers: new Headers(),
      });

      ctx.emit("tenant.deleted", {
        tenantId: input.organizationId,
        deletedBy: ctx.userId,
      });

      return ok({ deleted: true });
    } catch (error: any) {
      return err(error.message || "Failed to delete tenant");
    }
  },
);
