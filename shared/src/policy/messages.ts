/**
 * Policy decision messages (ARCHITECTURE §7.2 step 4). Mirrored in C#.
 */
import type { PolicyAction } from '../enums';

/** Default text per action when the winning rule has no message (null for allow). */
export const DEFAULT_ACTION_MESSAGES: Readonly<Record<PolicyAction, string | null>> = Object.freeze({
  allow: null,
  admin_notify: 'Player matched a server policy rule. Staff has been notified.',
  warn: "Your account has been flagged by this server's trust policy.",
  require_review: 'Your account is pending review by the server staff.',
  require_whitelist: 'A VPN/proxy was detected. Request a whitelist at {whitelist_url}',
  kick: "You were removed by this server's trust policy.",
  ban: "You have been banned by this server's trust policy.",
});

/** Supported placeholders. Anything else in braces is left untouched. */
export const POLICY_MESSAGE_PLACEHOLDERS = Object.freeze(['case_id', 'days', 'whitelist_url', 'server_name'] as const);
export type PolicyMessagePlaceholder = (typeof POLICY_MESSAGE_PLACEHOLDERS)[number];
export type PolicyMessageValues = Readonly<Record<PolicyMessagePlaceholder, string>>;

const PLACEHOLDER_PATTERN = /\{(case_id|days|whitelist_url|server_name)\}/g;

/**
 * Single-pass substitution of `{case_id}`, `{days}`, `{whitelist_url}`, `{server_name}`.
 * Substituted values are not re-scanned, so a value containing `{case_id}` stays literal.
 * Placeholders are case-sensitive and must not contain spaces (`{ days }` is left as-is).
 */
export function renderPolicyMessage(template: string, values: PolicyMessageValues): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match, name: PolicyMessagePlaceholder) => values[name]);
}
