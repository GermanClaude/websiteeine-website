/**
 * Overwatch proof sessions (§10.1): plugin start/heartbeat/end and web views.
 * The session secret appears ONLY in the plugin's start response; web views never carry it.
 */
import { z } from 'zod';
import { OverwatchEndReasonSchema, OverwatchSessionStatusSchema, PluginOverwatchEndReasonSchema } from '../enums';
import { samePlayer } from '../identity';
import {
  OVERWATCH_MAX_INTERVAL_SECONDS,
  OVERWATCH_MIN_INTERVAL_SECONDS,
} from '../signing';
import {
  IsoDateTimeSchema,
  paginated,
  paginationQueryShape,
  PlayerRefSchema,
  PlayerSummarySchema,
  ServerIdSchema,
  ServerRefSchema,
  UserIdStringSchema,
  UuidSchema,
} from './common';

export const OverwatchSessionParamsSchema = z.object({ id: UuidSchema });
export type OverwatchSessionParams = z.infer<typeof OverwatchSessionParamsSchema>;

export const OverwatchIntervalSchema = z
  .number()
  .int()
  .min(OVERWATCH_MIN_INTERVAL_SECONDS)
  .max(OVERWATCH_MAX_INTERVAL_SECONDS);

/** Canonical padded base64 of exactly 32 bytes. */
export const SessionSecretB64Schema = z.string().regex(/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/, 'Invalid secret');

// ---------------------------------------------------------------------------
// Plugin (signed)
// ---------------------------------------------------------------------------

/** POST /overwatch/sessions. */
export const OverwatchSessionStartRequestSchema = z
  .object({
    server_id: ServerIdSchema.optional(),
    target_player: PlayerRefSchema,
    spectator: PlayerRefSchema,
    /** Must be within ±60 s of backend time, otherwise backend time is used. */
    started_at: IsoDateTimeSchema.nullish(),
  })
  .refine((body) => !samePlayer(body.target_player, body.spectator), {
    message: 'Spectator and target must differ',
    path: ['spectator'],
  });
export type OverwatchSessionStartRequest = z.infer<typeof OverwatchSessionStartRequestSchema>;

export const OverwatchSessionStartResponseSchema = z.object({
  session_id: UuidSchema,
  /** base64 32 bytes — returned only here. */
  secret: SessionSecretB64Schema,
  interval_seconds: OverwatchIntervalSchema,
  started_at: IsoDateTimeSchema,
  heartbeat_interval_seconds: z.number().int().min(1),
  server_time: IsoDateTimeSchema,
});
export type OverwatchSessionStartResponse = z.infer<typeof OverwatchSessionStartResponseSchema>;

/** POST /overwatch/sessions/{id}/heartbeat — body `{}`. */
export const OverwatchSessionHeartbeatRequestSchema = z.object({});
export type OverwatchSessionHeartbeatRequest = z.infer<typeof OverwatchSessionHeartbeatRequestSchema>;

export const OverwatchSessionHeartbeatResponseSchema = z.object({
  session_id: UuidSchema,
  status: OverwatchSessionStatusSchema,
  last_heartbeat_at: IsoDateTimeSchema,
  server_time: IsoDateTimeSchema,
});
export type OverwatchSessionHeartbeatResponse = z.infer<typeof OverwatchSessionHeartbeatResponseSchema>;

/** POST /overwatch/sessions/{id}/end. */
export const OverwatchSessionEndRequestSchema = z.object({
  reason: PluginOverwatchEndReasonSchema,
});
export type OverwatchSessionEndRequest = z.infer<typeof OverwatchSessionEndRequestSchema>;

export const OverwatchSessionEndResponseSchema = z.object({
  session_id: UuidSchema,
  status: OverwatchSessionStatusSchema,
  ended_at: IsoDateTimeSchema,
});
export type OverwatchSessionEndResponse = z.infer<typeof OverwatchSessionEndResponseSchema>;

// ---------------------------------------------------------------------------
// Web (overwatch:view) — no secret, ever
// ---------------------------------------------------------------------------

export const OverwatchSessionViewSchema = z.object({
  id: UuidSchema,
  server: ServerRefSchema,
  target: PlayerSummarySchema,
  spectator: PlayerSummarySchema,
  interval_seconds: OverwatchIntervalSchema,
  status: OverwatchSessionStatusSchema,
  started_at: IsoDateTimeSchema,
  ended_at: IsoDateTimeSchema.nullable(),
  last_heartbeat_at: IsoDateTimeSchema,
  /** ended_at | last_heartbeat_at + interval (expired) | null while active. */
  effective_end_at: IsoDateTimeSchema.nullable(),
  end_reason: OverwatchEndReasonSchema.nullable(),
  /** false once the secret was wiped by retention (proofs can no longer be verified). */
  proof_verifiable: z.boolean(),
  created_at: IsoDateTimeSchema,
});
export type OverwatchSessionView = z.infer<typeof OverwatchSessionViewSchema>;

export const OverwatchSessionListQuerySchema = z.object({
  ...paginationQueryShape,
  server_id: ServerIdSchema.optional(),
  target: UserIdStringSchema.optional(),
  spectator: UserIdStringSchema.optional(),
  status: OverwatchSessionStatusSchema.optional(),
  from: IsoDateTimeSchema.optional(),
  to: IsoDateTimeSchema.optional(),
});
export type OverwatchSessionListQuery = z.infer<typeof OverwatchSessionListQuerySchema>;

export const OverwatchSessionListResponseSchema = paginated(OverwatchSessionViewSchema);
export type OverwatchSessionListResponse = z.infer<typeof OverwatchSessionListResponseSchema>;
