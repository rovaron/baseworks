import { Type } from "@sinclair/typebox";
import { defineQuery, ok, err } from "@baseworks/shared";
import { auth } from "../auth";

const ListInvitationsInput = Type.Object({
  organizationId: Type.String(),
});

/**
 * List pending invitations for an organization.
 *
 * Per D-03: Team tab shows pending invitations list.
 * Per INVT-05: Org admin can view pending invitations.
 * Per Pitfall 6: Uses auth.api, not scopedDb.
 */
export const listInvitations = defineQuery(
  ListInvitationsInput,
  async (input, _ctx) => {
    try {
      const invitations = await auth.api.listInvitations({
        query: { organizationId: input.organizationId },
        headers: new Headers(),
      });
      return ok(invitations || []);
    } catch (error: any) {
      return err(error.message || "Failed to list invitations");
    }
  },
);
