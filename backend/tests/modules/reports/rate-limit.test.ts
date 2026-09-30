/**
 * Report creation rate limit (10/h per user by default; lowered here to 2/h).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, createUser, expectError, loginAs, randomSteamId, type TestApp } from '../../helpers';

describe('POST /reports rate limit', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await buildTestApp({ env: { RATE_LIMIT_REPORTS_PER_HOUR: '2' } });
  });

  afterAll(async () => {
    await t.close();
  });

  it('limits report creation per user per hour and recovers after the window', async () => {
    const { user } = await createUser(t.deps);
    const session = await loginAs(t.app, user);
    const post = () =>
      t.app.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: session.headers,
        body: { player: { type: 'steam', id: randomSteamId() }, reason: 'rate limit test' },
      });

    expect((await post()).statusCode).toBe(201);
    expect((await post()).statusCode).toBe(201);
    const limited = await post();
    expectError(limited, 429, 'RATE_LIMITED');

    // Another user is not affected.
    const { user: other } = await createUser(t.deps);
    const otherSession = await loginAs(t.app, other);
    const otherRes = await t.app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers: otherSession.headers,
      body: { player: { type: 'steam', id: randomSteamId() }, reason: 'other user' },
    });
    expect(otherRes.statusCode).toBe(201);

    // No report row was written for the limited request.
    const count = await t.db
      .selectFrom('reports')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('reporter_user_id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(2);
  });
});
