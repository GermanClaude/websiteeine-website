/**
 * Server management endpoints (ARCHITECTURE §13 "Servers"). `{id}` is the public `srv_…` id.
 */
import type { z } from 'zod';

import {
  BypassListResponseSchema,
  BypassViewSchema,
  KeyRotationRequestResponseSchema,
  OkResponseSchema,
  RegistrationTokenResponseSchema,
  ServerCreateResponseSchema,
  ServerKeyListResponseSchema,
  ServerListResponseSchema,
  ServerMemberListResponseSchema,
  ServerMemberViewSchema,
  ServerUpdateRequestSchema,
  ServerViewSchema,
  type BypassCreateRequest,
  type BypassListQuery,
  type BypassListResponse,
  type BypassView,
  type KeyRevokeRequest,
  type KeyRotationRequestResponse,
  type OkResponse,
  type RegistrationTokenResponse,
  type ServerCreateRequest,
  type ServerCreateResponse,
  type ServerKeyListResponse,
  type ServerListQuery,
  type ServerListResponse,
  type ServerMemberAddRequest,
  type ServerMemberListResponse,
  type ServerMemberView,
  type ServerStatusChangeRequest,
  type ServerTrustRequest,
  type ServerView,
} from '@scpsl-trust/shared';

/** PATCH body as typed by forms (every field optional; '' clears the description). */
export type ServerUpdateInput = z.input<typeof ServerUpdateRequestSchema>;

import { api } from './client';
import { createQueryKeys } from './keys';

export const serverKeys = createQueryKeys('servers');

const path = (serverId: string, suffix = ''): string => `/servers/${encodeURIComponent(serverId)}${suffix}`;

export function listServers(query: Partial<ServerListQuery> = {}): Promise<ServerListResponse> {
  return api.get<ServerListResponse>('/servers', { query, schema: ServerListResponseSchema });
}

export function getServer(serverId: string): Promise<ServerView> {
  return api.get<ServerView>(path(serverId), { schema: ServerViewSchema });
}

/** Creates a server (server:create); the registration token is returned exactly once. */
export function createServer(body: ServerCreateRequest): Promise<ServerCreateResponse> {
  return api.post<ServerCreateResponse>('/servers', body, { schema: ServerCreateResponseSchema });
}

export function updateServer(serverId: string, body: ServerUpdateInput): Promise<ServerView> {
  return api.patch<ServerView>(path(serverId), body, { schema: ServerViewSchema });
}

/** New registration token for re-enrollment (revokes the previous unused token). */
export function createRegistrationToken(serverId: string): Promise<RegistrationTokenResponse> {
  return api.post<RegistrationTokenResponse>(path(serverId, '/registration-token'), undefined, {
    schema: RegistrationTokenResponseSchema,
  });
}

export function changeServerStatus(serverId: string, body: ServerStatusChangeRequest): Promise<ServerView> {
  return api.post<ServerView>(path(serverId, '/status'), body, { schema: ServerViewSchema });
}

export function setServerTrust(serverId: string, body: ServerTrustRequest): Promise<ServerView> {
  return api.post<ServerView>(path(serverId, '/trust'), body, { schema: ServerViewSchema });
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export function listServerKeys(serverId: string): Promise<ServerKeyListResponse> {
  return api.get<ServerKeyListResponse>(path(serverId, '/keys'), { schema: ServerKeyListResponseSchema });
}

export function revokeServerKey(serverId: string, keyId: string, body: KeyRevokeRequest): Promise<OkResponse | undefined> {
  return api.post<OkResponse | undefined>(path(serverId, `/keys/${encodeURIComponent(keyId)}/revoke`), body, {
    schema: OkResponseSchema,
  });
}

export function requestKeyRotation(serverId: string): Promise<KeyRotationRequestResponse> {
  return api.post<KeyRotationRequestResponse>(path(serverId, '/keys/rotation-request'), undefined, {
    schema: KeyRotationRequestResponseSchema,
  });
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export function listServerMembers(serverId: string): Promise<ServerMemberListResponse> {
  return api.get<ServerMemberListResponse>(path(serverId, '/members'), { schema: ServerMemberListResponseSchema });
}

export function addServerMember(serverId: string, body: ServerMemberAddRequest): Promise<ServerMemberView> {
  return api.post<ServerMemberView>(path(serverId, '/members'), body, { schema: ServerMemberViewSchema });
}

export function removeServerMember(serverId: string, userId: string): Promise<OkResponse | undefined> {
  return api.delete<OkResponse | undefined>(path(serverId, `/members/${encodeURIComponent(userId)}`), {
    schema: OkResponseSchema,
  });
}

// ---------------------------------------------------------------------------
// Server-scoped bypasses
// ---------------------------------------------------------------------------

export function listServerBypasses(serverId: string, query: Partial<BypassListQuery> = {}): Promise<BypassListResponse> {
  return api.get<BypassListResponse>(path(serverId, '/bypasses'), { query, schema: BypassListResponseSchema });
}

export function createServerBypass(serverId: string, body: BypassCreateRequest): Promise<BypassView> {
  return api.post<BypassView>(path(serverId, '/bypasses'), body, { schema: BypassViewSchema });
}
