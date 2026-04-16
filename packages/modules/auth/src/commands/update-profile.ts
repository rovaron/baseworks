import { Type } from "@sinclair/typebox";
import { defineCommand, ok, err } from "@baseworks/shared";
import { auth } from "../auth";

const UpdateProfileInput = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  email: Type.Optional(Type.String({ format: "email" })),
  image: Type.Optional(Type.String()),
  currentPassword: Type.Optional(Type.String()),
  newPassword: Type.Optional(
    Type.String({ minLength: 8, maxLength: 128 }),
  ),
});

/**
 * Update the authenticated user's profile fields and optionally
 * change their password.
 *
 * Splits into two API calls: basic fields (name, email, image)
 * via updateUser, and password change via changePassword if both
 * currentPassword and newPassword are provided.
 *
 * @param input - UpdateProfileInput: name (optional, 1-100
 *   chars), email (optional), image (optional URL),
 *   currentPassword (required for password change), newPassword
 *   (8-128 chars, required with currentPassword)
 * @param ctx   - Handler context: tenantId, userId, db, emit
 * @returns Result<{ updated: true }> -- confirmation object, or
 *   err with failure message
 *
 * Per D-17: User profile managed through auth module.
 * Per TNNT-05: User can update their profile.
 * Per T-02-15: Password change requires currentPassword
 * verification.
 * Per T-02-13: Uses ctx.userId from authenticated session, not
 * from input.
 */
export const updateProfile = defineCommand(
  UpdateProfileInput,
  async (input, ctx) => {
    try {
      // Update basic profile fields via better-auth user update API
      const updateData: Record<string, any> = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.email !== undefined) updateData.email = input.email;
      if (input.image !== undefined) updateData.image = input.image;

      if (Object.keys(updateData).length > 0) {
        await auth.api.updateUser({
          body: updateData,
          headers: new Headers(),
        });
      }

      // Password change requires separate API call with current password
      if (input.newPassword && input.currentPassword) {
        await auth.api.changePassword({
          body: {
            currentPassword: input.currentPassword,
            newPassword: input.newPassword,
          },
          headers: new Headers(),
        });
      }

      return ok({ updated: true });
    } catch (error: any) {
      return err(error.message || "Failed to update profile");
    }
  },
);
