/**
 * Current user (/me, §6.6, §13) and admin user management (/admin/users).
 */
import { z } from 'zod';
import { LIMITS } from '../constants';
import { ServerMemberRoleSchema, UserRoleSchema, UserStatusSchema } from '../enums';
import { LINK_CODE_REGEX } from '../formats';
import { PermissionSchema } from '../permissions';
import {
  EmailSchema,
  IsoDateTimeSchema,
  optionalText,
  paginated,
  paginationQueryShape,
  PlayerSummarySchema,
  SearchQuerySchema,
  ServerIdSchema,
  UuidSchema,
} from './common';

export const LinkCodeSchema = z.string().regex(LINK_CODE_REGEX, 'Invalid link code');

export const MeServerMembershipSchema = z.object({
  server_id: ServerIdSchema,
  name: z.string(),
  role: ServerMemberRoleSchema,
});
export type MeServerMembership = z.infer<typeof MeServerMembershipSchema>;

/** GET /me — profile, permissions and linked in-game identity. */
export const MeResponseSchema = z.object({
  user: z.object({
    id: UuidSchema,
    email: EmailSchema,
    username: z.string(),
    role: UserRoleSchema,
    status: UserStatusSchema,
    email_verified: z.boolean(),
    mfa_enabled: z.boolean(),
    reviewer_number: z.number().int().positive().nullable(),
    created_at: IsoDateTimeSchema,
    last_login_at: IsoDateTimeSchema.nullable(),
  }),
  permissions: z.array(PermissionSchema),
  mfa_enrollment_required: z.boolean(),
  linked_player: PlayerSummarySchema.nullable(),
  servers: z.array(MeServerMembershipSchema),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/** POST /me/player-link — one active code per user, 10 minutes. */
export const PlayerLinkCodeResponseSchema = z.object({
  code: LinkCodeSchema,
  expires_at: IsoDateTimeSchema,
});
export type PlayerLinkCodeResponse = z.infer<typeof PlayerLinkCodeResponseSchema>;

// ---------------------------------------------------------------------------
// Admin users
// ---------------------------------------------------------------------------

export const AdminUserListQuerySchema = z.object({
  ...paginationQueryShape,
  q: SearchQuerySchema.optional(),
  role: UserRoleSchema.optional(),
  status: UserStatusSchema.optional(),
});
export type AdminUserListQuery = z.infer<typeof AdminUserListQuerySchema>;

export const AdminUserSchema = z.object({
  id: UuidSchema,
  email: EmailSchema,
  username: z.string(),
  role: UserRoleSchema,
  status: UserStatusSchema,
  email_verified_at: IsoDateTimeSchema.nullable(),
  mfa_enabled: z.boolean(),
  reviewer_number: z.number().int().positive().nullable(),
  locked_until: IsoDateTimeSchema.nullable(),
  last_login_at: IsoDateTimeSchema.nullable(),
  created_at: IsoDateTimeSchema,
  linked_player: PlayerSummarySchema.nullable(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

export const AdminUserListResponseSchema = paginated(AdminUserSchema);
export type AdminUserListResponse = z.infer<typeof AdminUserListResponseSchema>;

/** PATCH /admin/users/{id} — user:manage (roles ≤ moderator) / user:manage_admins. */
export const AdminUserUpdateRequestSchema = z
  .object({
    role: UserRoleSchema.optional(),
    status: UserStatusSchema.optional(),
    reason: optionalText(LIMITS.REVOKE_REASON_MAX),
  })
  .refine((body) => body.role !== undefined || body.status !== undefined, {
    message: 'At least one of role or status is required',
    path: ['role'],
  });
export type AdminUserUpdateRequest = z.infer<typeof AdminUserUpdateRequestSchema>;

export const AdminUserParamsSchema = z.object({ id: UuidSchema });
export type AdminUserParams = z.infer<typeof AdminUserParamsSchema>;
