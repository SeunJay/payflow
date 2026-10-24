import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// config.ts validates process.env at import time, so each test stubs the env
// and imports a fresh copy.
async function importConfig() {
  vi.resetModules();
  return (await import('./config.ts')).config;
}

describe('worker config', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgres://payflow:pw@localhost:5432/payflow');
    vi.stubEnv('VALKEY_URL', 'redis://localhost:6379');
    vi.stubEnv('WORKER_PORT', undefined);
    vi.stubEnv('LOG_LEVEL', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('loads with port 3100 and info logs by default', async () => {
    expect(await importConfig()).toEqual({
      DATABASE_URL: 'postgres://payflow:pw@localhost:5432/payflow',
      VALKEY_URL: 'redis://localhost:6379',
      WORKER_PORT: 3100,
      LOG_LEVEL: 'info',
    });
  });

  it('refuses to start with DATABASE_URL=nope, printing the problem and exiting 1 (DW-3)', async () => {
    vi.stubEnv('DATABASE_URL', 'nope');
    vi.stubEnv('VALKEY_URL', undefined);
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    await expect(importConfig()).rejects.toThrow('process.exit(1)');

    expect(exit).toHaveBeenCalledWith(1);
    const printed = String(stderr.mock.calls[0]?.[0]);
    expect(printed).toContain('DATABASE_URL');
    expect(printed).toContain('VALKEY_URL');
  });
});
