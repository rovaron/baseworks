import { Type } from "@sinclair/typebox";
import { defineQuery, ok, err } from "@baseworks/shared";
import { auth } from "../auth";

const GetInvitationInput = Type.Object({
  invitationId: Type.String(),
});

/**
 * Get single invitation details.
 *
 * This query is used by the public invite accept page to display
 * org name, inviter name, and assigned role. It does NOT require
 * authentication context.
 *
 * Per D-05: Branded landing page shows org name, inviter name, role.
 * Per INVT-04: Invite accept page displays invitation details.
 */
export const getInvitation = defineQuery(
  GetInvitationInput,
  async (input, _ctx) => {
    try {
      const invitation = await auth.api.getInvitation({
        query: { id: input.invitationId },
        headers: new Headers(),
      });
      if (!invitation) return err("Invitation not found");
      return ok(invitation);
    } catch (error: any) {
      return err(error.message || "Failed to get invitation");
    }
  },
);
