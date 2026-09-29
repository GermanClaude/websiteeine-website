/**
 * Appeal endpoints (ARCHITECTURE §11.5, §13 "Appeals").
 */
import {
  AppealListResponseSchema,
  AppealViewSchema,
  type AppealAssignRequest,
  type AppealCreateRequest,
  type AppealDecisionRequest,
  type AppealListQuery,
  type AppealListResponse,
  type AppealView,
} from '@scpsl-trust/shared';

import { api } from './client';
import { createQueryKeys } from './keys';

export const appealKeys = createQueryKeys('appeals');

const path = (id: string, suffix = ''): string => `/appeals/${encodeURIComponent(id)}${suffix}`;

/** appeal:decide → all appeals; everyone else → own appeals. */
export function listAppeals(query: Partial<AppealListQuery> = {}): Promise<AppealListResponse> {
  return api.get<AppealListResponse>('/appeals', { query, schema: AppealListResponseSchema });
}

export function getAppeal(id: string): Promise<AppealView> {
  return api.get<AppealView>(path(id), { schema: AppealViewSchema });
}

/** Only by the user whose linked player is the case player (403 PLAYER_NOT_LINKED otherwise). */
export function createAppeal(body: AppealCreateRequest): Promise<AppealView> {
  return api.post<AppealView>('/appeals', body, { schema: AppealViewSchema });
}

export function assignAppeal(id: string, body: AppealAssignRequest): Promise<AppealView> {
  return api.post<AppealView>(path(id, '/assign'), body, { schema: AppealViewSchema });
}

/** 409 CONFLICT_OF_INTEREST unless `override_conflict` with appeal:override_conflict. */
export function decideAppeal(id: string, body: AppealDecisionRequest): Promise<AppealView> {
  return api.post<AppealView>(path(id, '/decision'), body, { schema: AppealViewSchema });
}

export function withdrawAppeal(id: string): Promise<AppealView> {
  return api.post<AppealView>(path(id, '/withdraw'), {}, { schema: AppealViewSchema });
}
