/**
 * Typed fetch wrapper for the web API (ARCHITECTURE §2.1, §12.1).
 *
 * - base path `/api/v1`, cookies included, JSON in/out
 * - `X-CSRF-Token` on every non-GET request; the token is kept in memory (from login /
 *   `GET /auth/session` responses), fetched lazily when missing and refreshed once after a
 *   `403 CSRF_TOKEN_INVALID`
 * - every `401` resets the auth state through `authEvents`
 * - optional zod validation of responses in development (diagnostic only)
 * - multipart upload helper with progress (XMLHttpRequest)
 */
import {
  API_PREFIX,
  CSRF_HEADER,
  ErrorCode,
  ErrorResponseSchema,
  REQUEST_ID_HEADER_LOWER,
  type ErrorDetails,
  type ValidationIssue,
} from '@scpsl-trust/shared';
import type { z } from 'zod';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface ApiErrorInit {
  status: number;
  code: string;
  message: string;
  details?: ErrorDetails | undefined;
  requestId?: string | null | undefined;
}

/** Error thrown for every non-2xx response and for network failures (status 0). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ErrorDetails | undefined;
  readonly requestId: string | null;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId ?? null;
  }

  static is(error: unknown): error is ApiError {
    return error instanceof ApiError;
  }

  /** Validation issues (`details` as an array), empty otherwise. */
  get validationIssues(): ValidationIssue[] {
    return Array.isArray(this.details) ? this.details : [];
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

export const NETWORK_ERROR_CODE = 'NETWORK_ERROR';
export const UNEXPECTED_RESPONSE_CODE = 'UNEXPECTED_RESPONSE';

/** Human-readable message for any thrown value. */
export function getErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (ApiError.is(error)) return error.message || fallback;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

// ---------------------------------------------------------------------------
// Auth events (401 → reset auth state)
// ---------------------------------------------------------------------------

type Listener = () => void;
const unauthenticatedListeners = new Set<Listener>();

export const authEvents = {
  /** Subscribe to "the session is gone" events. Returns the unsubscribe function. */
  onUnauthenticated(listener: Listener): () => void {
    unauthenticatedListeners.add(listener);
    return () => {
      unauthenticatedListeners.delete(listener);
    };
  },
  emitUnauthenticated(): void {
    for (const listener of [...unauthenticatedListeners]) listener();
  },
};

// ---------------------------------------------------------------------------
// CSRF token store
// ---------------------------------------------------------------------------

let csrfToken: string | null = null;
/** True once `GET /auth/session` answered 401: skip refresh attempts until a login sets a token. */
let sessionKnownAbsent = false;
let refreshInFlight: Promise<string | null> | null = null;

export function getCsrfToken(): string | null {
  return csrfToken;
}

/** Store the token from a login / session response. `null` clears it. */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
  sessionKnownAbsent = token === null;
}

export function clearCsrfToken(): void {
  setCsrfToken(null);
}

/** Test helper: forget everything the client remembers about the session. */
export function resetClientState(): void {
  csrfToken = null;
  sessionKnownAbsent = false;
  refreshInFlight = null;
}

function readCsrfFromSessionBody(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const token = (body as { csrf_token?: unknown }).csrf_token;
  return typeof token === 'string' && token.length > 0 ? token : null;
}

/** Fetch `GET /auth/session` to (re)load the CSRF token. Shares one in-flight request. */
async function refreshCsrfToken(): Promise<string | null> {
  if (refreshInFlight !== null) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${API_PREFIX}/auth/session`, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        if (response.status === 401) sessionKnownAbsent = true;
        return null;
      }
      const token = readCsrfFromSessionBody(await parseBody(response));
      if (token !== null) setCsrfToken(token);
      return token;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function ensureCsrfToken(force = false): Promise<string | null> {
  if (!force) {
    if (csrfToken !== null) return csrfToken;
    if (sessionKnownAbsent) return null;
  }
  return refreshCsrfToken();
}

// ---------------------------------------------------------------------------
// Query strings
// ---------------------------------------------------------------------------

export type QueryValue = string | number | boolean | null | undefined | ReadonlyArray<string | number | boolean>;
export type QueryParams = Record<string, QueryValue>;

/** `{ a: 1, b: undefined, c: ['x','y'] }` → `?a=1&c=x&c=y`; empty values are skipped. */
export function buildQueryString(params?: QueryParams): string {
  if (params === undefined) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value as ReadonlyArray<string | number | boolean>) search.append(key, String(item));
    } else {
      search.append(key, String(value));
    }
  }
  const query = search.toString();
  return query.length > 0 ? `?${query}` : '';
}

// ---------------------------------------------------------------------------
// Core request
// ---------------------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions<T> {
  query?: QueryParams;
  /** JSON body (ignored for GET). */
  body?: unknown;
  /** Response schema — validated in development only (warnings, never throws). */
  schema?: z.ZodType<T>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

const SAFE_METHODS: ReadonlySet<HttpMethod> = new Set<HttpMethod>(['GET']);

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  if (text.length === 0) return undefined;
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  // Some servers omit the content type; try JSON anyway.
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function toApiError(response: Response, body: unknown): ApiError {
  const requestId = response.headers.get(REQUEST_ID_HEADER_LOWER);
  const parsed = ErrorResponseSchema.safeParse(body);
  if (parsed.success) {
    const { error } = parsed.data;
    return new ApiError({
      status: response.status,
      code: error.code,
      message: error.message,
      details: error.details,
      requestId: error.request_id || requestId,
    });
  }
  return new ApiError({
    status: response.status,
    code: `HTTP_${response.status}`,
    message: response.statusText || `Request failed with status ${response.status}`,
    requestId,
  });
}

function validateInDev<T>(schema: z.ZodType<T> | undefined, data: unknown, method: string, path: string): void {
  if (!import.meta.env.DEV || schema === undefined) return;
  const result = schema.safeParse(data);
  if (!result.success) {
    console.warn(`[api] ${method} ${path}: response does not match the shared schema`, result.error.issues);
  }
}

/** Low-level request. Prefer the `api.*` helpers. */
export async function request<T = unknown>(method: HttpMethod, path: string, options: RequestOptions<T> = {}): Promise<T> {
  const url = `${API_PREFIX}${path}${buildQueryString(options.query)}`;
  const isSafe = SAFE_METHODS.has(method);

  const execute = async (csrf: string | null): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
    if (!isSafe && options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (!isSafe && csrf !== null) headers[CSRF_HEADER] = csrf;
    const init: RequestInit = { method, credentials: 'include', headers };
    if (!isSafe && options.body !== undefined) init.body = JSON.stringify(options.body);
    if (options.signal !== undefined) init.signal = options.signal;
    try {
      return await fetch(url, init);
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new ApiError({ status: 0, code: NETWORK_ERROR_CODE, message: 'Could not reach the server' });
    }
  };

  let response = await execute(isSafe ? null : await ensureCsrfToken());
  let body = await parseBody(response);

  // One retry with a freshly loaded token after a CSRF failure.
  if (!isSafe && response.status === 403 && isErrorCode(body, ErrorCode.CSRF_TOKEN_INVALID)) {
    const fresh = await ensureCsrfToken(true);
    if (fresh !== null) {
      response = await execute(fresh);
      body = await parseBody(response);
    }
  }

  if (response.status === 401) {
    clearCsrfToken();
    authEvents.emitUnauthenticated();
  }

  if (!response.ok) throw toApiError(response, body);

  validateInDev(options.schema, body, method, path);
  return body as T;
}

function isErrorCode(body: unknown, code: string): boolean {
  const parsed = ErrorResponseSchema.safeParse(body);
  return parsed.success && parsed.data.error.code === code;
}

export const api = {
  get<T>(path: string, options: Omit<RequestOptions<T>, 'body'> = {}): Promise<T> {
    return request<T>('GET', path, options);
  },
  post<T>(path: string, body?: unknown, options: Omit<RequestOptions<T>, 'body'> = {}): Promise<T> {
    return request<T>('POST', path, { ...options, body });
  },
  put<T>(path: string, body?: unknown, options: Omit<RequestOptions<T>, 'body'> = {}): Promise<T> {
    return request<T>('PUT', path, { ...options, body });
  },
  patch<T>(path: string, body?: unknown, options: Omit<RequestOptions<T>, 'body'> = {}): Promise<T> {
    return request<T>('PATCH', path, { ...options, body });
  },
  delete<T>(path: string, options: RequestOptions<T> = {}): Promise<T> {
    return request<T>('DELETE', path, options);
  },
};

// ---------------------------------------------------------------------------
// Multipart upload with progress
// ---------------------------------------------------------------------------

export interface UploadProgress {
  loaded: number;
  /** Null when the browser cannot compute the total. */
  total: number | null;
  /** 0–1, null when the total is unknown. */
  fraction: number | null;
}

export interface UploadOptions<T> {
  method?: 'POST' | 'PUT';
  onProgress?: (progress: UploadProgress) => void;
  schema?: z.ZodType<T>;
  signal?: AbortSignal;
  query?: QueryParams;
}

/** Upload a `FormData` body (evidence files) and parse the JSON response like `request`. */
export function uploadMultipart<T = unknown>(path: string, form: FormData, options: UploadOptions<T> = {}): Promise<T> {
  const method = options.method ?? 'POST';
  const url = `${API_PREFIX}${path}${buildQueryString(options.query)}`;

  const attempt = (csrf: string | null, retried: boolean): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.withCredentials = true;
      xhr.responseType = 'text';
      xhr.setRequestHeader('Accept', 'application/json');
      if (csrf !== null) xhr.setRequestHeader(CSRF_HEADER, csrf);

      const onAbort = () => {
        xhr.abort();
      };
      if (options.signal !== undefined) {
        if (options.signal.aborted) {
          reject(new DOMException('The upload was aborted', 'AbortError'));
          return;
        }
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
      const cleanup = () => {
        options.signal?.removeEventListener('abort', onAbort);
      };

      xhr.upload.onprogress = (event: ProgressEvent) => {
        if (options.onProgress === undefined) return;
        const total = event.lengthComputable ? event.total : null;
        options.onProgress({
          loaded: event.loaded,
          total,
          fraction: total !== null && total > 0 ? Math.min(1, event.loaded / total) : null,
        });
      };
      xhr.onerror = () => {
        cleanup();
        reject(new ApiError({ status: 0, code: NETWORK_ERROR_CODE, message: 'Could not reach the server' }));
      };
      xhr.onabort = () => {
        cleanup();
        reject(new DOMException('The upload was aborted', 'AbortError'));
      };
      xhr.onload = () => {
        cleanup();
        const text = typeof xhr.response === 'string' ? xhr.response : '';
        let body: unknown;
        try {
          body = text.length > 0 ? (JSON.parse(text) as unknown) : undefined;
        } catch {
          body = text;
        }
        const requestId = xhr.getResponseHeader(REQUEST_ID_HEADER_LOWER);

        if (xhr.status === 403 && !retried && isErrorCode(body, ErrorCode.CSRF_TOKEN_INVALID)) {
          void ensureCsrfToken(true).then((fresh) => {
            if (fresh === null) {
              reject(toXhrError(xhr.status, body, requestId));
              return;
            }
            attempt(fresh, true).then(resolve, reject);
          });
          return;
        }
        if (xhr.status === 401) {
          clearCsrfToken();
          authEvents.emitUnauthenticated();
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(toXhrError(xhr.status, body, requestId));
          return;
        }
        validateInDev(options.schema, body, method, path);
        resolve(body as T);
      };

      xhr.send(form);
    });

  return ensureCsrfToken().then((csrf) => attempt(csrf, false));
}

function toXhrError(status: number, body: unknown, requestId: string | null): ApiError {
  const parsed = ErrorResponseSchema.safeParse(body);
  if (parsed.success) {
    const { error } = parsed.data;
    return new ApiError({
      status,
      code: error.code,
      message: error.message,
      details: error.details,
      requestId: error.request_id || requestId,
    });
  }
  return new ApiError({ status, code: `HTTP_${status}`, message: `Request failed with status ${status}`, requestId });
}
