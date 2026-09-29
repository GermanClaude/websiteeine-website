/**
 * Assertions for the uniform error shape (ARCHITECTURE §2.1).
 */
import type { LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';

export interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
  request_id: string;
}

/**
 * Asserts status + error code, the `{ error: { code, message, request_id } }` shape, the
 * X-Request-Id echo and the absence of stack traces. Returns the error body.
 */
export function expectError(res: LightMyRequestResponse, status: number, code: string): ErrorBody {
  const text = res.body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Expected a JSON error body, got (${res.statusCode}): ${text.slice(0, 500)}`);
  }
  const body = parsed as { error?: ErrorBody };
  expect({ status: res.statusCode, code: body.error?.code }).toEqual({ status, code });
  expect(body.error).toBeDefined();
  const error = body.error as ErrorBody;
  expect(typeof error.message).toBe('string');
  expect(error.message.length).toBeGreaterThan(0);
  expect(typeof error.request_id).toBe('string');
  expect(res.headers['x-request-id']).toBe(error.request_id);
  expect(Object.keys(body)).toEqual(['error']);
  for (const key of Object.keys(error)) expect(['code', 'message', 'details', 'request_id']).toContain(key);
  // No stack traces or internal file paths.
  expect(text).not.toMatch(/\bat [\w.<>]+ \(|\.ts:\d+|\.js:\d+|node_modules/);
  return error;
}
