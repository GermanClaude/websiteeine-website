/**
 * Reports (ARCHITECTURE §11.1, §13 "Reports").
 */
import {
  ReportCreateResponseSchema,
  ReportListResponseSchema,
  ReportViewSchema,
  type ReportCreateRequest,
  type ReportCreateResponse,
  type ReportListQuery,
  type ReportListResponse,
  type ReportStatusChangeRequest,
  type ReportView,
} from '@scpsl-trust/shared';

import { api } from './client';
import { createQueryKeys } from './keys';

export const reportKeys = createQueryKeys('reports');

/** report:review sees every report (with filters); everyone else implicitly sees only their own. */
export function listReports(query: Partial<ReportListQuery>): Promise<ReportListResponse> {
  return api.get<ReportListResponse>('/reports', { query, schema: ReportListResponseSchema });
}

export function getReport(id: string): Promise<ReportView> {
  return api.get<ReportView>(`/reports/${encodeURIComponent(id)}`, { schema: ReportViewSchema });
}

/** Attaches to the player's open case or creates a new one (report counts never change verdicts). */
export function createReport(body: ReportCreateRequest): Promise<ReportCreateResponse> {
  return api.post<ReportCreateResponse>('/reports', body, { schema: ReportCreateResponseSchema });
}

/** report:review — a note is mandatory and the change is audited. */
export function changeReportStatus(id: string, body: ReportStatusChangeRequest): Promise<ReportView> {
  return api.post<ReportView>(`/reports/${encodeURIComponent(id)}/status`, body, { schema: ReportViewSchema });
}
