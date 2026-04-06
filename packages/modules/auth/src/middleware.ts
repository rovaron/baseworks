import { Elysia } from "elysia";
import { auth } from "./auth";

/**
 * Auth macro plugin for session injection into protected routes.
 *
 * Usage in routes:
 * ```ts
 * .get("/protected", ({ user, session }) => { ... }, { auth: true })
 * ```
 *
 * Per RESEARCH.md Pattern 1: Uses .macro() with resolve to inject
 * user and session into the route context.
 */
export const betterAuthPlugin = new Elysia({ name: "better-auth" }).macro({
  auth: {
    async resolve({ status, request: { headers } }: any) {
      const session = await auth.api.getSession({
        headers,
      });
      if (!session) return status(401);
      return {
        user: session.user,
        session: session.session,
      };
    },
  },
});

/**
 * Role guard middleware. Checks the user's role in the active organization.
 *
 * Per D-12: Composable requireRole('admin') derive that checks the active
 * user's membership role for the current tenant. Returns 403 on insufficient permissions.
 *
 * Usage:
 * ```ts
 * .use(requireRole("owner", "admin"))
 * .get("/admin-only", handler)
 * ```
 */
export function requireRole(...roles: string[]) {
  return new Elysia({ name: `require-role-${roles.join(",")}` }).derive(
    { as: "scoped" },
    async (ctx: any) => {
      const session = await auth.api.getSession({
        headers: ctx.request.headers,
      });
      if (!session) {
        throw new Error("Unauthorized");
      }

      const activeOrgId = session.session.activeOrganizationId;
      if (!activeOrgId) {
        throw new Error("No active organization");
      }

      // Use better-auth organization plugin API to get full org with members
      const fullOrg = await auth.api.getFullOrganization({
        headers: ctx.request.headers,
        query: { organizationId: activeOrgId },
      });

      const memberRecord = fullOrg?.members?.find(
        (m: any) => m.userId === session.user.id,
      );

      if (!memberRecord || !roles.includes(memberRecord.role)) {
        throw new Error("Forbidden");
      }

      return { memberRole: memberRecord.role };
    },
  );
}

// Re-export auth instance for use by tenant middleware in Plan 02
export { auth } from "./auth";
