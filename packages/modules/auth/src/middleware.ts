import { ForbiddenError, NoActiveTenantError, UnauthorizedError } from "@baseworks/shared";
import { Elysia } from "elysia";
import { platformAdminRoles } from "./access-control";
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
 * Permission guard (v1.5). Replaces the legacy role guard. Resolves the active org + user
 * race-free (prefer the request context that tenantMiddleware already resolved,
 * fall back to a session lookup for routes that guard without tenantMiddleware),
 * then asks better-auth whether the caller's role (built-in OR custom) grants
 * `resource:action` in that org.
 *
 * @throws UnauthorizedError (401) no session
 * @throws NoActiveTenantError (401) no active organization
 * @throws ForbiddenError (403) permission denied
 */
export function requirePermission(resource: string, action: string) {
  return new Elysia({ name: `require-perm-${resource}:${action}` }).derive(
    { as: "scoped" },
    async (ctx: any) => {
      let userId: string | undefined = ctx.userId ?? ctx.user?.id;
      let activeOrgId: string | null | undefined =
        ctx.tenantId ?? ctx.session?.activeOrganizationId;

      // Fall back to a full session lookup ONLY when the caller is not already
      // identified in context (no tenantMiddleware/betterAuthPlugin ran). Once
      // userId is known we trust the in-context active org and throw
      // NoActiveTenant if it is missing, rather than a redundant getSession that
      // could miss a just-written activeOrganizationId under Redis
      // secondaryStorage (the read-after-write race documented on the legacy role guard).
      if (!userId) {
        const session = await auth.api.getSession({ headers: ctx.request.headers });
        if (!session) throw new UnauthorizedError();
        userId ??= session.user.id;
        activeOrgId ??= session.session.activeOrganizationId;
      }

      if (!userId) throw new UnauthorizedError();
      if (!activeOrgId) throw new NoActiveTenantError();

      const result = await auth.api.hasPermission({
        headers: ctx.request.headers,
        body: { organizationId: activeOrgId, permissions: { [resource]: [action] } },
      });

      if (!result?.success) throw new ForbiddenError();

      return { permission: { resource, action } as const };
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
 * {@link requirePermission}) and authorizes the request only when the
 * session user's global `role` (managed by the better-auth admin plugin)
 * is one of {@link platformAdminRoles}. It does NOT consult
 * `activeOrganizationId` or the user's membership role, so a
 * per-organization "owner" is never conflated with a platform operator.
 *
 * Platform admins are bootstrapped from `ADMIN_EMAILS` at startup
 * (see `bootstrap-admins.ts`) and thereafter managed via the admin
 * plugin's `setRole` endpoint.
 *
 * @returns Elysia plugin that authorizes platform admins
 * @throws UnauthorizedError (401) if no valid session
 * @throws ForbiddenError (403) if the user's role is not a platform-admin role
 *
 * @example
 * app
 *   .use(requirePlatformAdmin())
 *   .get("/admin/tenants", handler);
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

      const role = (session.user as any).role;
      if (!role || !platformAdminRoles.includes(role)) {
        throw new ForbiddenError();
      }

      return { isPlatformAdmin: true as const };
    },
  );
}

// Re-export auth instance for use by tenant middleware in Plan 02
export { auth } from "./auth";
