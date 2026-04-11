import { Type } from "@sinclair/typebox";
import { defineCommand, ok, err } from "@baseworks/shared";
import { nanoid } from "nanoid";
import { auth } from "../auth";

const CreateInvitationInput = Type.Object({
  email: Type.Optional(Type.String({ format: "email" })),
  role: Type.Union([Type.Literal("admin"), Type.Literal("member")]),
  organizationId: Type.String(),
  mode: Type.Union([Type.Literal("email"), Type.Literal("link")]),
});

/**
 * Create an invitation to join an organization.
 *
 * Supports two modes:
 * - "email": Uses the provided email address. The sendInvitationEmail callback
 *   in auth.ts will enqueue an email to this address.
 * - "link": Generates a placeholder email `link-invite-{nanoid}@internal`.
 *   The sendInvitationEmail callback detects the @internal suffix and returns
 *   early, suppressing email delivery. The invitation ID is returned for
 *   constructing a shareable URL.
 *
 * Per D-04: Single invite dialog supports email and shareable link modes.
 * Per D-13: Only admin and member roles are assignable (owner is not).
 * Per INVT-01/INVT-03: Email invite and shareable link creation.
 */
export const createInvitation = defineCommand(
  CreateInvitationInput,
  async (input, ctx) => {
    try {
      // For link mode, generate a placeholder @internal email.
      // The sendInvitationEmail callback in auth.ts detects @internal
      // and skips email enqueueing. This is the email suppression contract.
      const email =
        input.mode === "link"
          ? `link-invite-${nanoid(10)}@internal`
          : input.email!;

      const invitation = await auth.api.createInvitation({
        body: {
          email,
          role: input.role,
          organizationId: input.organizationId,
        },
        headers: new Headers(),
      });

      ctx.emit("invitation.created", {
        invitationId: invitation.id,
        organizationId: input.organizationId,
        email,
        mode: input.mode,
      });

      return ok(invitation);
    } catch (error: any) {
      return err(error.message || "Failed to create invitation");
    }
  },
);
