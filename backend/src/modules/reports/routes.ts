/**
 * Web routes of the reports module (§13 "Reports").
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  Permission,
  ReportCreateRequestSchema,
  ReportCreateResponseSchema,
  ReportListQuerySchema,
  ReportListResponseSchema,
  ReportParamsSchema,
  ReportStatusChangeRequestSchema,
  ReportViewSchema,
} from '@scpsl-trust/shared';

import { assertAuthenticated, requireEnrolledAuth, requirePermission, requireVerifiedEmail } from '../../auth/rbac';
import type { Deps } from '../../container';
import type { ReportsService } from './service';

export async function registerReportRoutes(app: FastifyInstance, deps: Deps, service: ReportsService): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/reports',
    {
      schema: {
        tags: ['reports'],
        summary: 'List reports (report:review sees all; others only their own)',
        querystring: ReportListQuerySchema,
        response: { 200: ReportListResponseSchema },
      },
      preHandler: [requireEnrolledAuth],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      const { items, total } = await service.listReports(user, request.query);
      return { items, total, page: request.query.page, page_size: request.query.page_size };
    },
  );

  r.post(
    '/reports',
    {
      schema: {
        tags: ['reports'],
        summary: 'Report a player (verified email; 10/h rate limit)',
        body: ReportCreateRequestSchema,
        response: { 201: ReportCreateResponseSchema },
      },
      config: { rateLimit: deps.rateLimits.reportCreate },
      preHandler: [requirePermission(Permission.REPORT_CREATE), requireVerifiedEmail],
    },
    async (request, reply) => {
      const user = assertAuthenticated(request);
      const result = await service.createReport(request, user, request.body);
      return reply.code(201).send(result);
    },
  );

  r.get(
    '/reports/:id',
    {
      schema: {
        tags: ['reports'],
        summary: 'Report detail (reviewer or the reporter)',
        params: ReportParamsSchema,
        response: { 200: ReportViewSchema },
      },
      preHandler: [requireEnrolledAuth],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      return service.getReport(user, request.params.id);
    },
  );

  r.post(
    '/reports/:id/status',
    {
      schema: {
        tags: ['reports'],
        summary: 'Change a report status (report:review; note mandatory)',
        params: ReportParamsSchema,
        body: ReportStatusChangeRequestSchema,
        response: { 200: ReportViewSchema },
      },
      preHandler: [requirePermission(Permission.REPORT_REVIEW)],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      return service.changeStatus(request, user, request.params.id, request.body);
    },
  );
}
