import { Type } from "@sinclair/typebox";
import { defineCommand, ok, err } from "@baseworks/shared";
import { auth } from "../auth";

const RejectInvitationInput = Type.Object({
  invitationId: Type.String(),
});

/**
 * Reject a pending invitation without joining the organization.
 *
 * Delegates to better-auth's rejectInvitation API which handles:
 * - Validating the invitation exists and is pending
 * - Marking the invitation as rejected
 *
 * Emits `invitation.rejected` with invitationId.
 *
 * @param input - RejectInvitationInput: invitationId (UUID)
 * @param ctx   - Handler context: tenantId, userId, db, emit,
 *   headers (forwarded to better-auth for session resolution)
 * @returns Result<object> -- better-auth rejection result, or
 *   err with failure message
 *
 * Per INVT-04: Invited user can decline an invitation.
 */
export const rejectInvitation = defineCommand(
  RejectInvitationInput,
  async (input, ctx) => {
    try {
      const result = await auth.api.rejectInvitation({
        body: { invitationId: input.invitationId },
        headers: ctx.headers ?? new Headers(),
      });

      ctx.emit("invitation.rejected", {
        invitationId: input.invitationId,
      });

      return ok(result);
    } catch (error: any) {
      return err(error.message || "Failed to reject invitation");
    }
  },
);
