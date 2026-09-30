/**
 * Web routes of the appeals module (§13 "Appeals").
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  AppealAssignRequestSchema,
  AppealCreateRequestSchema,
  AppealDecisionRequestSchema,
  AppealListQuerySchema,
  AppealListResponseSchema,
  AppealParamsSchema,
  AppealViewSchema,
  AppealWithdrawRequestSchema,
  Permission,
} from '@scpsl-trust/shared';

import { assertAuthenticated, requireEnrolledAuth, requirePermission } from '../../auth/rbac';
import type { Deps } from '../../container';
import type { AppealsService } from './service';

export async function registerAppealRoutes(app: FastifyInstance, _deps: Deps, service: AppealsService): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/appeals',
    {
      schema: {
        tags: ['appeals'],
        summary: 'Appeal a confirmed/inconclusive case verdict (linked player only)',
        body: AppealCreateRequestSchema,
        response: { 201: AppealViewSchema },
      },
      preHandler: [requirePermission(Permission.APPEAL_CREATE)],
    },
    async (request, reply) => {
      const user = assertAuthenticated(request);
      const view = await service.create(request, user, request.body);
      return reply.code(201).send(view);
    },
  );

  r.get(
    '/appeals',
    {
      schema: {
        tags: ['appeals'],
        summary: 'List appeals (deciders: all with filters; others: own)',
        querystring: AppealListQuerySchema,
        response: { 200: AppealListResponseSchema },
      },
      preHandler: [requireEnrolledAuth],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      const { items, total } = await service.list(user, request.query);
      return { items, total, page: request.query.page, page_size: request.query.page_size };
    },
  );

  r.get(
    '/appeals/:id',
    {
      schema: {
        tags: ['appeals'],
        summary: 'Appeal detail (decider or submitter)',
        params: AppealParamsSchema,
        response: { 200: AppealViewSchema },
      },
      preHandler: [requireEnrolledAuth],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      return service.get(user, request.params.id);
    },
  );

  r.post(
    '/appeals/:id/assign',
    {
      schema: {
        tags: ['appeals'],
        summary: 'Assign an appeal to a reviewer',
        params: AppealParamsSchema,
        body: AppealAssignRequestSchema,
        response: { 200: AppealViewSchema },
      },
      preHandler: [requirePermission(Permission.APPEAL_ASSIGN)],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      return service.assign(request, user, request.params.id, request.body.reviewer_user_id);
    },
  );

  r.post(
    '/appeals/:id/decision',
    {
      schema: {
        tags: ['appeals'],
        summary: 'Decide an appeal (independence rule §11.5)',
        params: AppealParamsSchema,
        body: AppealDecisionRequestSchema,
        response: { 200: AppealViewSchema },
      },
      preHandler: [requirePermission(Permission.APPEAL_DECIDE)],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      return service.decide(request, user, request.params.id, request.body);
    },
  );

  r.post(
    '/appeals/:id/withdraw',
    {
      schema: {
        tags: ['appeals'],
        summary: 'Withdraw an appeal (submitter)',
        params: AppealParamsSchema,
        body: AppealWithdrawRequestSchema,
        response: { 200: AppealViewSchema },
      },
      preHandler: [requireEnrolledAuth],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      return service.withdraw(request, user, request.params.id);
    },
  );
}
