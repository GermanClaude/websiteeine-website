import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

import { permissionsForRole, type AuthSessionResponse, type MeResponse, type UserRole } from '@scpsl-trust/shared';

import { AuthProvider } from '../src/auth/AuthProvider';
import { ThemeProvider } from '../src/components/ThemeProvider';
import { ToastProvider } from '../src/components/Toasts';

export const USER_ID = '6f1c2f3a-7a3b-4d3e-9a1b-2c3d4e5f6a7b';
export const SESSION_ID = '0b9d8c7e-6f5a-4b3c-8d2e-1f0a9b8c7d6e';

export function fakeSession(role: UserRole = 'player', overrides: Partial<AuthSessionResponse> = {}): AuthSessionResponse {
  return {
    user: {
      id: USER_ID,
      email: 'user@example.org',
      username: 'testuser',
      role,
      status: 'active',
      email_verified: true,
      mfa_enabled: false,
    },
    session: {
      id: SESSION_ID,
      created_at: '2026-09-29T10:00:00.000Z',
      expires_at: '2026-10-06T10:00:00.000Z',
      idle_expires_at: '2026-09-29T22:00:00.000Z',
      mfa_verified: false,
    },
    permissions: [...permissionsForRole(role)],
    csrf_token: 'csrf-token-1',
    mfa_enrollment_required: false,
    ...overrides,
  };
}

export function fakeMe(role: UserRole = 'player', overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    user: {
      id: USER_ID,
      email: 'user@example.org',
      username: 'testuser',
      role,
      status: 'active',
      email_verified: true,
      mfa_enabled: false,
      reviewer_number: null,
      created_at: '2026-01-01T00:00:00.000Z',
      last_login_at: '2026-09-29T10:00:00.000Z',
    },
    permissions: [...permissionsForRole(role)],
    mfa_enrollment_required: false,
    linked_player: null,
    servers: [],
    ...overrides,
  };
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-test', ...headers },
  });
}

export function errorResponse(status: number, code: string, message: string, details?: unknown): Response {
  return jsonResponse(status, { error: { code, message, details, request_id: 'req-err-1' } });
}

export interface RecordedCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export type FetchRoute = (call: RecordedCall) => Response | Promise<Response> | undefined;

/** Installs a fetch mock; the handler receives normalized calls and returns a Response (or undefined → 404). */
export function mockFetch(handler: FetchRoute): { calls: RecordedCall[]; restore: () => void } {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders instanceof Headers) rawHeaders.forEach((value, key) => (headers[key.toLowerCase()] = value));
    else if (Array.isArray(rawHeaders)) for (const [key, value] of rawHeaders) headers[key.toLowerCase()] = value;
    else if (rawHeaders !== undefined) for (const [key, value] of Object.entries(rawHeaders)) headers[key.toLowerCase()] = value;
    let body: unknown;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: RecordedCall = { method: (init?.method ?? 'GET').toUpperCase(), url, headers, body };
    calls.push(call);
    const response = await handler(call);
    return response ?? errorResponse(404, 'NOT_FOUND', 'Resource not found');
  });
  const original = globalThis.fetch;
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

export interface RenderOptions {
  route?: string;
  queryClient?: QueryClient;
}

/** Renders inside QueryClient + Theme + Toast + Auth providers and a memory router. */
export function renderWithProviders(ui: ReactElement, { route = '/', queryClient = createTestQueryClient() }: RenderOptions = {}): RenderResult {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
  return render(ui, { wrapper });
}
