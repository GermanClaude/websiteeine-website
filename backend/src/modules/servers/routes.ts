/**
 * Web server-management routes (§13 "Servers"). `{id}` is the public `srv_…` id.
 * Server-scoped actions are authorized by membership (requireServerRole), with the
 * `server:manage_any` override; only create/status/trust depend on the global role.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  KeyRevokeRequestSchema,
  KeyRotationRequestResponseSchema,
  OkResponseSchema,
  Permission,
  RegistrationTokenResponseSchema,
  ServerCreateRequestSchema,
  ServerCreateResponseSchema,
  ServerKeyListResponseSchema,
  ServerKeyParamsSchema,
  ServerListQuerySchema,
  ServerListResponseSchema,
  ServerMemberAddRequestSchema,
  ServerMemberListResponseSchema,
  ServerMemberParamsSchema,
  ServerMemberViewSchema,
  ServerParamsSchema,
  ServerStatusChangeRequestSchema,
  ServerTrustRequestSchema,
  ServerUpdateRequestSchema,
  ServerViewSchema,
  hasPermission,
  type ServerMemberRole,
} from '@scpsl-trust/shared';

import { assertAuthenticated, assertMfaEnrollment, requirePermission, requireServerRole } from '../../auth/rbac';
import type { Deps } from '../../container';
import { paginatedResult, toOffset } from '../../lib/pagination';
import { toIso } from '../../lib/time';
import { auditContext } from '../audit';
import { findServerViewRow, listKeys, listMembers, listServers } from './repository';
import {
  addMember,
  changeServerStatus,
  createServer,
  issueRegistrationToken,
  removeMember,
  requestKeyRotation,
  revokeServerKey,
  setServerTrust,
  toMemberView,
  toServerKeyView,
  toServerSummary,
  toServerView,
  updateServerSettings,
} from './service';

const MEMBER_ROLES: readonly ServerMemberRole[] = ['owner', 'admin', 'moderator'];

export async function registerServerWebRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const memberAccess = requireServerRole(deps.db, {
    roles: MEMBER_ROLES,
    allowPermission: Permission.SERVER_MANAGE_ANY,
  });
  const manageAccess = requireServerRole(deps.db, { action: 'manage' });

  r.get(
    '/servers',
    {
      schema: {
        tags: ['servers'],
        summary: 'List servers (own memberships; all with server:manage_any)',
        querystring: ServerListQuerySchema,
        response: { 200: ServerListResponseSchema },
      },
      preHandler: [
        async (request) => {
          assertAuthenticated(request);
          assertMfaEnrollment(request.session);
        },
      ],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      const { limit, offset } = toOffset(request.query);
      const { rows, total } = await listServers(deps.db, {
        userId: user.id,
        all: hasPermission(user.role, Permission.SERVER_MANAGE_ANY),
        query: request.query,
        limit,
        offset,
      });
      return paginatedResult(rows.map(toServerSummary), total, request.query);
    },
  );

  r.post(
    '/servers',
    {
      schema: {
        tags: ['servers'],
        summary: 'Create a server (returns the registration token once)',
        body: ServerCreateRequestSchema,
        response: { 201: ServerCreateResponseSchema },
      },
      preHandler: [requirePermission(Permission.SERVER_CREATE)],
    },
    async (request, reply) => {
      const user = assertAuthenticated(request);
      const created = await createServer(deps, user, request.body, auditContext(request));
      return reply.code(201).send({
        server: created.view,
        registration_token: created.registrationToken,
        registration_token_expires_at: toIso(created.registrationTokenExpiresAt),
      });
    },
  );

  r.get(
    '/servers/:id',
    {
      schema: {
        tags: ['servers'],
        summary: 'Server detail (§22 view)',
        params: ServerParamsSchema,
        response: { 200: ServerViewSchema },
      },
      preHandler: [memberAccess],
    },
    async (request) => {
      const access = request.serverAccess!;
      const row = await findServerViewRow(deps.db, access.server.id);
      return toServerView(row!, access.member_role);
    },
  );

  r.patch(
    '/servers/:id',
    {
      schema: {
        tags: ['servers'],
        summary: 'Update server settings',
        params: ServerParamsSchema,
        body: ServerUpdateRequestSchema,
        response: { 200: ServerViewSchema },
      },
      preHandler: [manageAccess],
    },
    async (request) => {
      const access = request.serverAccess!;
      return updateServerSettings(deps, access.server.id, access.member_role, request.body, auditContext(request));
    },
  );

  r.post(
    '/servers/:id/registration-token',
    {
      schema: {
        tags: ['servers'],
        summary: 'Issue a new registration token (revokes the previous unused one)',
        params: ServerParamsSchema,
        response: { 201: RegistrationTokenResponseSchema },
      },
      preHandler: [manageAccess],
    },
    async (request, reply) => {
      const user = assertAuthenticated(request);
      const access = request.serverAccess!;
      const { token, expiresAt } = await issueRegistrationToken(
        deps,
        access.server.id,
        access.server.server_id,
        user.id,
        auditContext(request),
      );
      return reply.code(201).send({ registration_token: token, expires_at: toIso(expiresAt) });
    },
  );

  r.get(
    '/servers/:id/keys',
    {
      schema: {
        tags: ['servers'],
        summary: 'List server keys (public keys only, never secrets)',
        params: ServerParamsSchema,
        response: { 200: ServerKeyListResponseSchema },
      },
      preHandler: [memberAccess],
    },
    async (request) => {
      const access = request.serverAccess!;
      const keys = await listKeys(deps.db, access.server.id);
      return { items: keys.map(toServerKeyView) };
    },
  );

  r.post(
    '/servers/:id/keys/:keyId/revoke',
    {
      schema: {
        tags: ['servers'],
        summary: 'Revoke a server key immediately',
        params: ServerKeyParamsSchema,
        body: KeyRevokeRequestSchema,
        response: { 200: OkResponseSchema },
      },
      preHandler: [manageAccess],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      const access = request.serverAccess!;
      await revokeServerKey(
        deps,
        access.server.id,
        access.server.server_id,
        request.params.keyId,
        request.body.reason,
        user.id,
        auditContext(request),
      );
      return { ok: true as const };
    },
  );

  r.post(
    '/servers/:id/keys/rotation-request',
    {
      schema: {
        tags: ['servers'],
        summary: 'Ask the plugin to rotate its key on the next heartbeat',
        params: ServerParamsSchema,
        response: { 200: KeyRotationRequestResponseSchema },
      },
      preHandler: [manageAccess],
    },
    async (request) => {
      const access = request.serverAccess!;
      const at = await requestKeyRotation(deps, access.server.id, access.server.server_id, auditContext(request));
      return { key_rotation_requested_at: toIso(at) };
    },
  );

  r.get(
    '/servers/:id/members',
    {
      schema: {
        tags: ['servers'],
        summary: 'List server team members',
        params: ServerParamsSchema,
        response: { 200: ServerMemberListResponseSchema },
      },
      preHandler: [memberAccess],
    },
    async (request) => {
      const access = request.serverAccess!;
      const members = await listMembers(deps.db, access.server.id);
      return { items: members.map(toMemberView) };
    },
  );

  r.post(
    '/servers/:id/members',
    {
      schema: {
        tags: ['servers'],
        summary: 'Add a member (existing user by username)',
        params: ServerParamsSchema,
        body: ServerMemberAddRequestSchema,
        response: { 201: ServerMemberViewSchema },
      },
      preHandler: [manageAccess],
    },
    async (request, reply) => {
      const user = assertAuthenticated(request);
      const access = request.serverAccess!;
      const member = await addMember(
        deps,
        access.server.id,
        access.server.server_id,
        request.body,
        { id: user.id, username: user.username },
        auditContext(request),
      );
      return reply.code(201).send(member);
    },
  );

  r.delete(
    '/servers/:id/members/:userId',
    {
      schema: {
        tags: ['servers'],
        summary: 'Remove a member (never the owner)',
        params: ServerMemberParamsSchema,
        response: { 200: OkResponseSchema },
      },
      preHandler: [manageAccess],
    },
    async (request) => {
      const access = request.serverAccess!;
      await removeMember(deps, access.server.id, access.server.server_id, request.params.userId, auditContext(request));
      return { ok: true as const };
    },
  );

  r.post(
    '/servers/:id/status',
    {
      schema: {
        tags: ['servers'],
        summary: 'Change server status (admin)',
        params: ServerParamsSchema,
        body: ServerStatusChangeRequestSchema,
        response: { 200: ServerViewSchema },
      },
      preHandler: [requirePermission(Permission.SERVER_MANAGE_ANY)],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      return changeServerStatus(deps, request.params.id, request.body, user.id, auditContext(request));
    },
  );

  r.post(
    '/servers/:id/trust',
    {
      schema: {
        tags: ['servers'],
        summary: 'Mark a server as trusted / untrusted (admin)',
        params: ServerParamsSchema,
        body: ServerTrustRequestSchema,
        response: { 200: ServerViewSchema },
      },
      preHandler: [requirePermission(Permission.SERVER_TRUST)],
    },
    async (request) => setServerTrust(deps, request.params.id, request.body, auditContext(request)),
  );
}
