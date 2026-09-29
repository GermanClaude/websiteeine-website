/**
 * Public (no session) endpoints: `GET /public/cases/{caseNumber}` (ARCHITECTURE §13 "Cases").
 */
import { CasePublicViewSchema, type CasePublicView } from '@scpsl-trust/shared';

import { api } from './client';
import { createQueryKeys } from './keys';

export const publicKeys = createQueryKeys('public');

/** Limited public view; 404 when unknown or when `PUBLIC_CASE_LOOKUP` is disabled. */
export function getPublicCase(caseNumber: string): Promise<CasePublicView> {
  return api.get<CasePublicView>(`/public/cases/${encodeURIComponent(caseNumber)}`, { schema: CasePublicViewSchema });
}
