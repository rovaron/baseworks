import { Resend } from "resend";
import { render } from "@react-email/components";
import { env } from "@baseworks/config";
import {
  getMessages,
  interpolate,
  defaultLocale,
  type Locale,
} from "@baseworks/i18n";
import { WelcomeEmail } from "../templates/welcome";
import { PasswordResetEmail } from "../templates/password-reset";
import { BillingNotificationEmail } from "../templates/billing-notification";
import { TeamInviteEmail } from "../templates/team-invite";

const templates: Record<string, (data: any) => JSX.Element> = {
  "welcome": (data) => WelcomeEmail(data),
  "password-reset": (data) => PasswordResetEmail(data),
  "magic-link": (data) => PasswordResetEmail({ ...data, userName: data.email }),
  "billing-notification": (data) => BillingNotificationEmail(data),
  // Phase 12 D-06: team-invite is rendered via pre-resolved strings built in
  // resolveTeamInvite() below — this map entry is only used for the fallback
  // case where the dispatcher routes to it with already-prepared props.
  "team-invite": (data) => TeamInviteEmail(data),
};

const subjects: Record<string, string> = {
  "welcome": "Welcome to Baseworks!",
  "password-reset": "Reset Your Password",
  "magic-link": "Your Sign-in Link",
  "billing-notification": "Billing Update",
  // Phase 12 D-09/D-10: team-invite subject is localized per-request in
  // sendEmail() below. This fallback value is only used if message loading
  // somehow fails (defensive default).
  "team-invite": "You're Invited to Join a Team",
};

/**
 * Role label lookup from translated messages.
 * Falls back to the raw role key if an unknown role arrives (defensive —
 * better-auth's organization plugin only emits owner/admin/member today).
 */
function resolveRoleLabel(
  messages: Record<string, Record<string, unknown>>,
  role: string,
): string {
  const roles = messages.invite?.roles as Record<string, string> | undefined;
  return roles?.[role] ?? role;
}

/**
 * Pre-resolve all translated strings for the team-invite template, including
 * subject line. Per Phase 12 D-05/D-06, the worker owns interpolation so the
 * React Email template can stay a pure presentation component.
 */
async function resolveTeamInvite(data: {
  inviteLink: string;
  organizationName: string;
  inviterName: string;
  role: string;
  locale?: Locale;
}): Promise<{
  props: {
    inviteLink: string;
    heading: string;
    body: string;
    ctaLabel: string;
    footer: string;
  };
  subject: string;
}> {
  const locale: Locale = data.locale ?? defaultLocale;
  const messages = await getMessages(locale);
  const email = messages.invite?.email as
    | Record<"heading" | "body" | "cta" | "footer" | "subject", string>
    | undefined;

  // Defensive fallback: if the invite.email subtree is somehow missing for
  // this locale, fall back to English so we still send a working email.
  const fallback =
    locale === defaultLocale
      ? email
      : (((await getMessages(defaultLocale)).invite?.email as typeof email));
  const resolved = email ?? fallback;
  if (!resolved) {
    throw new Error(
      `Missing invite.email messages for locale=${locale} (and fallback ${defaultLocale})`,
    );
  }

  const roleLabel = resolveRoleLabel(messages, data.role);
  const vars = {
    orgName: data.organizationName,
    inviterName: data.inviterName,
    roleLabel,
  };

  return {
    props: {
      inviteLink: data.inviteLink,
      heading: interpolate(resolved.heading, vars),
      body: interpolate(resolved.body, vars),
      ctaLabel: resolved.cta,
      footer: resolved.footer,
    },
    subject: resolved.subject,
  };
}

/**
 * Send a transactional email via Resend and React Email.
 *
 * Processes email-send BullMQ queue jobs. Resolves the template
 * by name, renders it with React Email, and sends via Resend.
 * Skips sending gracefully when RESEND_API_KEY is not configured
 * (dev/test environments).
 *
 * @param data - Job data: to (recipient), template (template
 *   name), data (template-specific props)
 * @returns void
 * @throws Error if the template name is unknown
 *
 * Per D-19/D-21: Processes email-send queue jobs.
 * Per T-03-17: Graceful degradation without RESEND_API_KEY.
 * Per T-03-14: Templates receive minimal data -- no secrets.
 * Per Phase 12 D-05/D-09/D-10: team-invite resolves i18n at
 *   send time; other templates use hardcoded English.
 */
export async function sendEmail(data: unknown): Promise<void> {
  const { to, template, data: templateData } = data as {
    to: string;
    template: string;
    data: Record<string, unknown>;
  };

  if (!env.RESEND_API_KEY) {
    console.log(`[EMAIL] Skipping send (no RESEND_API_KEY): template=${template}, to=${to}`);
    return;
  }

  const resend = new Resend(env.RESEND_API_KEY);

  let html: string;
  let subject: string;

  if (template === "team-invite") {
    // Phase 12: pre-resolve translations and subject for team-invite only.
    const { props, subject: resolvedSubject } = await resolveTeamInvite(
      templateData as Parameters<typeof resolveTeamInvite>[0],
    );
    html = await render(TeamInviteEmail(props));
    subject = resolvedSubject;
  } else {
    const Component = templates[template];
    if (!Component) {
      throw new Error(`Unknown email template: ${template}`);
    }
    html = await render(Component(templateData));
    subject = subjects[template] ?? "Notification";
  }

  await resend.emails.send({
    from: "Baseworks <noreply@baseworks.dev>",
    to,
    subject,
    html,
  });
}
