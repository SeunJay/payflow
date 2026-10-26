import { createHmac, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { AppError } from '@payflow/shared';
import type { AuthContext } from './auth-context.ts';
import {
  authenticate,
  formatRefreshToken,
  hashSecret,
  newRefreshSecret,
  parseRefreshToken,
  secretMatches,
  signAccessToken,
} from './tokens.ts';

const auth: AuthContext = {
  jwtSecret: 'unit-test-jwt-secret-0123456789abcdef',
  accessTtlSeconds: 900,
  refreshTtlSeconds: 3600,
  bcryptCost: 4,
  dummyHash: '',
};
const userId = randomUUID();
const sessionId = randomUUID();

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const claims = (overrides: Record<string, unknown> = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return { sub: userId, sid: sessionId, iss: 'payflow-api', aud: 'payflow-api', iat: now, exp: now + 60, ...overrides };
};
// Built by hand so a test controls every header and claim byte.
const forge = (payload: object, { secret = auth.jwtSecret, alg = 'HS256' } = {}) => {
  const head = `${b64({ alg, typ: 'JWT' })}.${b64(payload)}`;
  if (alg === 'none') return `${head}.`;
  const digest = alg === 'HS512' ? 'sha512' : 'sha256';
  return `${head}.${createHmac(digest, secret).update(head).digest('base64url')}`;
};

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof AppError ? `${String(err.status)} ${err.code}` : 'not an AppError';
  }
  return 'no error';
};

afterEach(() => {
  vi.useRealTimers();
});

describe('signAccessToken', () => {
  it('signs HS256 with sub, sid, iss, aud and an exp one TTL after iat that matches expiresAt (AC-5)', () => {
    vi.useFakeTimers({ now: new Date('2026-10-26T12:00:00.400Z'), toFake: ['Date'] });

    const { token, expiresAt } = signAccessToken(auth, userId, sessionId);

    const decoded = jwt.decode(token, { complete: true });
    expect(decoded?.header.alg).toBe('HS256');
    expect(decoded?.payload).toEqual({
      sub: userId,
      sid: sessionId,
      iss: 'payflow-api',
      aud: 'payflow-api',
      iat: 1_793_016_000,
      exp: 1_793_016_900,
    });
    expect(expiresAt.toISOString()).toBe('2026-10-26T12:15:00.000Z');
  });
});

describe('authenticate (AC-7)', () => {
  it('returns the user and session ids from a token it signed', () => {
    const { token } = signAccessToken(auth, userId, sessionId);

    expect(authenticate(auth, token)).toEqual({ userId, sessionId });
  });

  it('accepts the hand built token, so each forgery below differs only where named', () => {
    expect(authenticate(auth, forge(claims()))).toEqual({ userId, sessionId });
  });

  it.each([
    ['no token', undefined],
    ['an empty string', ''],
    ['garbage', 'not-a-jwt'],
    ['another secret', forge(claims(), { secret: 'another-secret-0123456789abcdef0123' })],
    ['alg none', forge(claims(), { alg: 'none' })],
    ['HS512 with the right secret', forge(claims(), { alg: 'HS512' })],
    ['a wrong issuer', forge(claims({ iss: 'someone-else' }))],
    ['a wrong audience', forge(claims({ aud: 'someone-else' }))],
    ['no sid', forge(claims({ sid: undefined }))],
    ['a sub that is not a uuid', forge(claims({ sub: 'user-1' }))],
    ['a non integer iat', forge(claims({ iat: 1.5 }))],
  ])('answers %s with 401 unauthenticated', (_name, token) => {
    expect(codeOf(() => authenticate(auth, token))).toBe('401 unauthenticated');
  });

  it('answers a correctly signed but expired token with 401 token_expired', () => {
    const expired = forge(claims({ iat: Math.floor(Date.now() / 1000) - 120, exp: Math.floor(Date.now() / 1000) - 1 }));

    expect(codeOf(() => authenticate(auth, expired))).toBe('401 token_expired');
  });

  it('answers an expired token with a bad signature as unauthenticated, never token_expired', () => {
    const expired = forge(claims({ exp: Math.floor(Date.now() / 1000) - 1 }), {
      secret: 'another-secret-0123456789abcdef0123',
    });

    expect(codeOf(() => authenticate(auth, expired))).toBe('401 unauthenticated');
  });

  it('flips its own token to token_expired once the access TTL has passed', () => {
    vi.useFakeTimers({ now: new Date('2026-10-26T12:00:00Z'), toFake: ['Date'] });
    const { token } = signAccessToken(auth, userId, sessionId);

    vi.setSystemTime(new Date('2026-10-26T12:15:01Z'));

    expect(codeOf(() => authenticate(auth, token))).toBe('401 token_expired');
  });
});

describe('refresh tokens (AC-10, AC-12)', () => {
  it('makes a 43 character base64url secret, different every time', () => {
    const first = newRefreshSecret();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newRefreshSecret()).not.toBe(first);
  });

  it('round trips a formatted token and lowercases the session id', () => {
    const secret = newRefreshSecret();

    expect(parseRefreshToken(formatRefreshToken(sessionId.toUpperCase(), secret))).toEqual({ sessionId, secret });
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['without a dot', `${sessionId}${'a'.repeat(43)}`],
    ['with a non uuid session id', `session-1.${'a'.repeat(43)}`],
    ['with a 42 character secret', `${sessionId}.${'a'.repeat(42)}`],
    ['with a 44 character secret', `${sessionId}.${'a'.repeat(44)}`],
    ['with a secret outside base64url', `${sessionId}.${'a'.repeat(42)}+`],
    ['with a second dot in the secret', `${sessionId}.${'a'.repeat(21)}.${'a'.repeat(21)}`],
  ])('treats a token %s as malformed', (_name, token) => {
    expect(parseRefreshToken(token)).toBeNull();
  });

  it('stores only the sha256 hex of a secret and matches it back', () => {
    const secret = newRefreshSecret();
    const stored = hashSecret(secret);

    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(secret);
    expect(secretMatches(secret, stored)).toBe(true);
    expect(secretMatches(newRefreshSecret(), stored)).toBe(false);
  });
});
