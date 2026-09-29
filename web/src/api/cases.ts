/**
 * Cases (ARCHITECTURE §11.1–§11.4, §13 "Cases").
 */
import {
  CaseListResponseSchema,
  CaseMutationResponseSchema,
  CaseStaffViewSchema,
  OkResponseSchema,
  ServerListResponseSchema,
  hasServerMemberRole,
  type CaseCommentRequest,
  type CaseConfirmationCreateRequest,
  type CaseConfirmationRevokeRequest,
  type CaseCreateRequest,
  type CaseListQuery,
  type CaseListResponse,
  type CaseMutationResponse,
  type CaseStaffView,
  type CaseVerdictRequest,
  type OkResponse,
  type ServerListResponse,
  type ServerSummary,
} from '@scpsl-trust/shared';

import { api } from './client';
import { createQueryKeys } from './keys';

export const caseKeys = {
  ...createQueryKeys('cases'),
  /** Servers the current user may confirm cases for (owner/admin membership, active). */
  confirmableServers: ['cases', 'confirmable-servers'] as const,
};

function casePathOf(caseNumber: string, suffix = ''): string {
  return `/cases/${encodeURIComponent(caseNumber)}${suffix}`;
}

export function listCases(query: Partial<CaseListQuery>): Promise<CaseListResponse> {
  return api.get<CaseListResponse>('/cases', { query, schema: CaseListResponseSchema });
}

/** Staff view (case:view_staff; server teams only for cases of their servers). 403 → use the public view. */
export function getCase(caseNumber: string): Promise<CaseStaffView> {
  return api.get<CaseStaffView>(casePathOf(caseNumber), { schema: CaseStaffViewSchema });
}

export function createCase(body: CaseCreateRequest): Promise<CaseMutationResponse> {
  return api.post<CaseMutationResponse>('/cases', body, { schema: CaseMutationResponseSchema });
}

export function startCaseReview(caseNumber: string, body: CaseCommentRequest): Promise<CaseMutationResponse> {
  return api.post<CaseMutationResponse>(casePathOf(caseNumber, '/reviews/start'), body, { schema: CaseMutationResponseSchema });
}

export function addCaseNote(caseNumber: string, body: CaseCommentRequest): Promise<CaseMutationResponse> {
  return api.post<CaseMutationResponse>(casePathOf(caseNumber, '/notes'), body, { schema: CaseMutationResponseSchema });
}

/** Requires a 2FA-verified session; `confirmed` needs verified authentic evidence (422 INSUFFICIENT_EVIDENCE). */
export function setCaseVerdict(caseNumber: string, body: CaseVerdictRequest): Promise<CaseMutationResponse> {
  return api.post<CaseMutationResponse>(casePathOf(caseNumber, '/verdict'), body, { schema: CaseMutationResponseSchema });
}

export function reopenCase(caseNumber: string, body: CaseCommentRequest): Promise<CaseMutationResponse> {
  return api.post<CaseMutationResponse>(casePathOf(caseNumber, '/reopen'), body, { schema: CaseMutationResponseSchema });
}

/** Caller must be owner/admin of that active server. Never changes the verdict. */
export function addCaseConfirmation(caseNumber: string, body: CaseConfirmationCreateRequest): Promise<CaseMutationResponse | undefined> {
  return api.post<CaseMutationResponse | undefined>(casePathOf(caseNumber, '/confirmations'), body);
}

/** Soft revoke (`revoked_at`); the row is kept. */
export function revokeCaseConfirmation(
  caseNumber: string,
  confirmationId: string,
  body: CaseConfirmationRevokeRequest,
): Promise<OkResponse | undefined> {
  return api.delete<OkResponse | undefined>(casePathOf(caseNumber, `/confirmations/${encodeURIComponent(confirmationId)}`), {
    body,
    schema: OkResponseSchema,
  });
}

/**
 * Servers the caller can confirm a case for: `GET /servers` (own memberships) filtered to
 * active servers with an owner/admin membership. `server:manage_any` does not grant
 * confirmations (they are statements of the server team itself).
 */
export async function listConfirmableServers(): Promise<ServerSummary[]> {
  const response = await api.get<ServerListResponse>('/servers', { query: { page_size: 100 }, schema: ServerListResponseSchema });
  return response.items.filter((server) => server.status === 'active' && hasServerMemberRole(server.member_role, 'confirm'));
}
