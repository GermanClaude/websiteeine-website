/**
 * Spec compliance (REQUIREMENTS §16 "an appeal should not be decided solely by the same reviewer",
 * ARCHITECTURE §11.2/§11.5 independence): a staff member whose linked in-game identity IS the case
 * subject must not be able to decide the verdict of, or the appeal on, their own case.
 *
 * Both failed against the original implementation (review findings SPEC-1/SPEC-2) and now
 * guard the self-dealing conflict rule.
 */
import { describe, expect, it } from 'vitest';

import { allocateCaseNumber } from '../../src/db';
import { createPlayer, createUser, loginAs, useTestApp } from '../helpers';

const t = useTestApp({ now: '2026-09-29T12:00:00.000Z' });

async function makeCase(playerId: string, verdict: 'unknown' | 'confirmed', verdictSetBy: string | null) {
  const deps = t().deps;
  const now = deps.clock.now();
  const caseNumber = await allocateCaseNumber(deps.db, now.getUTCFullYear());
  const closed = verdict === 'confirmed';
  return deps.db
    .insertInto('cases')
    .values({
      case_number: caseNumber,
      player_id: playerId,
      reason: 'self review spec test',
      status: closed ? 'closed' : 'under_review',
      current_verdict: verdict,
      verdict_set_by: verdictSetBy,
      verdict_set_at: closed ? now : null,
      closed_at: closed ? now : null,
      created_at: now,
      updated_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

describe('case subject cannot judge their own case', () => {
  it('a reviewer cannot set the verdict on a case about their own linked player', async () => {
    const player = await createPlayer(t().deps);
    const { user } = await createUser(t().deps, { role: 'reviewer', totp: true, playerId: player.id });
    const session = await loginAs(t().app, user);
    const c = await makeCase(player.id, 'unknown', null);
    const res = await t().app.inject({
      method: 'POST',
      url: `/api/v1/cases/${c.case_number}/verdict`,
      headers: session.headers,
      body: { verdict: 'rejected', comment: 'I am innocent, closing my own case' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('a reviewer cannot decide (reverse) their own appeal', async () => {
    const player = await createPlayer(t().deps);
    const { user: original } = await createUser(t().deps, { role: 'reviewer', totp: true });
    const { user } = await createUser(t().deps, { role: 'reviewer', totp: true, playerId: player.id });
    const session = await loginAs(t().app, user);
    const c = await makeCase(player.id, 'confirmed', original.id);

    const created = await t().app.inject({
      method: 'POST',
      url: '/api/v1/appeals',
      headers: session.headers,
      body: { case_id: c.case_number, statement: 'This verdict about me is wrong, please reverse it.' },
    });
    expect(created.statusCode).toBe(201);
    const appealId = created.json().id as string;

    const decided = await t().app.inject({
      method: 'POST',
      url: `/api/v1/appeals/${appealId}/decision`,
      headers: session.headers,
      body: { decision: 'reverse', reason: 'I reviewed my own appeal and reverse it.' },
    });
    expect(decided.statusCode).toBe(409);
    const after = await t().db.selectFrom('cases').select('current_verdict').where('id', '=', c.id).executeTakeFirstOrThrow();
    expect(after.current_verdict).toBe('confirmed');
  });
});
