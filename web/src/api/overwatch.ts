/**
 * Overwatch proof sessions, web views (ARCHITECTURE §10.1, §13 "Overwatch"). No secret, ever.
 */
import {
  OverwatchSessionListResponseSchema,
  OverwatchSessionViewSchema,
  type OverwatchSessionListQuery,
  type OverwatchSessionListResponse,
  type OverwatchSessionView,
} from '@scpsl-trust/shared';

import { api } from './client';
import { createQueryKeys } from './keys';

export const overwatchKeys = createQueryKeys('overwatch');

export function listOverwatchSessions(query: Partial<OverwatchSessionListQuery>): Promise<OverwatchSessionListResponse> {
  return api.get<OverwatchSessionListResponse>('/overwatch/sessions', { query, schema: OverwatchSessionListResponseSchema });
}

export function getOverwatchSession(id: string): Promise<OverwatchSessionView> {
  return api.get<OverwatchSessionView>(`/overwatch/sessions/${encodeURIComponent(id)}`, { schema: OverwatchSessionViewSchema });
}
