import { Type } from "@sinclair/typebox";
import { defineCommand, ok, err } from "@baseworks/shared";
import { auth } from "../auth";

const CancelInvitationInput = Type.Object({
  invitationId: Type.String(),
  organizationId: Type.String(),
});

/**
 * Cancel a pending invitation.
 *
 * Only owners and admins can cancel invitations (enforced at route level).
 * Delegates to better-auth's cancelInvitation API.
 *
 * Per D-12: Admin can revoke any pending invitation from management page.
 * Per INVT-05: Invitation management including cancellation.
 */
export const cancelInvitation = defineCommand(
  CancelInvitationInput,
  async (input, ctx) => {
    try {
      const result = await auth.api.cancelInvitation({
        body: {
          invitationId: input.invitationId,
          organizationId: input.organizationId,
        },
        headers: new Headers(),
      });

      ctx.emit("invitation.cancelled", {
        invitationId: input.invitationId,
        organizationId: input.organizationId,
      });

      return ok(result);
    } catch (error: any) {
      return err(error.message || "Failed to cancel invitation");
    }
  },
);
