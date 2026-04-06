import { Elysia } from "elysia";

/**
 * Tenant context middleware. Extracts tenantId from the x-tenant-id header
 * and injects it into the request context.
 *
 * Uses `as: 'scoped'` so the derive applies only to routes registered
 * after this middleware in the same plugin scope (not to routes like /health
 * registered before it).
 *
 * Phase 1: Extracts from x-tenant-id header (untrusted, development only).
 * Phase 2: Will replace with session-derived tenant from better-auth.
 *
 * @see T-01-09, T-01-10 in threat model
 */
export const tenantMiddleware = new Elysia({ name: "tenant-context" }).derive(
  { as: "scoped" },
  ({ request }) => {
    const tenantId = request.headers.get("x-tenant-id");

    if (!tenantId) {
      // TODO: Phase 2 replaces with session-derived tenant from better-auth
      throw new Error("Missing tenant context");
    }

    return { tenantId };
  },
);
