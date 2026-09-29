/**
 * Principals attached to requests by the auth hooks.
 */
import type { ServerMemberRole, ServerStatus, UserRole, UserStatus } from '@scpsl-trust/shared';

/** Web user of a valid session (request.user). */
export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  email_verified: boolean;
  totp_enabled: boolean;
  player_id: string | null;
  reviewer_number: number | null;
}

/** The session behind request.user (request.session). */
export interface AuthenticatedSession {
  id: string;
  mfa_verified: boolean;
  /** Role requires 2FA (REQUIRE_2FA_ROLES) but none is enrolled (§12.2). */
  mfa_enrollment_required: boolean;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  idle_expires_at: Date;
}

/**
 * SCP:SL server of a verified signed request (§5.4 step 8). Exposed as
 * `request.authServer` because Fastify reserves `request.server` for the instance.
 */
export interface AuthenticatedServer {
  /** servers.id (uuid). */
  id: string;
  /** Public `srv_…` id. */
  server_id: string;
  /** server_keys.id of the key that produced the signature. */
  key_id: string;
  fingerprint: string;
  /** X-Plugin-Version of this request. */
  plugin_version: string;
  name: string;
  owner_user_id: string;
}

/** Result of a server-scoped authorization check (request.serverAccess). */
export interface ServerAccess {
  server: {
    id: string;
    server_id: string;
    name: string;
    status: ServerStatus;
    owner_user_id: string;
    is_trusted: boolean;
  };
  /** Membership role of the user on this server (null when access came from an override permission). */
  member_role: ServerMemberRole | null;
  via: 'membership' | 'override';
}
