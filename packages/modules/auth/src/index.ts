import type { ModuleDefinition } from "@baseworks/shared";
import { authRoutes } from "./routes";
import { createTenant } from "./commands/create-tenant";
import { updateTenant } from "./commands/update-tenant";
import { deleteTenant } from "./commands/delete-tenant";
import { updateProfile } from "./commands/update-profile";
import { getTenant } from "./queries/get-tenant";
import { listTenants } from "./queries/list-tenants";
import { listMembers } from "./queries/list-members";
import { getProfile } from "./queries/get-profile";

export { auth } from "./auth";
export { betterAuthPlugin, requireRole } from "./middleware";

/**
 * Auth module definition following the Medusa-style module pattern.
 *
 * Per D-15: Auth module exports routes, commands, queries, events.
 * Per TNNT-03: Tenant CRUD operations available via CQRS.
 * Per TNNT-05: User profile management via CQRS.
 *
 * Routes: /api/auth/* (better-auth handler for signup, login, OAuth, magic link, etc.)
 * Commands: create-tenant, update-tenant, delete-tenant, update-profile
 * Queries: get-tenant, list-tenants, list-members, get-profile
 * Events: user.created, tenant.created, member.added, member.removed, tenant.deleted
 */
export default {
  name: "auth",
  routes: authRoutes,
  commands: {
    "auth:create-tenant": createTenant,
    "auth:update-tenant": updateTenant,
    "auth:delete-tenant": deleteTenant,
    "auth:update-profile": updateProfile,
  },
  queries: {
    "auth:get-tenant": getTenant,
    "auth:list-tenants": listTenants,
    "auth:list-members": listMembers,
    "auth:get-profile": getProfile,
  },
  jobs: {},
  events: [
    "user.created",
    "tenant.created",
    "member.added",
    "member.removed",
    "tenant.deleted",
  ],
} satisfies ModuleDefinition;
