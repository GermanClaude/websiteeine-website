/**
 * Uniform error responses (ARCHITECTURE §2.1, §14):
 *   { "error": { "code", "message", "details"?, "request_id" } }
 * Never a stack trace, SQL or internal message. 5xx errors are logged with their stack
 * server-side only.
 */
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors, ResponseSerializationError } from 'fastify-type-provider-zod';

import {
  buildErrorResponse,
  errorMessage,
  errorStatus,
  type ErrorCode,
  type ErrorDetails,
  type ValidationIssue,
} from '@scpsl-trust/shared';

import { isForbiddenOperation, isUniqueViolation } from '../db/errors';
import { AppError, isAppError } from '../lib/errors';

interface MappedError {
  code: ErrorCode;
  message: string;
  details?: ErrorDetails;
  headers?: Readonly<Record<string, string>>;
  /** Log at error level with the full error (unexpected failures). */
  logAsError: boolean;
}

/** '/player/id' → 'player.id'; prefixed with the part (querystring, params, …) when not the body. */
function issuePath(instancePath: string, context: string | undefined): string {
  const path = instancePath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .join('.');
  if (context === undefined || context === 'body') return path;
  return path.length > 0 ? `${context}.${path}` : context;
}

function validationDetails(error: FastifyError): ValidationIssue[] {
  const context = (error as { validationContext?: string }).validationContext;
  return (error.validation ?? []).slice(0, 50).map((issue) => ({
    path: issuePath(issue.instancePath ?? '', context),
    message: typeof issue.message === 'string' ? issue.message.slice(0, 300) : 'Invalid value',
  }));
}

/** Fastify / plugin errors with a 4xx status, mapped by code or status. */
const FASTIFY_CODE_MAP: Readonly<Record<string, ErrorCode>> = {
  FST_ERR_CTP_BODY_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  FST_REQ_FILE_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  FST_PARTS_LIMIT: 'PAYLOAD_TOO_LARGE',
  FST_FILES_LIMIT: 'PAYLOAD_TOO_LARGE',
  FST_FIELDS_LIMIT: 'PAYLOAD_TOO_LARGE',
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: 'BAD_REQUEST',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'VALIDATION_FAILED',
  FST_ERR_CTP_INVALID_JSON_BODY: 'VALIDATION_FAILED',
  FST_INVALID_MULTIPART_CONTENT_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  FST_ERR_NOT_FOUND: 'NOT_FOUND',
};

const STATUS_MAP: Readonly<Record<number, ErrorCode>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'BAD_REQUEST',
  406: 'UNSUPPORTED_MEDIA_TYPE',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
};

function generic(code: ErrorCode, logAsError = false): MappedError {
  return { code, message: errorMessage(code), logAsError };
}

export function mapError(error: unknown): MappedError {
  if (isAppError(error)) {
    const serverError = error.statusCode >= 500;
    const mapped: MappedError = {
      code: error.code,
      // 5xx never expose developer messages; 4xx messages are written for clients.
      message: serverError ? errorMessage(error.code) : error.message,
      headers: error.headers,
      logAsError: serverError,
    };
    if (error.details !== undefined && !serverError) mapped.details = error.details;
    return mapped;
  }

  if (hasZodFastifySchemaValidationErrors(error)) {
    return { ...generic('VALIDATION_FAILED'), details: validationDetails(error as unknown as FastifyError) };
  }
  if (error instanceof ResponseSerializationError) {
    // Response schema mismatch: a bug, never the client's fault.
    return generic('INTERNAL_ERROR', true);
  }

  // Database safety nets for errors a service forgot to map.
  if (isUniqueViolation(error)) return generic('CONFLICT');
  if (isForbiddenOperation(error)) return generic('INVALID_STATE');

  if (typeof error === 'object' && error !== null) {
    const fastifyError = error as Partial<FastifyError>;
    if (Array.isArray(fastifyError.validation) && fastifyError.validation.length > 0) {
      return { ...generic('VALIDATION_FAILED'), details: validationDetails(fastifyError as FastifyError) };
    }
    const byCode = typeof fastifyError.code === 'string' ? FASTIFY_CODE_MAP[fastifyError.code] : undefined;
    if (byCode !== undefined) return generic(byCode);
    const status = fastifyError.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return generic(STATUS_MAP[status] ?? 'BAD_REQUEST');
    }
  }
  return generic('INTERNAL_ERROR', true);
}

/** Sends the error body for `code` (used by hooks that answer early). */
export function sendError(
  reply: FastifyReply,
  request: FastifyRequest,
  code: ErrorCode,
  options: { message?: string; details?: ErrorDetails } = {},
): FastifyReply {
  return reply.code(errorStatus(code)).type('application/json; charset=utf-8').send(buildErrorResponse(code, request.id, options));
}

export function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, request, reply) => {
    const mapped = mapError(error);
    const status = errorStatus(mapped.code);
    if (mapped.logAsError) {
      request.log.error({ err: error, error_code: mapped.code }, 'request failed');
    } else {
      request.log.info({ error_code: mapped.code, status_code: status }, 'request rejected');
    }
    if (mapped.headers !== undefined) {
      for (const [name, value] of Object.entries(mapped.headers)) reply.header(name, value);
    }
    const options: { message: string; details?: ErrorDetails } = { message: mapped.message };
    if (mapped.details !== undefined) options.details = mapped.details;
    return reply
      .code(status)
      .type('application/json; charset=utf-8')
      .send(buildErrorResponse(mapped.code, request.id, options));
  });

  const notFoundHandler = (request: FastifyRequest, reply: FastifyReply): FastifyReply =>
    sendError(reply, request, 'NOT_FOUND');
  if (app.hasDecorator('rateLimit')) {
    // Rate-limit 404s like any route to slow down endpoint enumeration.
    app.setNotFoundHandler({ preHandler: app.rateLimit() }, notFoundHandler);
  } else {
    app.setNotFoundHandler(notFoundHandler);
  }
}

export { AppError };
