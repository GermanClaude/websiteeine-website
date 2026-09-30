/**
 * Evidence routes (§13 "Evidence"). Multipart uploads are parsed part-by-part: the
 * non-file fields (sent before the file) are validated with the shared schemas, the file
 * itself is streamed to object storage while being hashed and MIME-sniffed.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { z } from 'zod';

import {
  CaseNumberSchema,
  EvidenceContentQuerySchema,
  EvidenceDetailQuerySchema,
  EvidenceDetailSchema,
  EvidenceLinkCreateRequestSchema,
  EvidenceListQuerySchema,
  EvidenceListResponseSchema,
  EvidenceParamsSchema,
  EvidenceReviewRequestSchema,
  EvidenceReviewViewSchema,
  EvidenceSupersedeFieldsSchema,
  EvidenceTicketResponseSchema,
  EvidenceUploadFieldsSchema,
  EvidenceViewSchema,
  Permission,
} from '@scpsl-trust/shared';

import { assertAuthenticated, requireAuth, requirePermission } from '../../auth/rbac';
import type { Deps } from '../../container';
import { validation } from '../../lib/errors';
import type { EvidenceService, UploadedFile } from './service';

const CaseParamsSchema = EvidenceParamsSchema.pick({}).extend({ caseNumber: CaseNumberSchema });

/**
 * Reads a multipart request: collects the text fields that precede the file part and hands
 * back the file stream (the file is intentionally sent last by the web client).
 */
async function readMultipart(request: FastifyRequest): Promise<{ fields: Record<string, string>; file: UploadedFile }> {
  if (!request.isMultipart()) throw validation('Request must be multipart/form-data');
  const fields: Record<string, string> = {};
  // Manual iteration: breaking a for-await would invoke iterator.return(), which drains
  // the pending file stream before the handler had a chance to read it.
  const iterator = request.parts()[Symbol.asyncIterator]();
  for (;;) {
    const { value: part, done } = await iterator.next();
    if (done === true) break;
    if (part.type === 'field') {
      if (typeof part.value === 'string') fields[part.fieldname] = part.value;
      continue;
    }
    return {
      fields,
      file: { stream: part.file, filename: part.filename, mimeType: part.mimetype },
    };
  }
  throw validation([{ path: 'file', message: 'A file part is required' }]);
}

function parseFields<S extends z.ZodType>(schema: S, fields: Record<string, string>): z.output<S> {
  const result = schema.safeParse(fields);
  if (!result.success) {
    throw validation(result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })));
  }
  return result.data;
}

/** RFC 6266 filename sanitization for the Content-Disposition header. */
function contentDisposition(filename: string | null, evidenceId: string): string {
  const safe = (filename ?? `evidence-${evidenceId}`).replace(/["\\\r\n]/g, '_');
  return `attachment; filename="${safe}"`;
}

export async function registerEvidenceRoutes(app: FastifyInstance, deps: Deps, service: EvidenceService): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/cases/:caseNumber/evidence',
    {
      schema: {
        tags: ['evidence'],
        summary: 'Upload evidence to a case (multipart; streamed, hashed, MIME-sniffed)',
        params: CaseParamsSchema,
        response: { 201: EvidenceViewSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = assertAuthenticated(request);
      const { fields, file } = await readMultipart(request);
      const parsed = parseFields(EvidenceUploadFieldsSchema, fields);
      const view = await service.uploadToCase(request, user, request.params.caseNumber, parsed, file);
      return reply.code(201).send(view);
    },
  );

  r.post(
    '/cases/:caseNumber/evidence/link',
    {
      schema: {
        tags: ['evidence'],
        summary: 'Attach link evidence to a case (https only; nothing is stored)',
        params: CaseParamsSchema,
        body: EvidenceLinkCreateRequestSchema,
        response: { 201: EvidenceViewSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = assertAuthenticated(request);
      const view = await service.createLink(request, user, request.params.caseNumber, request.body);
      return reply.code(201).send(view);
    },
  );

  r.get(
    '/evidence',
    {
      schema: {
        tags: ['evidence'],
        summary: 'Evidence review queue (evidence:view; filters status/type/case)',
        querystring: EvidenceListQuerySchema,
        response: { 200: EvidenceListResponseSchema },
      },
      preHandler: [requirePermission(Permission.EVIDENCE_VIEW)],
    },
    async (request) => {
      const { items, total } = await service.list(request.query);
      return { items, total, page: request.query.page, page_size: request.query.page_size };
    },
  );

  r.get(
    '/evidence/:id',
    {
      schema: {
        tags: ['evidence'],
        summary: 'Evidence metadata, review history and supersede chain (§11.3 access rule)',
        params: EvidenceParamsSchema,
        querystring: EvidenceDetailQuerySchema,
        response: { 200: EvidenceDetailSchema },
      },
      preHandler: [requireAuth],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      return service.getDetail(request, user, request.params.id, request.query.verify === true);
    },
  );

  r.post(
    '/evidence/:id/ticket',
    {
      schema: {
        tags: ['evidence'],
        summary: '60 s download ticket for media elements (same access rule; audited)',
        params: EvidenceParamsSchema,
        response: { 200: EvidenceTicketResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      return service.issueTicket(request, user, request.params.id);
    },
  );

  r.get(
    '/evidence/:id/content',
    {
      schema: {
        tags: ['evidence'],
        summary: 'Download evidence content (session or ?ticket=; audited; hardened headers)',
        params: EvidenceParamsSchema,
        querystring: EvidenceContentQuerySchema,
      },
      // No preHandler: a valid ticket authenticates on its own (media elements cannot
      // send the CSRF header); session access is checked in the service.
    },
    async (request, reply) => {
      const { row, stream } = await service.getContent(request, request.user, request.params.id, request.query.ticket);
      reply.header('content-type', row.mime_type ?? 'application/octet-stream');
      if (row.size_bytes !== null) reply.header('content-length', String(row.size_bytes));
      reply.header('content-disposition', contentDisposition(row.original_filename, row.id));
      reply.header('x-content-type-options', 'nosniff');
      reply.header('content-security-policy', "sandbox; default-src 'none'");
      reply.header('cache-control', 'private, no-store');
      return reply.send(stream);
    },
  );

  r.post(
    '/evidence/:id/reviews',
    {
      schema: {
        tags: ['evidence'],
        summary: 'Review evidence: three independent assessments + overall (never the verdict, R2)',
        params: EvidenceParamsSchema,
        body: EvidenceReviewRequestSchema,
        response: { 201: EvidenceReviewViewSchema },
      },
      preHandler: [requirePermission(Permission.EVIDENCE_REVIEW)],
    },
    async (request, reply) => {
      const user = assertAuthenticated(request);
      const view = await service.review(request, user, request.params.id, request.body);
      return reply.code(201).send(view);
    },
  );

  r.post(
    '/evidence/:id/supersede',
    {
      schema: {
        tags: ['evidence'],
        summary: 'Replace evidence with a new object (multipart; the old row is kept and linked)',
        params: EvidenceParamsSchema,
        response: { 201: EvidenceViewSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = assertAuthenticated(request);
      const { fields, file } = await readMultipart(request);
      const parsed = parseFields(EvidenceSupersedeFieldsSchema, fields);
      const view = await service.supersede(request, user, request.params.id, parsed, file);
      return reply.code(201).send(view);
    },
  );
}
