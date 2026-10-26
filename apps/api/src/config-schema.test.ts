import { describe, expect, it } from 'vitest';
import { configSchema } from './config-schema.ts';

const valid = {
  DATABASE_URL: 'postgres://payflow:pw@localhost:5432/payflow',
  VALKEY_URL: 'redis://localhost:6379',
  JWT_SECRET: 's'.repeat(32),
};

describe('api config schema (AC-15)', () => {
  it('fills the auth defaults and turns COOKIE_SECURE into a boolean', () => {
    expect(configSchema.parse(valid)).toEqual({
      ...valid,
      API_PORT: 3000,
      LOG_LEVEL: 'info',
      ACCESS_TOKEN_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_SECONDS: 604_800,
      BCRYPT_COST: 12,
      COOKIE_SECURE: true,
    });
    expect(configSchema.parse({ ...valid, COOKIE_SECURE: 'false', BCRYPT_COST: '4' })).toMatchObject({
      COOKIE_SECURE: false,
      BCRYPT_COST: 4,
    });
  });

  it.each([
    ['a missing JWT_SECRET', { JWT_SECRET: undefined }, 'JWT_SECRET'],
    ['a 31 character JWT_SECRET', { JWT_SECRET: 's'.repeat(31) }, 'JWT_SECRET'],
    ['an access TTL under 60', { ACCESS_TOKEN_TTL_SECONDS: '59' }, 'ACCESS_TOKEN_TTL_SECONDS'],
    ['an access TTL over a day', { ACCESS_TOKEN_TTL_SECONDS: '86401' }, 'ACCESS_TOKEN_TTL_SECONDS'],
    ['a fractional access TTL', { ACCESS_TOKEN_TTL_SECONDS: '900.5' }, 'ACCESS_TOKEN_TTL_SECONDS'],
    ['a refresh TTL under an hour', { REFRESH_TOKEN_TTL_SECONDS: '3599' }, 'REFRESH_TOKEN_TTL_SECONDS'],
    ['a refresh TTL over 30 days', { REFRESH_TOKEN_TTL_SECONDS: '2592001' }, 'REFRESH_TOKEN_TTL_SECONDS'],
    [
      'a refresh TTL not longer than the access TTL',
      { ACCESS_TOKEN_TTL_SECONDS: '7200', REFRESH_TOKEN_TTL_SECONDS: '7200' },
      'REFRESH_TOKEN_TTL_SECONDS',
    ],
    ['BCRYPT_COST 3', { BCRYPT_COST: '3' }, 'BCRYPT_COST'],
    ['BCRYPT_COST 16', { BCRYPT_COST: '16' }, 'BCRYPT_COST'],
    ['COOKIE_SECURE=yes', { COOKIE_SECURE: 'yes' }, 'COOKIE_SECURE'],
    ['COOKIE_SECURE=1', { COOKIE_SECURE: '1' }, 'COOKIE_SECURE'],
  ])('rejects %s', (_name, override, field) => {
    const result = configSchema.safeParse({ ...valid, ...override });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toContain(field);
  });
});
