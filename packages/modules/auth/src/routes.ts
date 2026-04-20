import { Elysia, t } from "elysia";
import { auth } from "./auth";
import { betterAuthPlugin, requireRole } from "./middleware";
import { createInvitation } from "./commands/create-invitation";
import { cancelInvitation } from "./commands/cancel-invitation";
import { listInvitations } from "./queries/list-invitations";
import { getInvitation } from "./queries/get-invitation";

/**
 * Auth routes plugin. Mounts better-auth's handler + invitation endpoints.
 *
 * IMPORTANT (Pitfall 1): better-auth is configured with basePath: "/api/auth",
 * so it handles its own routing internally. We mount WITHOUT a prefix here
 * to avoid path doubling (/api/auth/api/auth/*).
 *
 * Routes served:
 * - /api/auth/* (signup, login, logout, OAuth callbacks, magic link, etc.)
 * - GET /api/invitations/:id (public -- invite accept page details, per D-05)
 * - POST /api/invitations (protected -- create invitation, per D-04/D-14/D-15)
 * - GET /api/invitations (protected -- list pending invitations, per D-03)
 * - DELETE /api/invitations/:id (protected -- cancel invitation, per D-12)
 * - POST /api/invitations/:id/resend (protected -- resend invitation, per INVT-05)
 *
 * Accept/reject are handled by better-auth's mounted handler via client SDK
 * (auth.organization.acceptInvitation/rejectInvitation).
 *
 * Per D-16: Members cannot invite anyone -- requireRole("owner", "admin") enforces this.
 */

/**
 * Build a minimal HandlerContext for CQRS handler calls that
 * use auth.api instead of scopedDb.
 *
 * Constructs a context with userId, tenantId, a null db
 * (auth handlers use auth.api directly), and a no-op emit
 * function. Used by route handlers to bridge Elysia request
 * context into the CQRS handler signature.
 *
 * @param userId   - Authenticated user ID from session, or
 *   empty string for public/system calls
 * @param tenantId - Active organization ID from session, or
 *   empty string for public calls
 * @returns HandlerContext with null db and no-op emit
 */
function makeCtx(userId: string, tenantId: string) {
  return {
    userId,
    tenantId,
    db: null as any,
    emit: (_event: string, _data: unknown) => {},
  };
}

/**
 * Build the auth routes plugin.
 *
 * The better-auth handler is only mounted if `auth.handler` is a
 * callable function. This guard exists so the module is safe to
 * evaluate in test files that mock `./auth` with a partial shape
 * (e.g. `mock.module("../auth", () => ({ auth: { api: {...} } }))`)
 * and do not supply a `handler`. Without the guard, Elysia 1.4+'s
 * `.mount()` throws `TypeError: undefined is not an object
 * (evaluating 'path.length')` at module evaluation time, breaking
 * any test file that transitively imports `./routes` after a mock
 * has been registered.
 *
 * In production `auth.handler` is always a function, so this path
 * is always taken and behavior is unchanged.
 */
const base = new Elysia({ name: "auth-routes" });
const mounted =
  typeof auth?.handler === "function" ? base.mount(auth.handler) : base;

export const authRoutes = mounted

  // --- Public endpoint: get invitation details for accept page (no auth required) ---
  // Per D-05: invite accept page needs org name, inviter, role without auth
  // Per T-09-04: Returns only invitation details, no sensitive data
  .get("/api/invitations/:id", async ({ params, set }) => {
    const result = await getInvitation(
      { invitationId: params.id },
      makeCtx("", ""),
    );
    if (!result.success) {
      set.status = 404;
      return { success: false, error: result.error };
    }
    return { success: true, data: result.data };
  })

  // --- Protected invitation endpoints (require auth + owner/admin role) ---
  // Per D-14/D-15/D-16: Only owners and admins can manage invitations
  // Per T-09-03: requireRole blocks members from creating invitations
  .group("/api/invitations", (app) =>
    app
      .use(betterAuthPlugin)
      .use(requireRole("owner", "admin"))

      // Create invitation (email or link mode) - per D-04, D-13, INVT-01, INVT-03
      // mode: "email" sends real email, "link" uses @internal placeholder
      .post(
        "/",
        async ({ body, user, session, set }: any) => {
          const activeOrgId = session.activeOrganizationId;
          if (!activeOrgId) {
            set.status = 400;
            return { success: false, error: "No active organization" };
          }
          const result = await createInvitation(
            {
              email: body.mode === "email" ? body.email : undefined,
              role: body.role,
              organizationId: activeOrgId,
              mode: body.mode,
            },
            makeCtx(user.id, activeOrgId),
          );
          if (!result.success) {
            set.status = 400;
            return { success: false, error: result.error };
          }
          return { success: true, data: result.data };
        },
        {
          body: t.Object({
            email: t.Optional(t.String({ format: "email" })),
            role: t.Union([t.Literal("admin"), t.Literal("member")]),
            mode: t.Union([t.Literal("email"), t.Literal("link")]),
          }),
          auth: true,
        },
      )

      // List pending invitations for active org - per D-03, INVT-05
      .get(
        "/",
        async ({ session, set }: any) => {
          const activeOrgId = session.activeOrganizationId;
          if (!activeOrgId) {
            set.status = 400;
            return { success: false, error: "No active organization" };
          }
          const result = await listInvitations(
            { organizationId: activeOrgId },
            makeCtx("", activeOrgId),
          );
          if (!result.success) {
            set.status = 400;
            return { success: false, error: result.error };
          }
          return { success: true, data: result.data };
        },
        { auth: true },
      )

      // Cancel invitation - per D-12, INVT-05, T-09-07
      .delete(
        "/:id",
        async ({ params, session, set }: any) => {
          const activeOrgId = session.activeOrganizationId;
          if (!activeOrgId) {
            set.status = 400;
            return { success: false, error: "No active organization" };
          }
          const result = await cancelInvitation(
            { invitationId: params.id, organizationId: activeOrgId },
            makeCtx("", activeOrgId),
          );
          if (!result.success) {
            set.status = 400;
            return { success: false, error: result.error };
          }
          return { success: true, data: result.data };
        },
        { auth: true },
      )

      // Resend invitation - per INVT-05
      // Detects mode from stored email: @internal = link mode, else email mode
      .post(
        "/:id/resend",
        async ({ params, session, set }: any) => {
          const activeOrgId = session.activeOrganizationId;
          if (!activeOrgId) {
            set.status = 400;
            return { success: false, error: "No active organization" };
          }
          // Fetch existing invitation to get email and role
          const getResult = await getInvitation(
            { invitationId: params.id },
            makeCtx("", ""),
          );
          if (!getResult.success) {
            set.status = 404;
            return { success: false, error: "Invitation not found" };
          }
          const inv = getResult.data as any;
          // Cancel original invitation before creating replacement
          const cancelResult = await cancelInvitation(
            { invitationId: params.id, organizationId: activeOrgId },
            makeCtx("", activeOrgId),
          );
          if (!cancelResult.success) {
            set.status = 400;
            return { success: false, error: "Failed to cancel original invitation before resend" };
          }
          // Detect mode from email: @internal = link mode, else email mode
          const mode = inv.email.endsWith("@internal") ? "link" : "email";
          const result = await createInvitation(
            {
              email: mode === "email" ? inv.email : undefined,
              role: inv.role,
              organizationId: activeOrgId,
              mode,
            },
            makeCtx("", activeOrgId),
          );
          if (!result.success) {
            set.status = 400;
            return { success: false, error: result.error };
          }
          return { success: true, data: result.data };
        },
        { auth: true },
      ),
  );
