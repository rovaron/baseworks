// packages/modules/auth/src/bootstrap-admins.ts
import { getAdminEmails } from "@baseworks/config";
import { user } from "@baseworks/db";
import { inArray } from "drizzle-orm";

/**
 * Bootstrap: promote the configured ADMIN_EMAILS users to the platform-admin
 * role (user.role = "admin"). Idempotent — a single bulk UPDATE keyed on email.
 * Run once at API startup. Further operators are managed via setRole in the UI.
 */
export async function promoteConfiguredAdmins(db: any): Promise<void> {
  const emails = getAdminEmails();
  if (emails.length === 0) return;
  await db.update(user).set({ role: "admin" }).where(inArray(user.email, emails));
}
