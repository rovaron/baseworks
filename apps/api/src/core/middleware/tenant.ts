import { Elysia } from "elysia";
import { auth } from "@baseworks/module-auth";

/**
 * Tenant context middleware. Derives tenantId from the authenticated
 * session's activeOrganizationId.
 *
 * Replaces Phase 1's x-tenant-id header extraction with
 * server-side session lookup. Adds `tenantId`, `userId`, `user`,
 * and `session` to the Elysia derive context for downstream routes.
 *
 * Per D-16: tenantId comes from session, not header.
 * Per T-02-05: Cross-tenant access prevented by deriving tenantId
 * from server-side session.
 * Per T-02-09: activeOrganizationId stored server-side in session
 * table; client cannot spoof.
 *
 * Uses `as: 'scoped'` so the derive applies only to routes
 * registered after this middleware in the same plugin scope (not
 * to routes like /health or /api/auth/* registered before it).
 *
 * Per Pitfall 3: If activeOrganizationId is null (e.g., just
 * signed up), auto-selects the user's first organization.
 *
 * @throws Error("Unauthorized") if no valid session exists
 * @throws Error("No active tenant") if no organization is available
 */
export const tenantMiddleware = new Elysia({ name: "tenant-context" }).derive(
  { as: "scoped" },
  async ({ request }) => {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      throw new Error("Unauthorized");
    }

    let tenantId = session.session.activeOrganizationId;

    // Per Pitfall 3: activeOrganizationId may not be set after signup.
    // Auto-select user's first org if no active org is set.
    if (!tenantId) {
      try {
        const orgs = await auth.api.listOrganizations({
          headers: request.headers,
        });
        if (orgs && orgs.length > 0) {
          tenantId = orgs[0].id;
          // Try to set as active for future requests (non-blocking)
          try {
            await auth.api.setActiveOrganization({
              headers: request.headers,
              body: { organizationId: tenantId },
            });
          } catch {
            // Non-fatal: we have tenantId for this request
          }
        }
      } catch {
        // If listing fails, we have no tenant context
      }
    }

    if (!tenantId) {
      throw new Error("No active tenant");
    }

    return {
      tenantId,
      userId: session.user.id,
      user: session.user,
      session: session.session,
    };
  },
);
