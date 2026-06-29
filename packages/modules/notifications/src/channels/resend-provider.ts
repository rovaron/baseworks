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
    // The Resend SDK does NOT throw on API errors (invalid recipient, 4xx,
    // rate-limit) — it returns them in `error`. Surface that as a throw so the
    // transactional-email path retries via BullMQ and the channel-delivery path
    // records `failed` on the delivery row, rather than silently marking "sent".
    const { data, error } = await resend.emails.send({
      from: msg.from ?? DEFAULT_FROM,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
    });
    if (error) {
      throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`);
    }
    return { messageId: data?.id };
  }
}
