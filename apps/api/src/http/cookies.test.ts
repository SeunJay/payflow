import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import cookieParser from 'cookie-parser';
import express from 'express';
import type { IssuedTokens } from '@payflow/core';
import { startServer, type RunningServer } from '@payflow/test-utils';
import { ACCESS_COOKIE, clearSessionCookies, cookieOf, REFRESH_COOKIE, setSessionCookies } from './cookies.ts';

const refreshExpiresAt = new Date('2026-11-02T12:00:00.000Z');
const tokens: IssuedTokens = {
  user: { id: 'u1', email: 'ada@example.com' },
  sessionId: 's1',
  accessToken: 'access-jwt',
  accessExpiresAt: new Date('2026-10-26T12:15:00.000Z'),
  refreshToken: 's1.secret',
  refreshExpiresAt,
};

// A real Express app, so the assertions read the Set-Cookie headers a browser would get.
let server: RunningServer;
beforeAll(async () => {
  const app = express();
  app.use(cookieParser());
  app.get('/set', (req, res) => {
    setSessionCookies(res, tokens, req.query.secure === 'true');
    res.end();
  });
  app.get('/clear', (req, res) => {
    clearSessionCookies(res, req.query.secure === 'true');
    res.end();
  });
  app.get('/read', (req, res) => {
    res.json({ access: cookieOf(req, ACCESS_COOKIE) ?? null, refresh: cookieOf(req, REFRESH_COOKIE) ?? null });
  });
  server = await startServer(app);
});
afterAll(() => server.close());

const get = (path: string, headers: Record<string, string> = {}) => fetch(`${server.url}${path}`, { headers });
const byName = (res: Response) =>
  Object.fromEntries(res.headers.getSetCookie().map((c) => [c.slice(0, c.indexOf('=')), c.slice(c.indexOf('=') + 1)]));

describe('session cookies (AC-5, AC-13)', () => {
  it('sets the access cookie on /v1 and the refresh cookie on /v1/auth, both expiring with the session', async () => {
    const res = await get('/set');

    const expires = `Expires=${refreshExpiresAt.toUTCString()}`;
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(byName(res)).toEqual({
      payflow_access: `access-jwt; Path=/v1; ${expires}; HttpOnly; SameSite=Strict`,
      payflow_refresh: `s1.secret; Path=/v1/auth; ${expires}; HttpOnly; SameSite=Strict`,
    });
  });

  it('adds Secure to both cookies when secure is on', async () => {
    const cookies = Object.values(byName(await get('/set?secure=true')));

    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) expect(cookie).toContain('; Secure;');
  });

  it('clears both cookies with the same paths and flags they were set with', async () => {
    const res = await get('/clear?secure=true');

    const epoch = 'Expires=Thu, 01 Jan 1970 00:00:00 GMT';
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(byName(res)).toEqual({
      payflow_access: `; Path=/v1; ${epoch}; HttpOnly; Secure; SameSite=Strict`,
      payflow_refresh: `; Path=/v1/auth; ${epoch}; HttpOnly; Secure; SameSite=Strict`,
    });
  });
});

describe('cookieOf', () => {
  it('reads plain string cookie values', async () => {
    const res = await get('/read', { cookie: 'payflow_access=a.b.c; payflow_refresh=s1.secret' });

    expect(await res.json()).toEqual({ access: 'a.b.c', refresh: 's1.secret' });
  });

  it('returns nothing for a missing cookie or one cookie-parser turned into JSON', async () => {
    const json = encodeURIComponent('j:{"sub":"someone"}');
    const res = await get('/read', { cookie: `payflow_access=${json}` });

    expect(await res.json()).toEqual({ access: null, refresh: null });
  });
});
