/**
 * Administration endpoints (ARCHITECTURE §13 "Admin"): users and the audit log. Global
 * bypasses live in ./bypasses.ts.
 */
import {
  AdminUserListResponseSchema,
  AdminUserSchema,
  AuditListResponseSchema,
  AuditVerifyResponseSchema,
  type AdminUser,
  type AdminUserListQuery,
  type AdminUserListResponse,
  type AdminUserUpdateRequest,
  type AuditListQuery,
  type AuditListResponse,
  type AuditVerifyResponse,
} from '@scpsl-trust/shared';

import { api } from './client';
import { createQueryKeys } from './keys';

export const adminUserKeys = createQueryKeys('admin-users');
export const auditKeys = createQueryKeys('audit');

export function listUsers(query: Partial<AdminUserListQuery> = {}): Promise<AdminUserListResponse> {
  return api.get<AdminUserListResponse>('/admin/users', { query, schema: AdminUserListResponseSchema });
}

/** PATCH /admin/users/{id} — role changes limited by user:manage / user:manage_admins. */
export function updateUser(userId: string, body: AdminUserUpdateRequest): Promise<AdminUser> {
  return api.patch<AdminUser>(`/admin/users/${encodeURIComponent(userId)}`, body, { schema: AdminUserSchema });
}

export function listAuditEvents(query: Partial<AuditListQuery> = {}): Promise<AuditListResponse> {
  return api.get<AuditListResponse>('/admin/audit', { query, schema: AuditListResponseSchema });
}

/** Recomputes the hash chain (audit:verify); the check itself is audited. */
export function verifyAuditChain(): Promise<AuditVerifyResponse> {
  return api.get<AuditVerifyResponse>('/admin/audit/verify', { schema: AuditVerifyResponseSchema });
}
