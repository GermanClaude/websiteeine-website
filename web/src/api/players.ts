/**
 * Players (ARCHITECTURE §13 "Players"). The public view is served to everyone with a session,
 * the staff view (signals, links, sightings, bypasses — never raw IPs) with player:view_staff.
 */
import {
  PlayerSearchResponseSchema,
  PlayerViewResponseSchema,
  type PlayerSearchQuery,
  type PlayerSearchResponse,
  type PlayerViewResponse,
} from '@scpsl-trust/shared';

import { api } from './client';
import { createQueryKeys } from './keys';

export const playerKeys = createQueryKeys('players');

export function searchPlayers(query: Partial<PlayerSearchQuery>): Promise<PlayerSearchResponse> {
  return api.get<PlayerSearchResponse>('/players', { query, schema: PlayerSearchResponseSchema });
}

/** `userId` is the canonical `<id>@<type>`; the `@` is URL-encoded on the wire. */
export function getPlayer(userId: string): Promise<PlayerViewResponse> {
  return api.get<PlayerViewResponse>(`/players/${encodeURIComponent(userId)}`, { schema: PlayerViewResponseSchema });
}
