/**
 * Auto-create personal tenant on signup.
 *
 * Per D-08: Every user gets a personal organization (tenant) created automatically
 * on signup. The user becomes the owner via the organization plugin's `creatorRole: "owner"`.
 *
 * Per TNNT-01: Ensures every user belongs to at least one tenant from the moment they
 * sign up. This is critical for the tenant middleware to resolve a valid tenantId.
 *
 * Implementation: The hook logic is defined inline in `auth.ts` within the
 * `databaseHooks.user.create.after` callback. This avoids a circular dependency
 * issue -- importing `auth` from `../auth` in a separate file would create a
 * circular reference since `auth.ts` would need to import this file before
 * `auth` is initialized.
 *
 * By defining the hook inline, the `auth` reference resolves via closure at
 * call time (after `betterAuth()` returns), not at import time.
 *
 * Hook behavior:
 * 1. Fires after a new user record is created in the database
 * 2. Calls `auth.api.createOrganization` to create a personal workspace
 * 3. Names the org "[displayName]'s Workspace" using name or email prefix
 * 4. Generates a slug using `personal-{userId.slice(0,8)}` for uniqueness
 * 5. Logs success or catches/logs errors without crashing signup flow
 *
 * Per Pitfall 3: The hook does NOT set `activeOrganizationId` on the session
 * because `databaseHooks` do not have access to the session context. Instead,
 * the tenant middleware (`apps/api/src/core/middleware/tenant.ts`) handles
 * null `activeOrganizationId` by auto-selecting the user's first organization.
 *
 * @see auth.ts - databaseHooks.user.create.after
 * @see apps/api/src/core/middleware/tenant.ts - Pitfall 3 mitigation
 */
export {};
