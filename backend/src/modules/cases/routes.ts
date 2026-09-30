/**
 * Web routes of the cases module (§13 "Cases"). Staff listing/detail use
 * requireAuth + service-level scoping (caseStaffScope: reviewers see all, server
 * teams only their servers' cases); the public case view needs no session.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  CaseCommentRequestSchema,
  CaseConfirmationCreateRequestSchema,
  CaseConfirmationParamsSchema,
  CaseConfirmationRevokeRequestSchema,
  CaseCreateRequestSchema,
  CaseListQuerySchema,
  CaseListResponseSchema,
  CaseMutationResponseSchema,
  CaseParamsSchema,
  CasePublicViewSchema,
  CaseStaffViewSchema,
  CaseVerdictRequestSchema,
  OkResponseSchema,
  Permission,
} from '@scpsl-trust/shared';

import { assertAuthenticated, requireAuth, requireMfaSession, requirePermission } from '../../auth/rbac';
import type { Deps } from '../../container';
import type { CasesService } from './service';

export async function registerCaseRoutes(app: FastifyInstance, deps: Deps, service: CasesService): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/cases',
    {
      schema: {
        tags: ['cases'],
        summary: 'List cases (staff; server teams see only their servers)',
        querystring: CaseListQuerySchema,
        response: { 200: CaseListResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      const { items, total } = await service.listCases(user, request.query);
      return { items, total, page: request.query.page, page_size: request.query.page_size };
    },
  );

  r.post(
    '/cases',
    {
      schema: {
        tags: ['cases'],
        summary: 'Create a case',
        body: CaseCreateRequestSchema,
        response: { 201: CaseMutationResponseSchema },
      },
      preHandler: [requirePermission(Permission.CASE_CREATE)],
    },
    async (request, reply) => {
      const user = assertAuthenticated(request);
      const result = await service.createCase(request, user, request.body);
      return reply.code(201).send(result);
    },
  );

  r.get(
    '/cases/:caseNumber',
    {
      schema: {
        tags: ['cases'],
        summary: 'Staff case view',
        params: CaseParamsSchema,
        response: { 200: CaseStaffViewSchema },
      },
      preHandler: [requireAuth],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      return service.getStaffView(user, request.params.caseNumber);
    },
  );

  r.post(
    '/cases/:caseNumber/reviews/start',
    {
      schema: {
        tags: ['cases'],
        summary: 'Move an open case to under_review',
        params: CaseParamsSchema,
        body: CaseCommentRequestSchema,
        response: { 200: CaseMutationResponseSchema },
      },
      preHandler: [requirePermission(Permission.CASE_REVIEW)],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      return service.startReview(request, user, request.params.caseNumber, request.body.comment);
    },
  );

  r.post(
    '/cases/:caseNumber/notes',
    {
      schema: {
        tags: ['cases'],
        summary: 'Add an internal note',
        params: CaseParamsSchema,
        body: CaseCommentRequestSchema,
        response: { 200: CaseMutationResponseSchema },
      },
      preHandler: [requirePermission(Permission.CASE_REVIEW)],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      return service.addNote(request, user, request.params.caseNumber, request.body.comment);
    },
  );

  r.post(
    '/cases/:caseNumber/verdict',
    {
      schema: {
        tags: ['cases'],
        summary: 'Set the case verdict (2FA session required)',
        params: CaseParamsSchema,
        body: CaseVerdictRequestSchema,
        response: { 200: CaseMutationResponseSchema },
      },
      preHandler: [requirePermission(Permission.CASE_SET_VERDICT), requireMfaSession],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      return service.setVerdict(request, user, request.params.caseNumber, request.body);
    },
  );

  r.post(
    '/cases/:caseNumber/reopen',
    {
      schema: {
        tags: ['cases'],
        summary: 'Reopen a closed case',
        params: CaseParamsSchema,
        body: CaseCommentRequestSchema,
        response: { 200: CaseMutationResponseSchema },
      },
      preHandler: [requirePermission(Permission.CASE_REOPEN)],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      return service.reopen(request, user, request.params.caseNumber, request.body.comment);
    },
  );

  // -------------------------------------------------------------------------
  // Server confirmations (§11.4) — authorized by server-team membership,
  // never by a global permission.
  // -------------------------------------------------------------------------

  r.post(
    '/cases/:caseNumber/confirmations',
    {
      schema: {
        tags: ['cases'],
        summary: 'Confirm the case for one of your servers',
        params: CaseParamsSchema,
        body: CaseConfirmationCreateRequestSchema,
        response: { 201: CaseMutationResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = assertAuthenticated(request);
      const result = await service.addConfirmation(request, user, request.params.caseNumber, request.body);
      return reply.code(201).send(result);
    },
  );

  r.delete(
    '/cases/:caseNumber/confirmations/:id',
    {
      schema: {
        tags: ['cases'],
        summary: 'Revoke a server confirmation (soft)',
        params: CaseConfirmationParamsSchema,
        body: CaseConfirmationRevokeRequestSchema.optional(),
        response: { 200: OkResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      await service.revokeConfirmation(
        request,
        user,
        request.params.caseNumber,
        request.params.id,
        request.body?.reason ?? null,
      );
      return { ok: true as const };
    },
  );

  // -------------------------------------------------------------------------
  // Public view — no session, no CSRF
  // -------------------------------------------------------------------------

  r.get(
    '/public/cases/:caseNumber',
    {
      schema: {
        tags: ['public'],
        summary: 'Limited public case view',
        params: CaseParamsSchema,
        response: { 200: CasePublicViewSchema },
      },
    },
    async (request) => service.getPublicView(request.params.caseNumber),
  );
}
