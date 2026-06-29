import { defaultLocale, getMessages, interpolate, type Locale } from "@baseworks/i18n";
import { render } from "@react-email/components";
import type { ReactElement } from "react";
import { BillingNotificationEmail } from "../templates/billing-notification";
import { PasswordResetEmail } from "../templates/password-reset";
import { TeamInviteEmail } from "../templates/team-invite";
import { WelcomeEmail } from "../templates/welcome";

// biome-ignore lint/suspicious/noExplicitAny: template props vary per template
const templates: Record<string, (data: any) => ReactElement> = {
  welcome: (data) => WelcomeEmail(data),
  "password-reset": (data) => PasswordResetEmail(data),
  "magic-link": (data) => PasswordResetEmail({ ...data, userName: data.email }),
  "billing-notification": (data) => BillingNotificationEmail(data),
  // Phase 12 D-06: team-invite is rendered via pre-resolved strings built in
  // resolveTeamInvite() below — this map entry is only used for the fallback
  // case where the dispatcher routes to it with already-prepared props.
  "team-invite": (data) => TeamInviteEmail(data),
};

const subjects: Record<string, string> = {
  welcome: "Welcome to Baseworks!",
  "password-reset": "Reset Your Password",
  "magic-link": "Your Sign-in Link",
  "billing-notification": "Billing Update",
  // Phase 12 D-09/D-10: team-invite subject is localized per-request in
  // renderEmail() below. This fallback value is only used if message loading
  // somehow fails (defensive default).
  "team-invite": "You're Invited to Join a Team",
};

/**
 * Role label lookup from translated messages.
 * Falls back to the raw role key if an unknown role arrives (defensive —
 * better-auth's organization plugin only emits owner/admin/member today).
 */
function resolveRoleLabel(messages: Record<string, Record<string, unknown>>, role: string): string {
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
      : ((await getMessages(defaultLocale)).invite?.email as typeof email);
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
 * Render a transactional email template to HTML + subject.
 *
 * Pure render — no provider/send. Resolves the template by name, renders it
 * with React Email, and returns the rendered HTML plus the resolved subject.
 * The team-invite template resolves its i18n strings/subject at render time;
 * other templates use hardcoded English subjects.
 *
 * @param template - Template name (welcome, password-reset, magic-link,
 *   billing-notification, team-invite)
 * @param data - Template-specific props
 * @returns The rendered HTML and the subject line
 * @throws Error if the template name is unknown
 */
export async function renderEmail(
  template: string,
  data: Record<string, unknown>,
): Promise<{ html: string; subject: string }> {
  if (template === "team-invite") {
    // Phase 12: pre-resolve translations and subject for team-invite only.
    const { props, subject } = await resolveTeamInvite(
      data as Parameters<typeof resolveTeamInvite>[0],
    );
    return { html: await render(TeamInviteEmail(props)), subject };
  }

  const Component = templates[template];
  if (!Component) {
    throw new Error(`Unknown email template: ${template}`);
  }
  return {
    html: await render(Component(data)),
    subject: subjects[template] ?? "Notification",
  };
}
