import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { loadConfig, logLevel, port, url } from './config.ts';

const schema = z.object({
  DATABASE_URL: url,
  API_PORT: port(3000),
  LOG_LEVEL: logLevel,
});

describe('loadConfig', () => {
  let exit: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Throw instead of exiting so the test can see the call and the code stops there.
    exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns typed config with defaults filled in', () => {
    const config = loadConfig(schema, { DATABASE_URL: 'postgres://u:p@localhost:5432/payflow' });

    expect(config).toEqual({
      DATABASE_URL: 'postgres://u:p@localhost:5432/payflow',
      API_PORT: 3000,
      LOG_LEVEL: 'info',
    });
  });

  it('coerces a port given as a string, as env vars always are', () => {
    const config = loadConfig(schema, { DATABASE_URL: 'postgres://localhost/db', API_PORT: '8080' });

    expect(config.API_PORT).toBe(8080);
  });

  it('prints every problem at once and exits 1 on bad config (DW-3)', () => {
    expect(() => loadConfig(schema, { DATABASE_URL: 'nope', API_PORT: '70000', LOG_LEVEL: 'loud' })).toThrow(
      'process.exit(1)',
    );

    expect(exit).toHaveBeenCalledWith(1);
    const printed = String(stderr.mock.calls[0]?.[0]);
    expect(printed).toContain('Invalid configuration');
    expect(printed).toContain('DATABASE_URL');
    expect(printed).toContain('API_PORT');
    expect(printed).toContain('LOG_LEVEL');
  });

  it('exits when a required value is missing', () => {
    expect(() => loadConfig(schema, {})).toThrow('process.exit(1)');

    expect(String(stderr.mock.calls[0]?.[0])).toContain('DATABASE_URL');
  });

  it('reads process.env when no env is passed', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/from-env');

    expect(loadConfig(schema).DATABASE_URL).toBe('postgres://localhost/from-env');

    vi.unstubAllEnvs();
  });
});

describe('port', () => {
  it.each([
    ['0', false],
    ['1', true],
    ['65535', true],
    ['65536', false],
    ['3000.5', false],
    ['abc', false],
  ])('accepts %s: %s', (value, ok) => {
    expect(port(3000).safeParse(value).success).toBe(ok);
  });

  it('falls back to the default when unset', () => {
    expect(port(4000).parse(undefined)).toBe(4000);
  });
});

describe('logLevel', () => {
  it('accepts every pino level plus silent', () => {
    for (const level of ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']) {
      expect(logLevel.parse(level)).toBe(level);
    }
  });

  it('rejects an unknown level', () => {
    expect(logLevel.safeParse('verbose').success).toBe(false);
  });
});
