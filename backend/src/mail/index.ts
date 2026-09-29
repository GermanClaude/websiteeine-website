/**
 * Mailer factory: MAIL_TRANSPORT=smtp | file | noop.
 */
import type { Config } from '../config';
import type { Clock } from '../lib/time';
import { FileMailer, NoopMailer, SmtpMailer } from './transports';
import type { Mailer } from './types';

export function createMailer(config: Config, clock?: Clock): Mailer {
  switch (config.mail.transport) {
    case 'smtp':
      if (config.mail.smtpUrl === null) throw new Error('SMTP_URL is required for MAIL_TRANSPORT=smtp');
      return new SmtpMailer(config.mail.smtpUrl, config.mail.from);
    case 'file':
      return new FileMailer(config.mail.fileDir, config.mail.from, clock);
    case 'noop':
      return new NoopMailer();
  }
}

export { escapeHtml, mailTemplates, renderText, type ActionMailInput } from './templates';
export { FileMailer, NoopMailer, SmtpMailer } from './transports';
export * from './types';
