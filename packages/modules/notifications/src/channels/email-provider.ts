// packages/modules/notifications/src/channels/email-provider.ts

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export interface EmailSendResult {
  messageId?: string;
  skipped?: boolean;
}

export interface EmailProvider {
  send(msg: EmailMessage): Promise<EmailSendResult>;
}
