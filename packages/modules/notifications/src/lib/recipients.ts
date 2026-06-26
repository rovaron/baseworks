import type { HandlerContext } from "@baseworks/shared";

export interface RecipientSelector {
  userIds?: string[];
  role?: string; // "owner" | "admin" | "member" | a custom org role
}

/**
 * Resolve a selector to a deduped set of recipient user ids. `role` is resolved
 * against the active tenant's membership via the auth module's list-members
 * query (no cross-module import — dispatched through the bus).
 *
 * The auth `list-members` query takes `{ organizationId }` and returns the
 * better-auth member array, where each member exposes `userId` and `role`
 * (verified against packages/modules/auth/src/queries/list-members.ts, which
 * returns `org.members` from `auth.api.getFullOrganization`).
 */
export async function resolveRecipients(
  sel: RecipientSelector,
  ctx: HandlerContext,
): Promise<Set<string>> {
  const ids = new Set<string>(sel.userIds ?? []);
  if (sel.role && ctx.dispatch) {
    const res = await ctx.dispatch("auth:list-members", { organizationId: ctx.tenantId });
    if (res.success) {
      for (const m of res.data as Array<{ userId: string; role: string }>) {
        if (m.role === sel.role) ids.add(m.userId);
      }
    }
  }
  return ids;
}
