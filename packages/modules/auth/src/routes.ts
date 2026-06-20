import { Elysia, t } from "elysia";
import { auth } from "./auth";
import { cancelInvitation } from "./commands/cancel-invitation";
import { createInvitation } from "./commands/create-invitation";
import { betterAuthPlugin, requireRole } from "./middleware";
import { getInvitation } from "./queries/get-invitation";
import { listInvitations } from "./queries/list-invitations";

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
 * @param headers  - Live request headers, forwarded so
 *   better-auth (auth.api.*) can resolve the caller's session.
 *   Omitted for public/system calls that need no session.
 * @returns HandlerContext with null db and no-op emit
 */
function makeCtx(userId: string, tenantId: string, headers?: Headers) {
  return {
    userId,
    tenantId,
    db: null as any,
    emit: (_event: string, _data: unknown) => {},
    headers,
  };
}

/**
 * In-flight resend guard. Prevents concurrent/duplicate resends
 * (e.g. a double-clicked button or a retried request) for the same
 * invitation from racing the cancel-then-create flow and leaving the
 * org with duplicate pending invitations. Keyed by `${orgId}:${invitationId}`.
 *
 * Process-local by design: it is a pragmatic idempotency safeguard for the
 * common double-submit case, not a distributed lock.
 */
const inFlightResends = new Set<string>();

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
const mounted = typeof auth?.handler === "function" ? base.mount(auth.handler) : base;

export const authRoutes = mounted

  // --- Public endpoint: get invitation details for accept page (no auth required) ---
  // Per D-05: invite accept page needs org name, inviter, role without auth
  // Per T-09-04: Returns only invitation details, no sensitive data
  .get("/api/invitations/:id", async ({ params, set, request }) => {
    const result = await getInvitation(
      { invitationId: params.id },
      makeCtx("", "", request.headers),
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
        async ({ body, user, session, set, request }: any) => {
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
            makeCtx(user.id, activeOrgId, request.headers),
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
        async ({ session, set, request }: any) => {
          const activeOrgId = session.activeOrganizationId;
          if (!activeOrgId) {
            set.status = 400;
            return { success: false, error: "No active organization" };
          }
          const result = await listInvitations(
            { organizationId: activeOrgId },
            makeCtx("", activeOrgId, request.headers),
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
        async ({ params, session, set, request }: any) => {
          const activeOrgId = session.activeOrganizationId;
          if (!activeOrgId) {
            set.status = 400;
            return { success: false, error: "No active organization" };
          }
          const result = await cancelInvitation(
            { invitationId: params.id, organizationId: activeOrgId },
            makeCtx("", activeOrgId, request.headers),
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
        async ({ params, session, set, request }: any) => {
          const activeOrgId = session.activeOrganizationId;
          if (!activeOrgId) {
            set.status = 400;
            return { success: false, error: "No active organization" };
          }

          // Idempotency safeguard: collapse concurrent/duplicate resends for the
          // same invitation (double-click, retried request) so they cannot race
          // the cancel-then-create flow and leave duplicate pending invitations.
          const idempotencyKey = `${activeOrgId}:${params.id}`;
          if (inFlightResends.has(idempotencyKey)) {
            set.status = 409;
            return {
              success: false,
              error: "A resend for this invitation is already in progress",
            };
          }
          inFlightResends.add(idempotencyKey);

          try {
            // Fetch existing invitation to get email and role
            const getResult = await getInvitation(
              { invitationId: params.id },
              makeCtx("", "", request.headers),
            );
            if (!getResult.success) {
              set.status = 404;
              return { success: false, error: "Invitation not found" };
            }
            const inv = getResult.data as any;

            // Detect mode from email: @internal = link mode, else email mode
            const mode = inv.email.endsWith("@internal") ? "link" : "email";

            if (mode === "link") {
              // Link mode: the replacement uses a fresh unique @internal address,
              // so there is no duplicate-pending conflict. Create FIRST; only then
              // cancel the original. If create fails, the original stays intact and
              // the caller still has a valid pending invitation (never zero).
              const created = await createInvitation(
                {
                  email: undefined,
                  role: inv.role,
                  organizationId: activeOrgId,
                  mode: "link",
                },
                makeCtx("", activeOrgId, request.headers),
              );
              if (!created.success) {
                set.status = 400;
                return { success: false, error: created.error };
              }
              // Replacement exists; best-effort cancel of the original. If the
              // cancel fails the original simply lingers — the caller still has a
              // valid pending invitation, so the resend is reported as success.
              await cancelInvitation(
                { invitationId: params.id, organizationId: activeOrgId },
                makeCtx("", activeOrgId, request.headers),
              );
              return { success: true, data: created.data };
            }

            // Email mode: better-auth rejects a duplicate pending invite for the
            // same email, so we cannot create-before-cancel. Cancel the original,
            // then attempt the replacement. If the replacement fails, compensate by
            // re-issuing the original (best-effort) so the caller is never left with
            // zero valid pending invitations.
            const cancelResult = await cancelInvitation(
              { invitationId: params.id, organizationId: activeOrgId },
              makeCtx("", activeOrgId, request.headers),
            );
            if (!cancelResult.success) {
              set.status = 400;
              return {
                success: false,
                error: "Failed to cancel original invitation before resend",
              };
            }

            const created = await createInvitation(
              {
                email: inv.email,
                role: inv.role,
                organizationId: activeOrgId,
                mode: "email",
              },
              makeCtx("", activeOrgId, request.headers),
            );
            if (!created.success) {
              // Compensation: the original was already cancelled and the new
              // invitation failed. Best-effort re-issue the original so the caller
              // keeps exactly one valid pending invitation rather than zero.
              const reissued = await createInvitation(
                {
                  email: inv.email,
                  role: inv.role,
                  organizationId: activeOrgId,
                  mode: "email",
                },
                makeCtx("", activeOrgId, request.headers),
              );
              set.status = 400;
              return {
                success: false,
                error: reissued.success
                  ? "Resend failed; the original invitation was reissued."
                  : "Resend failed and the original invitation could not be reissued. Please recreate it manually.",
              };
            }

            return { success: true, data: created.data };
          } finally {
            inFlightResends.delete(idempotencyKey);
          }
        },
        { auth: true },
      ),
  );
