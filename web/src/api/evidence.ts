/**
 * Evidence (ARCHITECTURE §11.3, §12.1 tickets, §13 "Evidence").
 *
 * Uploads go through `uploadMultipart` (XMLHttpRequest with progress). The backend computes
 * the SHA-256 while streaming; the returned view carries it.
 */
import {
  API_PREFIX,
  EvidenceDetailSchema,
  EvidenceListResponseSchema,
  EvidenceReviewViewSchema,
  EvidenceTicketResponseSchema,
  EvidenceViewSchema,
  type EvidenceDetail,
  type EvidenceLinkCreateRequest,
  type EvidenceListQuery,
  type EvidenceListResponse,
  type EvidenceReviewRequest,
  type EvidenceReviewView,
  type EvidenceSupersedeFields,
  type EvidenceTicketResponse,
  type EvidenceUploadFields,
  type EvidenceView,
} from '@scpsl-trust/shared';

import { api, uploadMultipart, type UploadProgress } from './client';
import { createQueryKeys } from './keys';

export const evidenceKeys = {
  ...createQueryKeys('evidence'),
  /** `GET /evidence/{id}?verify=true` (integrity re-hash) is cached separately from the plain detail. */
  verified: (id: string) => ['evidence', 'detail', id, 'verify'] as const,
};

function evidencePath(id: string, suffix = ''): string {
  return `/evidence/${encodeURIComponent(id)}${suffix}`;
}

export function listEvidence(query: Partial<EvidenceListQuery>): Promise<EvidenceListResponse> {
  return api.get<EvidenceListResponse>('/evidence', { query, schema: EvidenceListResponseSchema });
}

/** Metadata + review history; `verify: true` (reviewer+) re-hashes the stored object and fills `integrity`. */
export function getEvidence(id: string, options: { verify?: boolean } = {}): Promise<EvidenceDetail> {
  return api.get<EvidenceDetail>(evidencePath(id), {
    query: options.verify === true ? { verify: 'true' } : undefined,
    schema: EvidenceDetailSchema,
  });
}

export interface UploadEvidenceInput {
  file: File;
  fields: EvidenceUploadFields;
}

function appendFields(form: FormData, fields: Record<string, string | null | undefined>): void {
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined || value === '') continue;
    form.append(key, value);
  }
}

/** `POST /cases/{caseNumber}/evidence` (multipart). The file field is appended last so the fields are parsed first. */
export function uploadEvidence(
  caseNumber: string,
  input: UploadEvidenceInput,
  onProgress?: (progress: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<EvidenceView> {
  const form = new FormData();
  appendFields(form, {
    type: input.fields.type,
    title: input.fields.title,
    description: input.fields.description,
    report_id: input.fields.report_id,
    overwatch_session_id: input.fields.overwatch_session_id,
  });
  form.append('file', input.file, input.file.name);
  return uploadMultipart<EvidenceView>(`/cases/${encodeURIComponent(caseNumber)}/evidence`, form, {
    onProgress,
    signal,
    schema: EvidenceViewSchema,
  });
}

/** `POST /cases/{caseNumber}/evidence/link` — https URLs only; no hash (nothing is stored). */
export function createLinkEvidence(caseNumber: string, body: EvidenceLinkCreateRequest): Promise<EvidenceView> {
  return api.post<EvidenceView>(`/cases/${encodeURIComponent(caseNumber)}/evidence/link`, body, { schema: EvidenceViewSchema });
}

export interface SupersedeEvidenceInput {
  file: File;
  fields: EvidenceSupersedeFields;
}

/** `POST /evidence/{id}/supersede` (multipart) → the NEW evidence object; the old one is kept and linked. */
export function supersedeEvidence(
  id: string,
  input: SupersedeEvidenceInput,
  onProgress?: (progress: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<EvidenceView> {
  const form = new FormData();
  appendFields(form, { title: input.fields.title, description: input.fields.description, reason: input.fields.reason });
  form.append('file', input.file, input.file.name);
  return uploadMultipart<EvidenceView>(evidencePath(id, '/supersede'), form, { onProgress, signal, schema: EvidenceViewSchema });
}

/** `POST /evidence/{id}/reviews` — three independent assessments + overall status. Never changes a verdict (R2). */
export function reviewEvidence(id: string, body: EvidenceReviewRequest): Promise<EvidenceReviewView | undefined> {
  return api.post<EvidenceReviewView | undefined>(evidencePath(id, '/reviews'), body, { schema: EvidenceReviewViewSchema });
}

/** Short-lived (60 s) ticket for `<video>`/`<img>`/download; issuing it is audited (EVIDENCE_ACCESSED). */
export function createEvidenceTicket(id: string): Promise<EvidenceTicketResponse> {
  return api.post<EvidenceTicketResponse>(evidencePath(id, '/ticket'), undefined, { schema: EvidenceTicketResponseSchema });
}

/** URL of the content endpoint for a ticket (uses the backend-provided URL when present). */
export function evidenceContentUrl(id: string, ticket: EvidenceTicketResponse): string {
  if (ticket.url.startsWith('/') || /^https?:\/\//i.test(ticket.url)) return ticket.url;
  return `${API_PREFIX}${evidencePath(id, '/content')}?ticket=${encodeURIComponent(ticket.ticket)}`;
}

/** Evidence types that the browser can preview inline. */
export function evidencePreviewKind(mimeType: string | null): 'image' | 'video' | null {
  if (mimeType === null) return null;
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return null;
}
