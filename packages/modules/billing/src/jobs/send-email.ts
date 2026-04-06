import { Resend } from "resend";
import { render } from "@react-email/components";
import { env } from "@baseworks/config";
import { WelcomeEmail } from "../templates/welcome";
import { PasswordResetEmail } from "../templates/password-reset";
import { BillingNotificationEmail } from "../templates/billing-notification";

const templates: Record<string, (data: any) => JSX.Element> = {
  "welcome": (data) => WelcomeEmail(data),
  "password-reset": (data) => PasswordResetEmail(data),
  "magic-link": (data) => PasswordResetEmail({ ...data, userName: data.email }),
  "billing-notification": (data) => BillingNotificationEmail(data),
};

const subjects: Record<string, string> = {
  "welcome": "Welcome to Baseworks!",
  "password-reset": "Reset Your Password",
  "magic-link": "Your Sign-in Link",
  "billing-notification": "Billing Update",
};

/**
 * Email job handler using Resend + React Email.
 *
 * Per D-19/D-21: Processes email:send queue jobs.
 * Per T-03-17: Graceful degradation when RESEND_API_KEY is not set
 * (logs instead of crashing) so dev/test environments work without email config.
 * Per T-03-14: Templates receive minimal data (userName, url) -- no secrets.
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
  const Component = templates[template];
  if (!Component) {
    throw new Error(`Unknown email template: ${template}`);
  }

  const html = await render(Component(templateData));
  await resend.emails.send({
    from: "Baseworks <noreply@baseworks.dev>",
    to,
    subject: subjects[template] ?? "Notification",
    html,
  });
}
