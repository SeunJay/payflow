import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// config.ts validates process.env at import time, so each test stubs the env
// and imports a fresh copy.
async function importConfig() {
  vi.resetModules();
  return (await import('./config.ts')).config;
}

describe('simulator config', () => {
  beforeEach(() => {
    vi.stubEnv('SIMULATOR_DATABASE_URL', 'postgres://simulator:pw@localhost:5432/simulator');
    vi.stubEnv('SIMULATOR_PORT', undefined);
    vi.stubEnv('LOG_LEVEL', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('loads with port 4000 and info logs by default', async () => {
    expect(await importConfig()).toEqual({
      SIMULATOR_DATABASE_URL: 'postgres://simulator:pw@localhost:5432/simulator',
      SIMULATOR_PORT: 4000,
      LOG_LEVEL: 'info',
    });
  });

  it('does not need the payflow DATABASE_URL, since it never touches that database', async () => {
    vi.stubEnv('DATABASE_URL', undefined);

    expect((await importConfig()).SIMULATOR_PORT).toBe(4000);
  });

  it('refuses to start with a bad database URL, exiting 1 (DW-3)', async () => {
    vi.stubEnv('SIMULATOR_DATABASE_URL', 'nope');
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    await expect(importConfig()).rejects.toThrow('process.exit(1)');

    expect(String(stderr.mock.calls[0]?.[0])).toContain('SIMULATOR_DATABASE_URL');
  });
});
