/**
 * Minimal e-mail templates. Values are HTML-escaped in the HTML part; plain text is the
 * canonical content.
 */
import type { MailMessage } from './types';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Replaces `{name}` placeholders (single pass; unknown placeholders stay literal). */
export function renderText(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-z_]+)\}/g, (match, name: string) => (Object.hasOwn(values, name) ? (values[name] ?? '') : match));
}

export interface ActionMailInput {
  to: string;
  username: string;
  /** Absolute URL the user must open. */
  actionUrl: string;
  expiresInText: string;
}

const PRODUCT = 'SCP:SL Trust Network';

function actionMail(input: ActionMailInput, subject: string, intro: string, action: string, outro: string): MailMessage {
  const text = [
    `Hello ${input.username},`,
    '',
    intro,
    '',
    `${action}: ${input.actionUrl}`,
    '',
    `This link expires in ${input.expiresInText}.`,
    outro,
    '',
    `— ${PRODUCT}`,
  ].join('\n');
  const html = [
    `<p>Hello ${escapeHtml(input.username)},</p>`,
    `<p>${escapeHtml(intro)}</p>`,
    `<p><a href="${escapeHtml(input.actionUrl)}">${escapeHtml(action)}</a></p>`,
    `<p>This link expires in ${escapeHtml(input.expiresInText)}. ${escapeHtml(outro)}</p>`,
    `<p>— ${escapeHtml(PRODUCT)}</p>`,
  ].join('\n');
  return { to: input.to, subject: `${PRODUCT}: ${subject}`, text, html };
}

export const mailTemplates = Object.freeze({
  emailVerification: (input: ActionMailInput): MailMessage =>
    actionMail(
      input,
      'verify your e-mail address',
      'Please confirm your e-mail address to finish creating your account.',
      'Verify e-mail address',
      'If you did not create an account, ignore this message.',
    ),
  passwordReset: (input: ActionMailInput): MailMessage =>
    actionMail(
      input,
      'reset your password',
      'A password reset was requested for your account.',
      'Choose a new password',
      'If you did not request this, ignore this message; your password stays unchanged.',
    ),
  /** Generic notification with plain-text body. */
  notification: (to: string, subject: string, body: string): MailMessage => ({
    to,
    subject: `${PRODUCT}: ${subject}`,
    text: `${body}\n\n— ${PRODUCT}`,
    html: `<p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>\n<p>— ${escapeHtml(PRODUCT)}</p>`,
  }),
});
