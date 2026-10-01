/**
 * Security monitor endpoints (ARCHITECTURE §13 "Admin" — server-side intrusion detection &
 * anomaly flagging). All detection and blocking happen on the server; these endpoints only
 * read the append-only `security_events` log, list the transient blocks and clear one.
 *
 *   GET  /admin/security/events           (security:view)
 *   GET  /admin/security/blocks           (security:view)
 *   GET  /admin/security/summary          (security:view)
 *   POST /admin/security/blocks/{id}/clear (security:manage)
 *
 * Sources are always privacy-preserving references (HMAC network hash / user id / server id) —
 * a raw IP never appears in any response field.
 */
import {
  SecurityBlockClearResponseSchema,
  SecurityBlockListResponseSchema,
  SecurityEventListResponseSchema,
  SecuritySummaryResponseSchema,
  type SecurityBlockClearRequest,
  type SecurityBlockClearResponse,
  type SecurityBlockListResponse,
  type SecurityEventListQuery,
  type SecurityEventListResponse,
  type SecuritySummaryResponse,
} from '@scpsl-trust/shared';

import { api } from './client';
import { createQueryKeys, type QueryFilters } from './keys';

export const securityKeys = {
  ...createQueryKeys('security'),
  summary: () => ['security', 'summary'] as const,
  blocks: () => ['security', 'blocks'] as const,
  anomalies: (filters: QueryFilters = {}) => ['security', 'anomalies', filters] as const,
};

export function listSecurityEvents(query: Partial<SecurityEventListQuery> = {}): Promise<SecurityEventListResponse> {
  return api.get<SecurityEventListResponse>('/admin/security/events', { query, schema: SecurityEventListResponseSchema });
}

export function getSecuritySummary(): Promise<SecuritySummaryResponse> {
  return api.get<SecuritySummaryResponse>('/admin/security/summary', { schema: SecuritySummaryResponseSchema });
}

export function listSecurityBlocks(): Promise<SecurityBlockListResponse> {
  return api.get<SecurityBlockListResponse>('/admin/security/blocks', { schema: SecurityBlockListResponseSchema });
}

/** POST /admin/security/blocks/{id}/clear — clears a transient block (security:manage; audited). */
export function clearSecurityBlock(id: string, body: SecurityBlockClearRequest = { reason: null }): Promise<SecurityBlockClearResponse> {
  return api.post<SecurityBlockClearResponse>(`/admin/security/blocks/${encodeURIComponent(id)}/clear`, body, {
    schema: SecurityBlockClearResponseSchema,
  });
}
