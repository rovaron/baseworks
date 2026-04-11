import { Type } from "@sinclair/typebox";
import { defineCommand, ok, err } from "@baseworks/shared";
import { auth } from "../auth";

const AcceptInvitationInput = Type.Object({
  invitationId: Type.String(),
});

/**
 * Accept an invitation to join an organization.
 *
 * Delegates to better-auth's acceptInvitation API which handles:
 * - Validating the invitation exists and is pending
 * - Creating the member record with the assigned role
 * - Marking the invitation as accepted
 *
 * Per INVT-04: Invited user can accept invite and join the organization.
 */
export const acceptInvitation = defineCommand(
  AcceptInvitationInput,
  async (input, ctx) => {
    try {
      const result = await auth.api.acceptInvitation({
        body: { invitationId: input.invitationId },
        headers: ctx.headers ?? new Headers(),
      });

      ctx.emit("invitation.accepted", {
        invitationId: input.invitationId,
      });

      return ok(result);
    } catch (error: any) {
      return err(error.message || "Failed to accept invitation");
    }
  },
);
