/**
 * Mailer abstraction (ARCHITECTURE §1.1): smtp (nodemailer), file (development), noop (tests).
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  readonly transport: 'smtp' | 'file' | 'noop';
  send(message: MailMessage): Promise<void>;
  /** Releases pooled connections. */
  close(): Promise<void>;
}

const HEADER_INJECTION = /[\r\n]/;

/** Rejects header injection in single-line fields. */
export function assertMailMessage(message: MailMessage): void {
  if (HEADER_INJECTION.test(message.to) || HEADER_INJECTION.test(message.subject)) {
    throw new TypeError('Mail header fields must not contain line breaks');
  }
  if (message.to.length === 0 || message.to.length > 320) throw new TypeError('Invalid recipient');
  if (message.subject.length > 998) throw new TypeError('Subject too long');
}
