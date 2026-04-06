import type { ModuleDefinition } from "@baseworks/shared";
import { authRoutes } from "./routes";

export { auth } from "./auth";
export { betterAuthPlugin, requireRole } from "./middleware";

/**
 * Auth module definition following the Medusa-style module pattern.
 *
 * Commands and queries are empty stubs here -- Plan 03 adds tenant CRUD
 * and user profile management (D-15).
 *
 * Routes: /api/auth/* (better-auth handler for signup, login, OAuth, magic link, etc.)
 * Events: user.created, tenant.created, member.added, member.removed, tenant.deleted
 */
export default {
  name: "auth",
  routes: authRoutes,
  commands: {},
  queries: {},
  jobs: {},
  events: [
    "user.created",
    "tenant.created",
    "member.added",
    "member.removed",
    "tenant.deleted",
  ],
} satisfies ModuleDefinition;
