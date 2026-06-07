import { auth } from "@baseworks/module-auth";
import { setTenantContext } from "@baseworks/observability";
import { NoActiveTenantError, UnauthorizedError } from "@baseworks/shared";
import { Elysia } from "elysia";

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
 * signed up), auto-selects the user's organization deterministically
 * (orgs sorted by stable id so a multi-org user always binds to the
 * same tenant), and self-heals by lazily creating a personal workspace
 * if the user has zero organizations (e.g. the signup auto-create hook
 * failed) so they are never permanently locked out.
 *
 * @throws UnauthorizedError if no valid session exists
 * @throws NoActiveTenantError if no organization is available
 */
export const tenantMiddleware = new Elysia({ name: "tenant-context" }).derive(
  { as: "scoped" },
  async ({ request }) => {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      throw new UnauthorizedError();
    }

    let tenantId = session.session.activeOrganizationId;

    // Per Pitfall 3: activeOrganizationId may not be set after signup.
    // Auto-select the user's org if no active org is set.
    if (!tenantId) {
      try {
        const orgs = await auth.api.listOrganizations({
          headers: request.headers,
        });
        if (orgs && orgs.length > 0) {
          // Deterministic auto-select: sort by stable id so a user who
          // belongs to multiple orgs always binds to the same tenant when
          // no active org is set, instead of whatever order the API returns.
          const [firstOrg] = [...orgs].sort((a, b) => a.id.localeCompare(b.id));
          tenantId = firstOrg.id;
          // Try to set as active for future requests (non-blocking)
          try {
            await auth.api.setActiveOrganization({
              headers: request.headers,
              body: { organizationId: tenantId },
            });
          } catch {
            // Non-fatal: we have tenantId for this request
          }
        } else {
          // Self-healing: the user has zero organizations (e.g. the signup
          // auto-create hook threw and swallowed the error). Rather than
          // lock them out permanently with "No active tenant", lazily create
          // a personal workspace here. The slug mirrors the signup hook but
          // uses a random suffix so retries don't collide on the 8-char id
          // prefix.
          try {
            const displayName = session.user.name || session.user.email.split("@")[0];
            const created = await auth.api.createOrganization({
              headers: request.headers,
              body: {
                name: `${displayName}'s Workspace`,
                slug: `personal-${session.user.id.slice(0, 8)}-${crypto.randomUUID().slice(0, 8)}`,
                userId: session.user.id,
              },
            });
            if (created) {
              tenantId = created.id;
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
            // If creation fails, fall through to the "No active tenant" throw.
          }
        }
      } catch {
        // If listing fails, we have no tenant context
      }
    }

    if (!tenantId) {
      throw new NoActiveTenantError();
    }

    // Phase 19 D-04 — publish session-derived tenant/user into the unified
    // observability ALS so logs, spans, and wrapCqrsBus error capture all see
    // a single source of truth. Mutates the existing frame in place (no new
    // run() — forbidden by CTX-01).
    setTenantContext({ tenantId, userId: session.user.id });

    return {
      tenantId,
      userId: session.user.id,
      user: session.user,
      session: session.session,
    };
  },
);
