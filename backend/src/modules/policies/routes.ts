/**
 * Web policy routes (§13 "Servers", §7):
 *   GET  /servers/{id}/policy          — active policy (members; server:manage_any override)
 *   PUT  /servers/{id}/policy          — save new version (owner/admin or server:manage_any)
 *   GET  /servers/{id}/policy/history  — version list, newest first (paginated)
 *   POST /servers/{id}/policy/preview  — evaluate a sample input (pure, no side effects)
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  evaluatePolicy,
  paginated,
  PaginationQuerySchema,
  Permission,
  PolicyPreviewRequestSchema,
  PolicyPreviewResponseSchema,
  ServerParamsSchema,
  ServerPolicyUpdateRequestSchema,
  ServerPolicyViewSchema,
  type ServerMemberRole,
  type UserRef,
} from '@scpsl-trust/shared';

import { requireServerRole } from '../../auth/rbac';
import type { Deps } from '../../container';
import { paginatedResult } from '../../lib/pagination';
import { toOffset } from '../../lib/pagination';
import { auditContext } from '../audit';
import { findRulesForPolicies, findUserRefs, listPolicyVersions } from './repository';
import { getActivePolicy, savePolicy, toServerPolicyDto, toServerPolicyView } from './service';

const MEMBER_ROLES: readonly ServerMemberRole[] = ['owner', 'admin', 'moderator'];

const PolicyHistoryResponseSchema = paginated(ServerPolicyViewSchema);

export async function registerPolicyRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const memberAccess = requireServerRole(deps.db, {
    roles: MEMBER_ROLES,
    allowPermission: Permission.SERVER_MANAGE_ANY,
  });
  const policyManage = requireServerRole(deps.db, { action: 'policy' });

  async function creatorRef(userId: string | null): Promise<UserRef | null> {
    if (userId === null) return null;
    const refs = await findUserRefs(deps.db, [userId]);
    return refs.get(userId) ?? null;
  }

  r.get(
    '/servers/:id/policy',
    {
      schema: {
        tags: ['policies'],
        summary: 'Active policy of a server',
        params: ServerParamsSchema,
        response: { 200: ServerPolicyViewSchema },
      },
      preHandler: [memberAccess],
    },
    async (request) => {
      const access = request.serverAccess!;
      const data = await getActivePolicy(deps, access.server.id);
      return toServerPolicyView(data, access.server.server_id, await creatorRef(data.policy.created_by));
    },
  );

  r.put(
    '/servers/:id/policy',
    {
      schema: {
        tags: ['policies'],
        summary: 'Save a new policy version',
        params: ServerParamsSchema,
        body: ServerPolicyUpdateRequestSchema,
        response: { 200: ServerPolicyViewSchema },
      },
      preHandler: [policyManage],
    },
    async (request) => {
      const access = request.serverAccess!;
      const data = await savePolicy(deps, access.server.id, request.body, auditContext(request));
      return toServerPolicyView(data, access.server.server_id, await creatorRef(data.policy.created_by));
    },
  );

  r.get(
    '/servers/:id/policy/history',
    {
      schema: {
        tags: ['policies'],
        summary: 'Policy version history (newest first)',
        params: ServerParamsSchema,
        querystring: PaginationQuerySchema,
        response: { 200: PolicyHistoryResponseSchema },
      },
      preHandler: [memberAccess],
    },
    async (request) => {
      const access = request.serverAccess!;
      const { limit, offset } = toOffset(request.query);
      const { policies, total } = await listPolicyVersions(deps.db, access.server.id, { limit, offset });
      const rules = await findRulesForPolicies(
        deps.db,
        policies.map((p) => p.id),
      );
      const creators = await findUserRefs(
        deps.db,
        policies.flatMap((p) => (p.created_by !== null ? [p.created_by] : [])),
      );
      const items = policies.map((policy) =>
        toServerPolicyView(
          { policy, rules: rules.get(policy.id) ?? [] },
          access.server.server_id,
          policy.created_by !== null ? (creators.get(policy.created_by) ?? null) : null,
        ),
      );
      return paginatedResult(items, total, request.query);
    },
  );

  r.post(
    '/servers/:id/policy/preview',
    {
      schema: {
        tags: ['policies'],
        summary: 'Evaluate a sample player check against a policy (no side effects)',
        params: ServerParamsSchema,
        body: PolicyPreviewRequestSchema,
        response: { 200: PolicyPreviewResponseSchema },
      },
      preHandler: [memberAccess],
    },
    async (request) => {
      const access = request.serverAccess!;
      const { input, policy: draft } = request.body;
      const context = { server_name: access.server.name };
      if (draft !== undefined) {
        return { decision: evaluatePolicy(input, draft, context), policy_version: null };
      }
      const stored = await getActivePolicy(deps, access.server.id);
      const dto = toServerPolicyDto(stored);
      return { decision: evaluatePolicy(input, dto, context), policy_version: dto.version };
    },
  );
}
