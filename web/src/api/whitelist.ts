/**
 * Whitelist request endpoints (ARCHITECTURE §11.6, §13 "Whitelist").
 */
import {
  WhitelistRequestListResponseSchema,
  WhitelistRequestViewSchema,
  type WhitelistDecisionRequest,
  type WhitelistRequestCreateRequest,
  type WhitelistRequestListQuery,
  type WhitelistRequestListResponse,
  type WhitelistRequestView,
  type WhitelistRevokeRequest,
} from '@scpsl-trust/shared';

import { api } from './client';
import { createQueryKeys } from './keys';

export const whitelistKeys = createQueryKeys('whitelist-requests');

const path = (id: string, suffix = ''): string => `/whitelist-requests/${encodeURIComponent(id)}${suffix}`;

/** Own requests; server members see their servers' requests; whitelist:decide_any sees all. */
export function listWhitelistRequests(query: Partial<WhitelistRequestListQuery> = {}): Promise<WhitelistRequestListResponse> {
  return api.get<WhitelistRequestListResponse>('/whitelist-requests', { query, schema: WhitelistRequestListResponseSchema });
}

export function getWhitelistRequest(id: string): Promise<WhitelistRequestView> {
  return api.get<WhitelistRequestView>(path(id), { schema: WhitelistRequestViewSchema });
}

export function createWhitelistRequest(body: WhitelistRequestCreateRequest): Promise<WhitelistRequestView> {
  return api.post<WhitelistRequestView>('/whitelist-requests', body, { schema: WhitelistRequestViewSchema });
}

export function decideWhitelistRequest(id: string, body: WhitelistDecisionRequest): Promise<WhitelistRequestView> {
  return api.post<WhitelistRequestView>(path(id, '/decision'), body, { schema: WhitelistRequestViewSchema });
}

/** Revokes the bypass created by an approved request (status → revoked). */
export function revokeWhitelistRequest(id: string, body: WhitelistRevokeRequest): Promise<WhitelistRequestView | undefined> {
  return api.post<WhitelistRequestView | undefined>(path(id, '/revoke'), body, { schema: WhitelistRequestViewSchema });
}
