import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerUser, withTx } from '@payflow/core';
import { createHttpApp } from '@payflow/http';
import { startServer } from '@payflow/test-utils';
import {
  accessCookie,
  getFrom,
  logIn,
  PASSWORD,
  postTo,
  refreshCookie,
  setCookies,
  signUp,
  startTestApi,
  uniqueEmail,
  type TestApi,
} from './test-support.ts';

describe('secrets stay out of the logs (AC-14)', () => {
  let api: TestApi;

  beforeAll(async () => {
    api = await startTestApi();
  });

  afterAll(async () => {
    await api.close();
  });

  it('logs a full sign up, log in, refresh, and log out cycle by id only', async () => {
    const email = uniqueEmail('Logged');
    const start = api.logs.length;

    const { user } = await signUp(api, email);
    const first = await logIn(api, email);
    await getFrom(api, '/v1/wallet', accessCookie(first.access), { authorization: `Bearer ${first.access}` });
    const rotated = await postTo(api, '/v1/auth/refresh', undefined, { cookie: refreshCookie(first.refresh) });
    const second = setCookies(rotated);
    await postTo(api, '/v1/auth/refresh', undefined, { cookie: refreshCookie(first.refresh) });
    await postTo(api, '/v1/auth/logout', {}, { cookie: refreshCookie(second.payflow_refresh!.value) });

    const text = api.logs.slice(start).join('\n');
    const secrets = [
      email,
      email.toLowerCase(),
      PASSWORD,
      first.access,
      first.refresh,
      second.payflow_access!.value,
      second.payflow_refresh!.value,
    ];
    for (const secret of secrets) expect(text).not.toContain(secret);
    // The request logs keep the headers, censored.
    expect(text).toContain('"cookie":"[Redacted]"');
    expect(text).toContain('"authorization":"[Redacted]"');
    expect(text).toContain('"set-cookie":"[Redacted]"');

    const events = api.logs
      .slice(start)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.res === undefined);
    expect(events.map((e) => e.msg)).toEqual([
      'user signed up',
      'session created',
      'session refreshed',
      'refresh token reuse detected',
    ]);
    for (const event of events) expect(event.user_id).toBe(user.id);
    // A revoked session's log out changes nothing, so it logs nothing.
  });

  it('logs an unexpected database failure with no SQL parameters or quoted values', async () => {
    const email = `Upper-${uniqueEmail()}`;
    const hash = 'h'.repeat(60);
    // Fails the users_email_lowercase CHECK with the email and the hash as query parameters.
    const app = createHttpApp({
      logger: api.logger,
      readiness: [],
      mount: (a) => {
        a.post('/boom', async () => {
          await withTx(api.db, (tx) => registerUser(tx, { email, passwordHash: hash }));
        });
      },
    });
    const server = await startServer(app);
    const start = api.logs.length;
    try {
      const res = await fetch(`${server.url}/boom`, { method: 'POST' });

      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({ code: 'internal_error' });
    } finally {
      await server.close();
    }

    const text = api.logs.slice(start).join('\n');
    expect(text).not.toContain(email);
    expect(text).not.toContain(email.toLowerCase());
    expect(text).not.toContain(hash);
    expect(text).not.toContain('insert into');
    const errorLine = api.logs
      .slice(start)
      .map((line) => JSON.parse(line) as { level: number; err?: { cause?: Record<string, unknown> } })
      .find((line) => line.level === 50);
    expect(errorLine?.err?.cause).toMatchObject({ code: '23514', constraint: 'users_email_lowercase' });
  });
});
