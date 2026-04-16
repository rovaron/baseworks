import { Type } from "@sinclair/typebox";
import { defineCommand, ok, err } from "@baseworks/shared";
import { auth } from "../auth";

const DeleteTenantInput = Type.Object({
  organizationId: Type.String(),
});

/**
 * Delete a tenant organization permanently. Owner-only action.
 *
 * Delegates to better-auth's deleteOrganization API and emits
 * a `tenant.deleted` (TenantDeleted) domain event with tenantId
 * and deletedBy for downstream cleanup (e.g., billing teardown).
 *
 * @param input - DeleteTenantInput: organizationId (UUID)
 * @param ctx   - Handler context: tenantId, userId, db, emit
 * @returns Result<{ deleted: true }> -- confirmation object, or
 *   err with failure message
 *
 * Per D-13: Owner-only action. Role enforcement happens at the
 * route level via requireRole("owner").
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
