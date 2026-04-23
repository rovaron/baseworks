import type { ModuleDefinition } from "@baseworks/shared";
import { authRoutes } from "./routes";
import { createTenant } from "./commands/create-tenant";
import { updateTenant } from "./commands/update-tenant";
import { deleteTenant } from "./commands/delete-tenant";
import { updateProfile } from "./commands/update-profile";
import { createInvitation } from "./commands/create-invitation";
import { acceptInvitation } from "./commands/accept-invitation";
import { rejectInvitation } from "./commands/reject-invitation";
import { cancelInvitation } from "./commands/cancel-invitation";
import { getTenant } from "./queries/get-tenant";
import { listTenants } from "./queries/list-tenants";
import { listMembers } from "./queries/list-members";
import { getProfile } from "./queries/get-profile";
import { listInvitations } from "./queries/list-invitations";
import { getInvitation } from "./queries/get-invitation";

export { auth } from "./auth";
export { betterAuthPlugin, requireRole } from "./middleware";
export { getLocale } from "./locale-context";

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
 */
export default {
  name: "auth",
  routes: authRoutes,
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
