/**
 * Server policy endpoints (ARCHITECTURE §7, §13): the active policy of a server, saving a new
 * version and previewing a decision. The backend never enforces — the SCP:SL server decides.
 */
import {
  PolicyPreviewResponseSchema,
  ServerPolicyViewSchema,
  type PolicyPreviewRequest,
  type PolicyPreviewResponse,
  type ServerPolicyUpdateRequestInput,
  type ServerPolicyView,
} from '@scpsl-trust/shared';

import { api } from './client';
import { createQueryKeys } from './keys';

export const policyKeys = createQueryKeys('policies');

const path = (serverId: string, suffix = ''): string => `/servers/${encodeURIComponent(serverId)}/policy${suffix}`;

/** Active policy of the server (web view with version metadata). */
export function getServerPolicy(serverId: string): Promise<ServerPolicyView> {
  return api.get<ServerPolicyView>(path(serverId), { schema: ServerPolicyViewSchema });
}

/** Saves a new policy version (audit POLICY_UPDATED); returns the new active policy. */
export function updateServerPolicy(serverId: string, body: ServerPolicyUpdateRequestInput): Promise<ServerPolicyView> {
  return api.put<ServerPolicyView>(path(serverId), body, { schema: ServerPolicyViewSchema });
}

/** Evaluates a draft (or the stored policy) against a sample player check with the shared engine. */
export function previewServerPolicy(serverId: string, body: PolicyPreviewRequest): Promise<PolicyPreviewResponse> {
  return api.post<PolicyPreviewResponse>(path(serverId, '/preview'), body, { schema: PolicyPreviewResponseSchema });
}
