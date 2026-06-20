import { defineQuery, err, ok } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { auth } from "../auth";

const ListInvitationsInput = Type.Object({
  organizationId: Type.String(),
});

/**
 * List all pending invitations for a tenant organization.
 *
 * Returns all invitations (pending, accepted, rejected) for
 * the specified organization. Filtered to pending in the UI.
 *
 * @param input - ListInvitationsInput: organizationId (UUID)
 * @param ctx   - Handler context; ctx.headers forwards the
 *   authenticated session to auth.api
 * @returns Result<Invitation[]> -- array of invitation records,
 *   or empty array if none
 *
 * Per D-03: Team tab shows pending invitations list.
 * Per INVT-05: Org admin can view pending invitations.
 * Per Pitfall 6: Uses auth.api, not scopedDb.
 */
export const listInvitations = defineQuery(ListInvitationsInput, async (input, ctx) => {
  try {
    const invitations = await auth.api.listInvitations({
      query: { organizationId: input.organizationId },
      headers: ctx.headers ?? new Headers(),
    });
    return ok(invitations || []);
  } catch (error: any) {
    return err(error.message || "Failed to list invitations");
  }
});
