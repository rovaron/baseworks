/**
 * Tenant-plane access control (v1.5).
 *
 * The statement catalog + access controller + built-in roles. This module is
 * imported by BOTH the server (auth.ts) and the browser auth client
 * (api-client), so it MUST NOT import server-only deps (db, queue, env).
 */
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

/**
 * Permission vocabulary: resource -> allowed actions. Built on better-auth's
 * org defaults (organization/member/invitation/team/ac) plus Baseworks resources.
 */
export const statements = {
  ...defaultStatements,
  files: ["read", "write", "delete", "admin"],
  billing: ["read", "manage"],
} as const;

export const ac = createAccessControl(statements);

/** Full control. */
export const owner = ac.newRole({
  ...defaultStatements,
  files: ["read", "write", "delete", "admin"],
  billing: ["read", "manage"],
});

/** Everything except tenant deletion, billing management, and role deletion. */
export const admin = ac.newRole({
  organization: (defaultStatements.organization ?? []).filter((a) => a !== "delete"),
  member: defaultStatements.member ?? [],
  invitation: defaultStatements.invitation ?? [],
  ac: (defaultStatements.ac ?? []).filter((a) => a !== "delete"),
  files: ["read", "write", "delete", "admin"],
  billing: ["read"],
});

/** Read-only baseline. */
export const member = ac.newRole({
  files: ["read"],
  billing: ["read"],
});

/** Built-in role map handed to the organization plugin. */
export const roles = { owner, admin, member };

/**
 * Platform-plane (operator) global roles. This is the SINGLE source of truth for
 * "what `user.role` value authorizes operator-scope surfaces", shared by:
 *  - the better-auth admin plugin's `adminRoles` (auth.ts),
 *  - the server guard `requirePlatformAdmin` (middleware.ts), and
 *  - the admin dashboard's client-side `AuthGuard` (via @baseworks/api-client).
 *
 * Typed as `readonly string[]` so `.includes(someString)` type-checks against an
 * arbitrary session role. Lives here (the server-dep-free module) so the browser
 * bundle can import it without dragging in db/queue/env.
 */
export const platformAdminRoles: readonly string[] = ["admin"];
