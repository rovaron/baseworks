import { Elysia } from "elysia";
import { auth } from "./auth";

/**
 * Auth macro plugin for session injection into protected routes.
 *
 * Registers an `auth` macro that resolves the current session
 * from request headers via better-auth. Injects `user` and
 * `session` into the Elysia route context. Returns 401 if no
 * valid session exists.
 *
 * @returns Elysia plugin instance with `auth` macro registered
 *
 * Per RESEARCH.md Pattern 1: Uses .macro() with resolve to
 * inject user and session into the route context.
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
 * Role guard middleware. Checks the user's role in the active
 * organization and throws if insufficient.
 *
 * Creates a scoped Elysia plugin that derives `memberRole`
 * into the route context. Fetches the full organization to
 * resolve the current user's membership role. Throws
 * "Unauthorized" (401) if no session, "No active organization"
 * if no org selected, or "Forbidden" (403) if the user's role
 * is not in the allowed list.
 *
 * @param roles - One or more allowed role strings
 *   (e.g., "owner", "admin", "member")
 * @returns Elysia plugin that derives `memberRole` into context
 * @throws Error("Unauthorized") if no valid session
 * @throws Error("Forbidden") if role not in allowed list
 *
 * @example
 * app
 *   .use(requireRole("owner", "admin"))
 *   .delete("/tenant", handler);
 *
 * Per D-12: Composable requireRole derive that checks the
 * active user's membership role for the current tenant.
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
