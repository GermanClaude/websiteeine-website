/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Web <-> backend contract (consistency review): every call in web/src/api/*.ts is listed
 * below with the shared zod schemas the web client uses for its body, query and response.
 * The test asserts that the backend registers the route and that the OpenAPI schemas the
 * backend derives from its own route schemas are identical (modulo docs-only keywords) to
 * the shared schemas the web validates against. Keep the list in sync with web/src/api.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as sh from '@scpsl-trust/shared';

import { useTestApp } from '../helpers';

type C = [string, string, string | null, string | null, string | null]; // method, path, body, query, response
const calls: C[] = [
 ['get','/admin/users',null,'AdminUserListQuery','AdminUserListResponse'],
 ['patch','/admin/users/{id}','AdminUserUpdateRequest',null,'AdminUser'],
 ['get','/admin/audit',null,'AuditListQuery','AuditListResponse'],
 ['get','/admin/audit/verify',null,null,'AuditVerifyResponse'],
 ['get','/appeals',null,'AppealListQuery','AppealListResponse'],
 ['get','/appeals/{id}',null,null,'AppealView'],
 ['post','/appeals','AppealCreateRequest',null,'AppealView'],
 ['post','/appeals/{id}/assign','AppealAssignRequest',null,'AppealView'],
 ['post','/appeals/{id}/decision','AppealDecisionRequest',null,'AppealView'],
 ['post','/appeals/{id}/withdraw',null,null,'AppealView'],
 ['get','/auth/session',null,null,'AuthSessionResponse'],
 ['post','/auth/login','LoginRequest',null,'LoginResponse'],
 ['post','/auth/login/2fa','Login2faRequest',null,'AuthSessionResponse'],
 ['post','/auth/logout',null,null,null],
 ['post','/auth/register','RegisterRequest',null,'RegisterResponse'],
 ['post','/auth/verify-email','VerifyEmailRequest',null,'OkResponse'],
 ['post','/auth/resend-verification','ResendVerificationRequest',null,null],
 ['post','/auth/password/forgot','PasswordForgotRequest',null,null],
 ['post','/auth/password/reset','PasswordResetRequest',null,'OkResponse'],
 ['post','/auth/password/change','PasswordChangeRequest',null,'OkResponse'],
 ['get','/auth/sessions',null,null,'SessionListResponse'],
 ['post','/auth/sessions/{id}/revoke',null,null,'OkResponse'],
 ['post','/auth/2fa/setup',null,null,'TwoFactorSetupResponse'],
 ['post','/auth/2fa/enable','TwoFactorEnableRequest',null,'RecoveryCodesResponse'],
 ['post','/auth/2fa/disable','TwoFactorDisableRequest',null,'OkResponse'],
 ['post','/auth/2fa/recovery-codes','RecoveryCodesRegenerateRequest',null,'RecoveryCodesResponse'],
 ['post','/bypasses/{id}/revoke','BypassRevokeRequest',null,'OkResponse'],
 ['get','/admin/bypasses',null,'BypassListQuery','BypassListResponse'],
 ['post','/admin/bypasses','BypassCreateRequest',null,'BypassView'],
 ['get','/cases',null,'CaseListQuery','CaseListResponse'],
 ['get','/cases/{caseNumber}',null,null,'CaseStaffView'],
 ['post','/cases','CaseCreateRequest',null,'CaseMutationResponse'],
 ['post','/cases/{caseNumber}/reviews/start','CaseCommentRequest',null,'CaseMutationResponse'],
 ['post','/cases/{caseNumber}/notes','CaseCommentRequest',null,'CaseMutationResponse'],
 ['post','/cases/{caseNumber}/verdict','CaseVerdictRequest',null,'CaseMutationResponse'],
 ['post','/cases/{caseNumber}/reopen','CaseCommentRequest',null,'CaseMutationResponse'],
 ['post','/cases/{caseNumber}/confirmations','CaseConfirmationCreateRequest',null,null],
 ['delete','/cases/{caseNumber}/confirmations/{id}','CaseConfirmationRevokeRequest',null,'OkResponse'],
 ['get','/servers',null,'ServerListQuery','ServerListResponse'],
 ['get','/dashboard',null,null,'DashboardResponse'],
 ['get','/evidence',null,'EvidenceListQuery','EvidenceListResponse'],
 ['get','/evidence/{id}',null,null,'EvidenceDetail'],
 ['post','/cases/{caseNumber}/evidence',null,null,'EvidenceView'],
 ['post','/cases/{caseNumber}/evidence/link','EvidenceLinkCreateRequest',null,'EvidenceView'],
 ['post','/evidence/{id}/supersede',null,null,'EvidenceView'],
 ['post','/evidence/{id}/reviews','EvidenceReviewRequest',null,'EvidenceReviewView'],
 ['post','/evidence/{id}/ticket',null,null,'EvidenceTicketResponse'],
 ['get','/me',null,null,'MeResponse'],
 ['post','/me/player-link',null,null,'PlayerLinkCodeResponse'],
 ['delete','/me/player-link',null,null,'OkResponse'],
 ['get','/overwatch/sessions',null,'OverwatchSessionListQuery','OverwatchSessionListResponse'],
 ['get','/overwatch/sessions/{id}',null,null,'OverwatchSessionView'],
 ['get','/players',null,'PlayerSearchQuery','PlayerSearchResponse'],
 ['get','/players/{userId}',null,null,'PlayerViewResponse'],
 ['get','/servers/{id}/policy',null,null,'ServerPolicyView'],
 ['put','/servers/{id}/policy','ServerPolicyUpdateRequest',null,'ServerPolicyView'],
 ['post','/servers/{id}/policy/preview','PolicyPreviewRequest',null,'PolicyPreviewResponse'],
 ['get','/evidence/proof',null,'ProofQuery','ProofResponse'],
 ['get','/public/cases/{caseNumber}',null,null,'CasePublicView'],
 ['get','/reports',null,'ReportListQuery','ReportListResponse'],
 ['get','/reports/{id}',null,null,'ReportView'],
 ['post','/reports','ReportCreateRequest',null,'ReportCreateResponse'],
 ['post','/reports/{id}/status','ReportStatusChangeRequest',null,'ReportView'],
 ['get','/servers/{id}',null,null,'ServerView'],
 ['post','/servers','ServerCreateRequest',null,'ServerCreateResponse'],
 ['patch','/servers/{id}','ServerUpdateRequest',null,'ServerView'],
 ['post','/servers/{id}/registration-token',null,null,'RegistrationTokenResponse'],
 ['post','/servers/{id}/status','ServerStatusChangeRequest',null,'ServerView'],
 ['post','/servers/{id}/trust','ServerTrustRequest',null,'ServerView'],
 ['get','/servers/{id}/keys',null,null,'ServerKeyListResponse'],
 ['post','/servers/{id}/keys/{keyId}/revoke','KeyRevokeRequest',null,'OkResponse'],
 ['post','/servers/{id}/keys/rotation-request',null,null,'KeyRotationRequestResponse'],
 ['get','/servers/{id}/members',null,null,'ServerMemberListResponse'],
 ['post','/servers/{id}/members','ServerMemberAddRequest',null,'ServerMemberView'],
 ['delete','/servers/{id}/members/{userId}',null,null,'OkResponse'],
 ['get','/servers/{id}/bypasses',null,'BypassListQuery','BypassListResponse'],
 ['post','/servers/{id}/bypasses','BypassCreateRequest',null,'BypassView'],
 ['get','/whitelist-requests',null,'WhitelistRequestListQuery','WhitelistRequestListResponse'],
 ['get','/whitelist-requests/{id}',null,null,'WhitelistRequestView'],
 ['post','/whitelist-requests','WhitelistRequestCreateRequest',null,'WhitelistRequestView'],
 ['post','/whitelist-requests/{id}/decision','WhitelistDecisionRequest',null,'WhitelistRequestView'],
 ['post','/whitelist-requests/{id}/revoke','WhitelistRevokeRequest',null,'WhitelistRequestView'],
];

/** Known, harmless differences (prefix match on the reported issue). */
const ALLOWED: Record<string, string[]> = {
  // backend answers with the login-success variant (extra `mfa_required: false`); web ignores it.
  'POST /auth/login/2fa': ['resp.properties.mfa_required', 'resp.required'],
  // backend accepts an absent/null body on DELETE; web always sends `{ reason }`.
  'DELETE /cases/{caseNumber}/confirmations/{id}': ['body.'],
};

const strip = (x: any): any => { if (Array.isArray(x)) return x.map(strip); if (x && typeof x === 'object') { const o: any = {}; for (const k of Object.keys(x).sort()) { if (k === 'const') { o.enum = [x[k]]; continue; } if (['$schema','description','pattern','format','default','title'].includes(k)) continue; o[k] = strip(x[k]); } return o; } return x; };
function diff(a: any, b: any, p: string, out: string[]) { if (out.length > 12) return; if (JSON.stringify(a) === JSON.stringify(b)) return; if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && typeof a[0] === 'object') { a.forEach((v: any, i: number) => diff(v, b[i], p + '[' + i + ']', out)); return; } if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)) { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], p + '.' + k, out); return; } out.push(`${p}: backend=${JSON.stringify(a)?.slice(0,160)} web=${JSON.stringify(b)?.slice(0,160)}`); }
const S = (n: string) => (sh as Record<string, unknown>)[n + 'Schema'] as z.ZodType | undefined;

const t = useTestApp();

describe('web API client <-> backend routes', () => {
  it('every web call matches a backend route with identical shared schemas', () => {
    const spec = t().app.swagger() as any;
    const failures: string[] = [];
    for (const [m, p, body, query, resp] of calls) {
  const op = spec.paths['/api/v1' + p]?.[m];
  if (!op) { failures.push(`MISSING ROUTE ${m.toUpperCase()} ${p}`); continue; }
  const issues: string[] = [];
  if (body) { const zs = S(body); if (!zs) issues.push('no shared schema ' + body); else { const be = op.requestBody?.content?.['application/json']?.schema; if (!be) issues.push('backend has no JSON body'); else diff(strip(be), strip(z.toJSONSchema(zs, { io: 'input', unrepresentable: 'any' })), 'body', issues); } }
  else if (op.requestBody?.required && m !== 'post') issues.push('backend requires body, web sends none');
  if (query) { const zs = S(query); const names = (op.parameters ?? []).filter((x: any) => x.in === 'query').map((x: any) => x.name).sort(); const js: any = zs ? z.toJSONSchema(zs, { io: 'input', unrepresentable: 'any' }) : {}; const wn = Object.keys(js.properties ?? {}).sort(); if (JSON.stringify(names) !== JSON.stringify(wn)) issues.push(`query backend=${names} web=${wn}`); }
  if (resp) { const zs = S(resp); const codes = Object.keys(op.responses ?? {}).filter((c) => c.startsWith('2')); const be = codes.map((c) => op.responses[c]?.content?.['application/json']?.schema).find(Boolean); if (!zs) issues.push('no shared schema ' + resp); else if (!be) issues.push(`backend has no JSON response (codes ${codes})`); else diff(strip(be), strip(z.toJSONSchema(zs, { io: 'output', unrepresentable: 'any' })), 'resp', issues); }
  const key = `${m.toUpperCase()} ${p}`; const rest = issues.filter((i) => !(ALLOWED[key] ?? []).some((a) => i.startsWith(a))); if (rest.length) failures.push(key + '\n  ' + rest.join('\n  '));
}

    expect(failures).toEqual([]);
  });
});
