// packages/modules/notifications/src/channels/resend-provider.ts
import { Resend } from "resend";
import type { EmailMessage, EmailProvider, EmailSendResult } from "./email-provider";

const DEFAULT_FROM = "Baseworks <noreply@baseworks.dev>";

export class ResendEmailProvider implements EmailProvider {
  constructor(private readonly apiKey: string | undefined) {}

  async send(msg: EmailMessage): Promise<EmailSendResult> {
    if (!this.apiKey) {
      console.log(`[EMAIL] Skipping send (no RESEND_API_KEY): to=${msg.to}`);
      return { skipped: true };
    }
    const resend = new Resend(this.apiKey);
    const { data } = await resend.emails.send({
      from: msg.from ?? DEFAULT_FROM,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
    });
    return { messageId: data?.id };
  }
}
