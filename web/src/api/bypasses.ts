/**
 * Bypass endpoints (ARCHITECTURE §11.6, §13): revocation of any bypass and the global
 * bypasses managed by admins (`bypass:manage_global`).
 */
import {
  BypassListResponseSchema,
  BypassViewSchema,
  OkResponseSchema,
  type BypassCreateRequest,
  type BypassListQuery,
  type BypassListResponse,
  type BypassRevokeRequest,
  type BypassView,
  type OkResponse,
} from '@scpsl-trust/shared';

import { api } from './client';
import { createQueryKeys } from './keys';

export const bypassKeys = createQueryKeys('bypasses');

export function revokeBypass(bypassId: string, body: BypassRevokeRequest): Promise<OkResponse | undefined> {
  return api.post<OkResponse | undefined>(`/bypasses/${encodeURIComponent(bypassId)}/revoke`, body, { schema: OkResponseSchema });
}

/** GET /admin/bypasses — global (and, with filters, all) bypasses. */
export function listGlobalBypasses(query: Partial<BypassListQuery> = {}): Promise<BypassListResponse> {
  return api.get<BypassListResponse>('/admin/bypasses', { query, schema: BypassListResponseSchema });
}

/** POST /admin/bypasses — grants a global bypass (scope `global`). */
export function createGlobalBypass(body: BypassCreateRequest): Promise<BypassView> {
  return api.post<BypassView>('/admin/bypasses', body, { schema: BypassViewSchema });
}
