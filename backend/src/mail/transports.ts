/**
 * Mailer implementations.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import nodemailer, { type Transporter } from 'nodemailer';

import type { Clock } from '../lib/time';
import { systemClock } from '../lib/time';
import { assertMailMessage, type Mailer, type MailMessage } from './types';

/** SMTP via nodemailer (SMTP_URL, e.g. smtps://user:pass@mail.example.org:465). */
export class SmtpMailer implements Mailer {
  readonly transport = 'smtp' as const;
  private readonly transporter: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transporter = nodemailer.createTransport(smtpUrl);
  }

  async send(message: MailMessage): Promise<void> {
    assertMailMessage(message);
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html !== undefined ? { html: message.html } : {}),
    });
  }

  async close(): Promise<void> {
    this.transporter.close();
  }
}

/**
 * Development transport: writes each message as `<time>-<random>.eml` (RFC 822) plus a
 * `.json` summary into MAIL_FILE_DIR. Never use in production (refused by config).
 */
export class FileMailer implements Mailer {
  readonly transport = 'file' as const;
  private readonly composer: Transporter;

  constructor(
    private readonly dir: string,
    private readonly from: string,
    private readonly clock: Clock = systemClock,
  ) {
    this.composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  }

  async send(message: MailMessage): Promise<void> {
    assertMailMessage(message);
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const info = (await this.composer.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html !== undefined ? { html: message.html } : {}),
    })) as { message: Buffer | string };
    const base = `${this.clock.now().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`;
    await fs.writeFile(path.join(this.dir, `${base}.eml`), info.message, { mode: 0o600, flag: 'wx' });
    await fs.writeFile(
      path.join(this.dir, `${base}.json`),
      JSON.stringify({ from: this.from, ...message, sent_at: this.clock.now().toISOString() }, null, 2),
      { mode: 0o600, flag: 'wx' },
    );
  }

  async close(): Promise<void> {
    this.composer.close();
  }
}

/** Discards messages but keeps them in memory (tests assert on `sent`). */
export class NoopMailer implements Mailer {
  readonly transport = 'noop' as const;
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    assertMailMessage(message);
    this.sent.push({ ...message });
  }

  /** Last message sent to `to` (tests). */
  lastTo(to: string): MailMessage | undefined {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      const message = this.sent[i];
      if (message !== undefined && message.to === to) return message;
    }
    return undefined;
  }

  clear(): void {
    this.sent.length = 0;
  }

  async close(): Promise<void> {
    // Nothing to release.
  }
}
