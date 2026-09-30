/**
 * Short-lived evidence download tickets (§12.1): HMAC-SHA256 over a compact payload,
 * signed with JWT_SECRET, bound to evidence id + user id, 60 s lifetime.
 * Used by <video>/<a> elements that cannot send the session cookie's CSRF header.
 */
import { hmacSha256, timingSafeEqualStr } from '../../lib/crypto';

export const EVIDENCE_TICKET_TTL_SECONDS = 60;

interface TicketPayload {
  /** evidence id */
  e: string;
  /** user id the ticket was issued to */
  u: string;
  /** expiry, unix ms */
  x: number;
}

function sign(secret: string, payloadB64: string): string {
  return hmacSha256(secret, `evidence-ticket:v1:${payloadB64}`).toString('base64url');
}

export function issueEvidenceTicket(
  secret: string,
  evidenceId: string,
  userId: string,
  now: Date,
): { ticket: string; expiresAt: Date } {
  const expiresAt = new Date(now.getTime() + EVIDENCE_TICKET_TTL_SECONDS * 1000);
  const payload: TicketPayload = { e: evidenceId, u: userId, x: expiresAt.getTime() };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return { ticket: `${payloadB64}.${sign(secret, payloadB64)}`, expiresAt };
}

/** Returns the user id the ticket was issued to, or null (invalid/expired/wrong evidence). */
export function verifyEvidenceTicket(secret: string, ticket: string, evidenceId: string, now: Date): string | null {
  const dot = ticket.indexOf('.');
  if (dot <= 0 || dot === ticket.length - 1 || ticket.length > 2048) return null;
  const payloadB64 = ticket.slice(0, dot);
  const mac = ticket.slice(dot + 1);
  if (!timingSafeEqualStr(sign(secret, payloadB64), mac)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const { e, u, x } = payload as Partial<TicketPayload>;
  if (typeof e !== 'string' || typeof u !== 'string' || typeof x !== 'number') return null;
  if (e !== evidenceId) return null;
  if (!Number.isSafeInteger(x) || now.getTime() > x) return null;
  return u;
}
