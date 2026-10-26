// The auth use cases called directly, with no HTTP (spec 0005: services own the unit of work).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '@payflow/shared';
import { createTestDeps, PASSWORD, uniqueEmail, type TestDeps } from '../../test-support.ts';
import { createAuthService, type AuthService } from './auth.service.ts';

describe('auth service', () => {
  let deps: TestDeps;
  let service: AuthService;

  beforeAll(async () => {
    deps = await createTestDeps();
    service = createAuthService(deps);
  });

  afterAll(async () => {
    await deps.close();
  });

  const count = async (sql: string, value: string) => {
    const { rows } = await deps.pool.query<{ n: string }>(sql, [value]);
    return Number(rows[0]?.n);
  };
  const sessionRow = async (sessionId: string) => {
    const { rows } = await deps.pool.query<{ revoked_reason: string | null }>(
      'select revoked_reason from auth_sessions where id = $1',
      [sessionId],
    );
    return rows[0];
  };

  describe('signUp (AC-1, AC-2, AC-3)', () => {
    it('creates the user and a funded wallet in one unit of work', async () => {
      const email = uniqueEmail('ada');

      const { user, wallet } = await service.signUp({ email: ` ${email.toUpperCase()} `, password: PASSWORD });

      expect(user.email).toBe(email);
      expect(wallet.balance).toEqual({ amount: 1_000_000n, currency: 'NGN' });
      expect(await count('select count(*) as n from wallets where user_id = $1', user.id)).toBe(1);
    });

    it('throws 422 validation_failed for a bad body and writes nothing', async () => {
      const email = uniqueEmail('short');

      await expect(service.signUp({ email, password: 'short' })).rejects.toMatchObject({
        status: 422,
        code: 'validation_failed',
      });
      expect(await count('select count(*) as n from users where email = $1', email)).toBe(0);
    });

    it('throws 409 email_taken for an existing email', async () => {
      const email = uniqueEmail('twice');
      await service.signUp({ email, password: PASSWORD });

      await expect(service.signUp({ email, password: PASSWORD })).rejects.toMatchObject({
        status: 409,
        code: 'email_taken',
      });
    });
  });

  describe('logIn (AC-5, AC-6)', () => {
    it('opens a session and returns both tokens', async () => {
      const email = uniqueEmail('login');
      const { user } = await service.signUp({ email, password: PASSWORD });

      const tokens = await service.logIn({ email, password: PASSWORD });

      expect(tokens.user).toEqual({ id: user.id, email });
      expect(tokens.refreshToken.startsWith(`${tokens.sessionId}.`)).toBe(true);
      expect(await sessionRow(tokens.sessionId)).toEqual({ revoked_reason: null });
    });

    it('throws 401 invalid_credentials for a wrong password', async () => {
      const email = uniqueEmail('wrong');
      await service.signUp({ email, password: PASSWORD });

      const failure = service.logIn({ email, password: 'not the password' });

      await expect(failure).rejects.toBeInstanceOf(AppError);
      await expect(failure).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
    });
  });

  describe('refresh (AC-10, AC-11, AC-12)', () => {
    it('rotates a current token', async () => {
      const email = uniqueEmail('rotate');
      await service.signUp({ email, password: PASSWORD });
      const first = await service.logIn({ email, password: PASSWORD });

      const result = await service.refresh(first.refreshToken);

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.tokens.refreshToken).not.toBe(first.refreshToken);
    });

    it.each([
      ['no token', undefined, 'malformed'],
      ['garbage', 'garbage', 'malformed'],
      ['an unknown session', `00000000-0000-4000-8000-000000000000.${'a'.repeat(43)}`, 'unknown'],
    ] as const)('returns a failure for %s instead of throwing', async (_name, token, reason) => {
      expect(await service.refresh(token)).toEqual({ ok: false, reason });
    });

    it('returns reuse_detected for a replayed token and commits the revoke, though it does not throw', async () => {
      const email = uniqueEmail('reuse');
      const { user } = await service.signUp({ email, password: PASSWORD });
      const first = await service.logIn({ email, password: PASSWORD });
      await service.refresh(first.refreshToken);

      const replay = await service.refresh(first.refreshToken);

      expect(replay).toEqual({ ok: false, reason: 'reuse_detected', userId: user.id, sessionId: first.sessionId });
      // A separate connection sees it, so the revoke was committed, not rolled back.
      expect(await sessionRow(first.sessionId)).toEqual({ revoked_reason: 'reuse_detected' });
    });
  });

  describe('logOut (AC-13)', () => {
    it('revokes the session as logout, then reports nothing to do a second time', async () => {
      const email = uniqueEmail('logout');
      const { user } = await service.signUp({ email, password: PASSWORD });
      const tokens = await service.logIn({ email, password: PASSWORD });

      expect(await service.logOut(tokens.refreshToken)).toEqual({
        revoked: true,
        sessionId: tokens.sessionId,
        userId: user.id,
        reason: 'logout',
      });
      expect(await sessionRow(tokens.sessionId)).toEqual({ revoked_reason: 'logout' });
      expect(await service.logOut(tokens.refreshToken)).toEqual({ revoked: false });
    });

    it('reports nothing to do for a missing token', async () => {
      expect(await service.logOut(undefined)).toEqual({ revoked: false });
    });
  });
});
