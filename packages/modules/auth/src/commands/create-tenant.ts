import { Type } from "@sinclair/typebox";
import { defineCommand, ok, err } from "@baseworks/shared";
import { auth } from "../auth";

const CreateTenantInput = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  slug: Type.Optional(
    Type.String({ minLength: 1, maxLength: 50, pattern: "^[a-z0-9-]+$" }),
  ),
});

/**
 * Create a new tenant organization and assign the requesting
 * user as owner.
 *
 * Inserts an organization record via better-auth, auto-generates
 * a slug from the name if not provided, and emits a
 * `tenant.created` domain event for downstream listeners
 * (e.g., billing customer provisioning).
 *
 * @param input - CreateTenantInput: name (1-100 chars), slug
 *   (optional, lowercase alphanumeric with hyphens)
 * @param ctx   - Handler context: tenantId, userId, db, emit
 * @returns Result<Organization> -- the created organization
 *   record, or err with failure message
 *
 * Per D-15: Auth module commands wrap better-auth org API.
 * Per TNNT-03: Tenant CRUD available via CQRS handlers.
 * Per Pitfall 6: Auth/org tables accessed via auth.api, not
 * scopedDb.
 */
export const createTenant = defineCommand(
  CreateTenantInput,
  async (input, ctx) => {
    try {
      const slug =
        input.slug ||
        input.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 50);

      const org = await auth.api.createOrganization({
        body: {
          name: input.name,
          slug,
          userId: ctx.userId,
        },
      });

      ctx.emit("tenant.created", {
        tenantId: org.id,
        createdBy: ctx.userId,
      });

      return ok(org);
    } catch (error: any) {
      return err(error.message || "Failed to create tenant");
    }
  },
);
