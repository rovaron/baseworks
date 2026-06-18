import type { ModuleDefinition } from "@baseworks/shared";
import { acceptInvitation } from "./commands/accept-invitation";
import { cancelInvitation } from "./commands/cancel-invitation";
import { createInvitation } from "./commands/create-invitation";
import { createTenant } from "./commands/create-tenant";
import { deleteTenant } from "./commands/delete-tenant";
import { rejectInvitation } from "./commands/reject-invitation";
import { updateProfile } from "./commands/update-profile";
import { updateTenant } from "./commands/update-tenant";
import { organizationFileRelation, userFileRelation } from "./file-relations";
import { getInvitation } from "./queries/get-invitation";
import { getProfile } from "./queries/get-profile";
import { getTenant } from "./queries/get-tenant";
import { listInvitations } from "./queries/list-invitations";
import { listMembers } from "./queries/list-members";
import { listTenants } from "./queries/list-tenants";
import { authRoutes } from "./routes";

export { auth } from "./auth";
export { getLocale } from "./locale-context";
export { betterAuthPlugin, requirePlatformAdmin, requireRole } from "./middleware";
// Re-exported so apps/api can mount the plugin with its precise Elysia type
// (preserving Eden Treaty inference); the registry's getAuthRoutes() erases it to `any`.
export { authRoutes } from "./routes";

/**
 * Auth module definition following the Medusa-style module pattern.
 *
 * Per D-15: Auth module exports routes, commands, queries, events.
 * Per TNNT-03: Tenant CRUD operations available via CQRS.
 * Per TNNT-05: User profile management via CQRS.
 *
 * Routes: /api/auth/* (better-auth handler) + /api/invitations/* (invitation CRUD)
 * Commands: create-tenant, update-tenant, delete-tenant, update-profile,
 *           create-invitation, accept-invitation, reject-invitation, cancel-invitation
 * Queries: get-tenant, list-tenants, list-members, get-profile, list-invitations, get-invitation
 * Events: user.created, tenant.created, member.added, member.removed, tenant.deleted,
 *         invitation.created, invitation.accepted, invitation.rejected, invitation.cancelled
 *
 * Phase 29 / IDA-01, IDA-02 — fileRelations { user (avatar), organization (logo) }
 * declared so the files module validates/cascades identity assets WITHOUT any
 * auth<->files import (registry collected at boot; resolved via ctx.dispatch).
 */
export default {
  name: "auth",
  routes: authRoutes,
  fileRelations: {
    user: userFileRelation,
    organization: organizationFileRelation,
  },
  commands: {
    "auth:create-tenant": createTenant,
    "auth:update-tenant": updateTenant,
    "auth:delete-tenant": deleteTenant,
    "auth:update-profile": updateProfile,
    "auth:create-invitation": createInvitation,
    "auth:accept-invitation": acceptInvitation,
    "auth:reject-invitation": rejectInvitation,
    "auth:cancel-invitation": cancelInvitation,
  },
  queries: {
    "auth:get-tenant": getTenant,
    "auth:list-tenants": listTenants,
    "auth:list-members": listMembers,
    "auth:get-profile": getProfile,
    "auth:list-invitations": listInvitations,
    "auth:get-invitation": getInvitation,
  },
  jobs: {},
  events: [
    "user.created",
    "tenant.created",
    "member.added",
    "member.removed",
    "tenant.deleted",
    "invitation.created",
    "invitation.accepted",
    "invitation.rejected",
    "invitation.cancelled",
  ],
} satisfies ModuleDefinition;
