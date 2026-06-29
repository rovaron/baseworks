// packages/modules/notifications/src/channels/email.ts
import { user } from "@baseworks/db";
import { eq } from "drizzle-orm";
import type { Channel, ChannelAdapter, DeliverableNotification, DeliveryResult } from "./channel";
import type { EmailProvider } from "./email-provider";

/**
 * Minimal HTML escaper for the small set of characters that are unsafe to
 * interpolate into an HTML body (`&`, `<`, `>`, `"`, `'`).
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render the optional CTA link. Only `http(s)` URLs are linked, and the value is
 * HTML-escaped — so a malformed/hostile `url` can neither break out of the href
 * attribute nor inject a non-http scheme (e.g. `javascript:`). A non-http(s)
 * url drops the CTA rather than emitting an unsafe link.
 */
function ctaHtml(url: string | null | undefined): string {
  if (!url || !/^https?:\/\//i.test(url)) return "";
  return `<p><a href="${escapeHtml(url)}">View</a></p>`;
}

/**
 * Resolve a recipient's email address from the auth `user` table.
 * Runs in the worker via the owner db (cross-tenant/trusted), so no RLS scope.
 */
// biome-ignore lint/suspicious/noExplicitAny: db is the owner Drizzle client (worker context)
async function resolveRecipientEmail(db: any, recipientUserId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, recipientUserId))
    .limit(1);
  return row?.email ?? null;
}

/**
 * Email channel adapter for tenant notifications dispatched via `notify()`.
 *
 * Renders a generic notification email from the row (title/body + optional CTA)
 * and sends it through the injected {@link EmailProvider}. The recipient's email
 * is resolved from the auth `user` table via the injected (owner) db. Catalog-
 * specific email templates can be layered on later.
 */
export class EmailAdapter implements ChannelAdapter {
  readonly name: Channel = "email";

  constructor(
    private readonly provider: EmailProvider,
    // biome-ignore lint/suspicious/noExplicitAny: owner Drizzle client (worker context)
    private readonly db: any,
  ) {}

  async deliver(n: DeliverableNotification, _deliveryId: string): Promise<DeliveryResult> {
    const email = await resolveRecipientEmail(this.db, n.recipientUserId);
    if (!email) return { status: "skipped", reason: "no email for recipient" };

    const html = `<h2>${escapeHtml(n.title)}</h2><p>${escapeHtml(n.body)}</p>${ctaHtml(n.url)}`;
    const res = await this.provider.send({ to: email, subject: n.title, html });
    return res.skipped
      ? { status: "skipped", reason: "no provider" }
      : { status: "sent", providerMessageId: res.messageId };
  }
}
