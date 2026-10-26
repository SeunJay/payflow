import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// config.ts validates process.env at import time, so each test stubs the env
// and imports a fresh copy. Every rule is covered in config-schema.test.ts.
async function importConfig() {
  vi.resetModules();
  return (await import('./config.ts')).config;
}

describe('api config', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgres://payflow:pw@localhost:5432/payflow');
    vi.stubEnv('VALKEY_URL', 'redis://localhost:6379');
    vi.stubEnv('JWT_SECRET', 's'.repeat(32));
    for (const name of [
      'API_PORT',
      'LOG_LEVEL',
      'ACCESS_TOKEN_TTL_SECONDS',
      'REFRESH_TOKEN_TTL_SECONDS',
      'BCRYPT_COST',
      'COOKIE_SECURE',
    ]) {
      vi.stubEnv(name, undefined);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('loads with port 3000, info logs, and the auth defaults', async () => {
    expect(await importConfig()).toEqual({
      DATABASE_URL: 'postgres://payflow:pw@localhost:5432/payflow',
      VALKEY_URL: 'redis://localhost:6379',
      API_PORT: 3000,
      LOG_LEVEL: 'info',
      JWT_SECRET: 's'.repeat(32),
      ACCESS_TOKEN_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_SECONDS: 604_800,
      BCRYPT_COST: 12,
      COOKIE_SECURE: true,
    });
  });

  it('refuses to start with bad values, printing every problem and exiting 1 (DW-3, AC-15)', async () => {
    vi.stubEnv('DATABASE_URL', 'nope');
    vi.stubEnv('VALKEY_URL', undefined);
    vi.stubEnv('JWT_SECRET', 'short');
    vi.stubEnv('COOKIE_SECURE', 'yes');
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    await expect(importConfig()).rejects.toThrow('process.exit(1)');

    expect(exit).toHaveBeenCalledWith(1);
    const printed = String(stderr.mock.calls[0]?.[0]);
    for (const name of ['DATABASE_URL', 'VALKEY_URL', 'JWT_SECRET', 'COOKIE_SECURE']) expect(printed).toContain(name);
  });
});
