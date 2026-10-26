import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, refreshSession, withTx, type RefreshResult, type Tx } from '@payflow/core';
import { holdOpen, waitForLockWaiters } from '@payflow/test-utils';
import {
  accessCookie,
  getFrom,
  logLines,
  newSession,
  postTo,
  refreshCookie,
  refreshSecret,
  setCookies,
  startTestApi,
  type Session,
  type TestApi,
  anyString,
  anyDate,
} from './test-support.ts';

type SessionRow = {
  current_token_hash: string;
  expires_at: Date;
  rotated_at: Date | null;
  revoked_at: Date | null;
  revoked_reason: string | null;
};

describe('refresh sessions and log out', () => {
  let api: TestApi;

  beforeAll(async () => {
    api = await startTestApi();
  });

  afterAll(async () => {
    await api.close();
  });

  const sessionIdOf = (refresh: string) => refresh.slice(0, refresh.indexOf('.'));

  async function row(sessionId: string): Promise<SessionRow> {
    const { rows } = await api.pool.query<SessionRow>(
      'select current_token_hash, expires_at, rotated_at, revoked_at, revoked_reason from auth_sessions where id = $1',
      [sessionId],
    );
    return rows[0]!;
  }

  const refresh = (token?: string) =>
    postTo(api, '/v1/auth/refresh', undefined, token === undefined ? {} : { cookie: refreshCookie(token) });
  const logout = (token?: string) =>
    postTo(api, '/v1/auth/logout', {}, token === undefined ? {} : { cookie: refreshCookie(token) });

  function expectCleared(res: Response) {
    const cookies = setCookies(res);
    expect(cookies.payflow_access).toEqual({
      value: '',
      attributes: 'Path=/v1; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict',
    });
    expect(cookies.payflow_refresh).toEqual({
      value: '',
      attributes: 'Path=/v1/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict',
    });
    expect(res.headers.get('cache-control')).toBe('no-store');
  }

  describe('rotation and reuse (AC-10, AC-11)', () => {
    it('rotates the refresh token, keeps the absolute expiry, and refuses the token just used', async () => {
      const session = await newSession(api);
      const id = sessionIdOf(session.refresh);
      const before = await row(id);

      const res = await refresh(session.refresh);

      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = (await res.json()) as { refreshExpiresAt: string };
      expect(body).toEqual({
        user: { id: session.userId, email: session.email },
        accessExpiresAt: anyString,
        refreshExpiresAt: before.expires_at.toISOString(),
      });
      const cookies = setCookies(res);
      const next = cookies.payflow_refresh!.value;
      expect(sessionIdOf(next)).toBe(id);
      expect(next).not.toBe(session.refresh);
      expect(cookies.payflow_access!.value).toMatch(/^ey/);
      expect(cookies.payflow_access!.attributes).toContain(`Expires=${before.expires_at.toUTCString()}`);
      const after = await row(id);
      expect(after.current_token_hash).not.toBe(before.current_token_hash);
      expect(after.rotated_at).toBeInstanceOf(Date);
      expect(after.expires_at).toEqual(before.expires_at);
      expect(after.revoked_at).toBeNull();
      expect((await getFrom(api, '/v1/wallet', accessCookie(cookies.payflow_access!.value))).status).toBe(200);

      const replay = await refresh(session.refresh);

      expect(replay.status).toBe(401);
      expect(await replay.json()).toMatchObject({ code: 'invalid_refresh', title: 'Invalid refresh token' });
      expectCleared(replay);
      expect(await row(id)).toMatchObject({ revoked_reason: 'reuse_detected', revoked_at: anyDate });
      // The whole session is ended, so the token the 200 issued fails too.
      expect((await refresh(next)).status).toBe(401);
      expect((await row(id)).revoked_reason).toBe('reuse_detected');
      const warn = logLines(api).find((l) => l.msg === 'refresh token reuse detected' && l.session_id === id);
      expect(warn).toMatchObject({ level: 40, user_id: session.userId, session_id: id });
    });

    it('lets exactly one of two concurrent refreshes with one token win, then ends the session', async () => {
      const session = await newSession(api);
      const id = sessionIdOf(session.refresh);
      const run = (tx: Tx) => refreshSession(tx, api.auth, session.refresh);

      const first = holdOpen((fn: (tx: Tx) => Promise<RefreshResult>) => withTx(api.db, fn), run);
      await first.worked;
      // The second waits on the row lock, then reads the new hash under read committed.
      const second = withTx(api.db, run);
      await waitForLockWaiters(api.pool, 1);
      const winner = await first.commit();
      const loser = await second;

      expect(winner.ok).toBe(true);
      expect(loser).toEqual({ ok: false, reason: 'reuse_detected', userId: session.userId, sessionId: id });
      // Committed: a brand new connection sees the revocation.
      const fresh = createDb({ url: api.databaseUrl, logger: api.logger, max: 1 });
      try {
        const seen = await fresh.pool.query<{ revoked_reason: string }>(
          'select revoked_reason from auth_sessions where id = $1',
          [id],
        );
        expect(seen.rows[0]!.revoked_reason).toBe('reuse_detected');
      } finally {
        await fresh.close();
      }
      if (!winner.ok) throw new Error('unreachable');
      const res = await refresh(winner.tokens.refreshToken);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: 'invalid_refresh' });
    });
  });

  describe('refresh failures (AC-12)', () => {
    let victim: Session;

    beforeAll(async () => {
      victim = await newSession(api);
    });

    async function insertSession(sql: string): Promise<string> {
      const { secret, hash } = refreshSecret();
      const { rows } = await api.pool.query<{ id: string }>(
        `insert into auth_sessions (user_id, current_token_hash, created_at, expires_at, revoked_at, revoked_reason)
         ${sql} returning id`,
        [victim.userId, hash],
      );
      return `${rows[0]!.id}.${secret}`;
    }

    const cases: [string, () => Promise<string | undefined>][] = [
      ['a missing cookie', () => Promise.resolve(undefined)],
      ['a token with no dot', () => Promise.resolve('garbage')],
      ['a non uuid session id', () => Promise.resolve(`nope.${'a'.repeat(43)}`)],
      ['a short secret', () => Promise.resolve(`${randomUUID()}.short`)],
      ['an unknown session', () => Promise.resolve(`${randomUUID()}.${refreshSecret().secret}`)],
      [
        'an expired session',
        () => insertSession(`values ($1, $2, now() - interval '2 hours', now() - interval '1 hour', null, null)`),
      ],
      ['a revoked session', () => insertSession(`values ($1, $2, now(), now() + interval '1 day', now(), 'logout')`)],
    ];

    it.each(cases)(
      'answers %s with 401 invalid_refresh, clears the cookies, and changes nothing',
      async (_name, make) => {
        const token = await make();
        const snapshot = async () =>
          (
            await api.pool.query<Record<string, unknown>>(
              'select * from auth_sessions where user_id = $1 order by id',
              [victim.userId],
            )
          ).rows;
        const before = await snapshot();

        const res = await refresh(token);

        expect(res.status).toBe(401);
        expect(await res.json()).toMatchObject({ code: 'invalid_refresh' });
        expectCleared(res);
        expect(await snapshot()).toEqual(before);
      },
    );

    it('does not revoke an expired session presented with a stale secret', async () => {
      const token = await insertSession(
        `values ($1, $2, now() - interval '2 hours', now() - interval '1 hour', null, null)`,
      );
      const stale = `${sessionIdOf(token)}.${refreshSecret().secret}`;

      expect((await refresh(stale)).status).toBe(401);

      expect((await row(sessionIdOf(token))).revoked_at).toBeNull();
    });

    it('refuses a session row with only one of revoked_at and revoked_reason (auth_sessions_revoked_pair)', async () => {
      const bad = insertSession(`values ($1, $2, now(), now() + interval '1 day', now(), null)`);

      await expect(bad).rejects.toMatchObject({ code: '23514', constraint: 'auth_sessions_revoked_pair' });
    });
  });

  describe('log out (AC-13)', () => {
    it('revokes the session as logout and clears both cookies, while the old access token runs to its expiry', async () => {
      const session = await newSession(api);
      const id = sessionIdOf(session.refresh);

      const res = await logout(session.refresh);

      expect(res.status).toBe(204);
      expectCleared(res);
      expect(await row(id)).toMatchObject({ revoked_reason: 'logout', revoked_at: anyDate });
      expect((await refresh(session.refresh)).status).toBe(401);
      expect((await getFrom(api, '/v1/wallet', accessCookie(session.access))).status).toBe(200);
      expect(logLines(api).find((l) => l.msg === 'session revoked' && l.session_id === id)).toMatchObject({
        reason: 'logout',
      });
    });

    it('revokes a live session as reuse_detected when the secret is stale', async () => {
      const session = await newSession(api);
      const id = sessionIdOf(session.refresh);
      const rotated = setCookies(await refresh(session.refresh)).payflow_refresh!.value;
      expect(rotated).not.toBe(session.refresh);

      const res = await logout(session.refresh);

      expect(res.status).toBe(204);
      expect((await row(id)).revoked_reason).toBe('reuse_detected');
    });

    it('answers no cookie, garbage, and a second log out with 204 and changes nothing', async () => {
      const session = await newSession(api);
      const id = sessionIdOf(session.refresh);
      await logout(session.refresh);
      const before = await row(id);

      for (const token of [undefined, 'garbage', session.refresh]) {
        const res = await logout(token);
        expect(res.status).toBe(204);
        expectCleared(res);
      }

      expect(await row(id)).toEqual(before);
    });

    it('accepts a log out with no body at all when it says application/json', async () => {
      const session = await newSession(api);

      const res = await postTo(api, '/v1/auth/logout', undefined, { cookie: refreshCookie(session.refresh) });

      expect(res.status).toBe(204);
    });
  });
});
