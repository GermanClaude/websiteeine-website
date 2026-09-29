/**
 * GET /dashboard (ARCHITECTURE §13 "Dashboard").
 */
import { DashboardResponseSchema, type DashboardResponse } from '@scpsl-trust/shared';

import { api } from './client';

export function getDashboard(): Promise<DashboardResponse> {
  return api.get<DashboardResponse>('/dashboard', { schema: DashboardResponseSchema });
}
