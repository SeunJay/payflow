import { describe, expect, it } from 'vitest';
import type { IssuedTokens } from '@payflow/core';
import { sessionBody, userBody, walletBody } from './auth.schemas.ts';

const createdAt = new Date('2026-10-26T12:00:00.000Z');

describe('auth response bodies', () => {
  it('builds the sign up body with an ISO createdAt and a string balance (AC-1)', () => {
    const body = {
      user: userBody({ id: 'u1', email: 'ada@example.com', createdAt }),
      wallet: walletBody({ id: 'w1', balance: { amount: 1_000_000n, currency: 'NGN' } }),
    };

    expect(JSON.parse(JSON.stringify(body))).toEqual({
      user: { id: 'u1', email: 'ada@example.com', createdAt: '2026-10-26T12:00:00.000Z' },
      wallet: { id: 'w1', balance: { amount: '1000000', currency: 'NGN' } },
    });
  });

  it('never puts a token or the session id in the session body (AC-5)', () => {
    const tokens: IssuedTokens = {
      user: { id: 'u1', email: 'ada@example.com' },
      sessionId: 's1',
      accessToken: 'eyJ.access.token',
      accessExpiresAt: new Date('2026-10-26T12:15:00.000Z'),
      refreshToken: 's1.refresh-secret',
      refreshExpiresAt: new Date('2026-11-02T12:00:00.000Z'),
    };

    const body = sessionBody(tokens);

    expect(body).toEqual({
      user: { id: 'u1', email: 'ada@example.com' },
      accessExpiresAt: '2026-10-26T12:15:00.000Z',
      refreshExpiresAt: '2026-11-02T12:00:00.000Z',
    });
    expect(JSON.stringify(body)).not.toMatch(/access\.token|refresh-secret|"s1"/);
  });
});
