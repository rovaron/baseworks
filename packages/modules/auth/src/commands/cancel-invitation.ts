import { defineCommand, err, ok } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { auth } from "../auth";

const CancelInvitationInput = Type.Object({
  invitationId: Type.String(),
  organizationId: Type.String(),
});

/**
 * Cancel a pending invitation sent by the organization.
 *
 * Only roles granted invitation:create can cancel invitations (enforced at
 * route level via requirePermission). Delegates to better-auth's
 * cancelInvitation API.
 *
 * Emits `invitation.cancelled` with invitationId and
 * organizationId.
 *
 * @param input - CancelInvitationInput: invitationId (UUID),
 *   organizationId (UUID)
 * @param ctx   - Handler context: tenantId, userId, db, emit
 * @returns Result<object> -- better-auth cancellation result,
 *   or err with failure message
 *
 * Per D-12: Admin can revoke any pending invitation from
 * management page.
 * Per INVT-05: Invitation management including cancellation.
 */
export const cancelInvitation = defineCommand(CancelInvitationInput, async (input, ctx) => {
  try {
    // better-auth's cancelInvitation body only accepts invitationId; the
    // organizationId stays in the input schema for authorization/event context
    // (emitted below) but is not part of the better-auth API call.
    const result = await auth.api.cancelInvitation({
      body: {
        invitationId: input.invitationId,
      },
      headers: ctx.headers ?? new Headers(),
    });

    ctx.emit("invitation.cancelled", {
      invitationId: input.invitationId,
      organizationId: input.organizationId,
    });

    return ok(result);
  } catch (error: any) {
    return err(error.message || "Failed to cancel invitation");
  }
});
