import { getAdminEmails } from "@baseworks/config";
import {
  ForbiddenError,
  NoActiveTenantError,
  UnauthorizedError,
} from "@baseworks/shared";
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
 * @throws UnauthorizedError (401) if no valid session
 * @throws NoActiveTenantError (401) if no active organization selected
 * @throws ForbiddenError (403) if role not in allowed list
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
        throw new UnauthorizedError();
      }

      const activeOrgId = session.session.activeOrganizationId;
      if (!activeOrgId) {
        // NoActiveTenantError maps to 401 (MISSING_TENANT_CONTEXT); the old
        // "No active organization" string fell through to a 500.
        throw new NoActiveTenantError();
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
        throw new ForbiddenError();
      }

      return { memberRole: memberRecord.role };
    },
  );
}

/**
 * Platform-admin guard middleware. Gates operator-scope surfaces
 * (cross-tenant admin API, bull-board, /health/detailed) on a
 * platform-admin signal that is independent of organization
 * membership.
 *
 * Resolves the session via better-auth (the same mechanism as
 * {@link requireRole}) and authorizes the request only when the
 * session user's email (lowercased) is present in the
 * `ADMIN_EMAILS` allowlist exposed by `getAdminEmails()`. It does
 * NOT consult `activeOrganizationId` or the user's membership role,
 * so a per-organization "owner" is never conflated with a platform
 * operator.
 *
 * @returns Elysia plugin that authorizes platform admins
 * @throws UnauthorizedError (401) if no valid session
 * @throws ForbiddenError (403) if the user is not in the admin allowlist
 *
 * @example
 * app
 *   .use(requirePlatformAdmin())
 *   .get("/admin/tenants", handler);
 *
 * Per C5: env-allowlist platform-admin signal, reversible and
 * decoupled from tenant role.
 */
export function requirePlatformAdmin() {
  return new Elysia({ name: "require-platform-admin" }).derive(
    { as: "scoped" },
    async (ctx: any) => {
      const session = await auth.api.getSession({
        headers: ctx.request.headers,
      });
      if (!session) {
        throw new UnauthorizedError();
      }

      const email = session.user.email?.toLowerCase();
      if (!email || !getAdminEmails().includes(email)) {
        throw new ForbiddenError();
      }

      return { isPlatformAdmin: true as const };
    },
  );
}

// Re-export auth instance for use by tenant middleware in Plan 02
export { auth } from "./auth";
