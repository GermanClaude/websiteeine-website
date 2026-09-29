/**
 * /me endpoints (ARCHITECTURE §6.6, §13).
 */
import {
  MeResponseSchema,
  OkResponseSchema,
  PlayerLinkCodeResponseSchema,
  type MeResponse,
  type OkResponse,
  type PlayerLinkCodeResponse,
} from '@scpsl-trust/shared';

import { api } from './client';

export function getMe(): Promise<MeResponse> {
  return api.get<MeResponse>('/me', { schema: MeResponseSchema });
}

/** Creates (or replaces) the one active in-game link code of the user. */
export function createPlayerLinkCode(): Promise<PlayerLinkCodeResponse> {
  return api.post<PlayerLinkCodeResponse>('/me/player-link', undefined, { schema: PlayerLinkCodeResponseSchema });
}

export function unlinkPlayer(): Promise<OkResponse> {
  return api.delete<OkResponse>('/me/player-link', { schema: OkResponseSchema });
}
