import { defineQuery, err, ok } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { auth } from "../auth";

const GetInvitationInput = Type.Object({
  invitationId: Type.String(),
});

/**
 * Retrieve a single invitation by ID.
 *
 * Used by the public invite accept page to display org name, inviter name, the
 * invited email (pre-fills signup), role, and status. Does NOT require auth.
 *
 * Because the endpoint is unauthenticated, the response is whitelisted to the
 * documented public contract (the fields the accept page actually renders)
 * rather than passing better-auth's raw object straight through — so a future
 * provider change can't accidentally leak extra internal fields
 * (auth-public-get-invitation-leaks-email).
 *
 * @param input - GetInvitationInput: invitationId (UUID)
 * @returns Result<PublicInvitation> -- whitelisted invitation details, or err.
 *
 * Per D-05 / INVT-04: branded landing page shows org name, inviter name, role.
 */
export const getInvitation = defineQuery(GetInvitationInput, async (input, _ctx) => {
  try {
    const invitation = (await auth.api.getInvitation({
      query: { id: input.invitationId },
      headers: new Headers(),
    })) as {
      id: string;
      organizationId: string;
      email: string;
      role: string;
      status: string;
      inviterId: string;
      organization?: { name?: string };
      inviter?: { user?: { name?: string; email?: string } };
    } | null;
    if (!invitation) return err("Invitation not found");

    // Whitelist to the public accept-page contract.
    return ok({
      id: invitation.id,
      organizationId: invitation.organizationId,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      inviterId: invitation.inviterId,
      organization: { name: invitation.organization?.name ?? "" },
      inviter: {
        user: {
          name: invitation.inviter?.user?.name ?? "",
          email: invitation.inviter?.user?.email ?? "",
        },
      },
    });
  } catch (error: any) {
    return err(error.message || "Failed to get invitation");
  }
});
