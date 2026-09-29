/**
 * GET /dashboard (§13 "Dashboard") — counts scoped by the caller's permissions and memberships.
 * A count is null when the caller has no access to that area.
 */
import { z } from 'zod';
import { AuditEventSummarySchema } from './audit';
import { IsoDateTimeSchema } from './common';
import { ServerSummarySchema } from './servers';

const countSchema = z.number().int().min(0).nullable();

export const DashboardCountsSchema = z.object({
  open_cases: countSchema,
  cases_under_review: countSchema,
  pending_reports: countSchema,
  pending_appeals: countSchema,
  evidence_awaiting_review: countSchema,
  pending_whitelist_requests: countSchema,
});
export type DashboardCounts = z.infer<typeof DashboardCountsSchema>;

export const DashboardResponseSchema = z.object({
  counts: DashboardCountsSchema,
  servers: z.array(ServerSummarySchema),
  recent_audit_events: z.array(AuditEventSummarySchema),
  generated_at: IsoDateTimeSchema,
});
export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;
