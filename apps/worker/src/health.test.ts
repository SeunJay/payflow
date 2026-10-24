import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '@payflow/test-utils';
import { startHealthServer, type ReadinessCheck } from './health.ts';

describe('startHealthServer', () => {
  let server: RunningServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  async function serve(checks: ReadinessCheck[], timeoutMs?: number) {
    server = await startServer(startHealthServer(0, checks, timeoutMs));
    return server.url;
  }

  const ok = (name: string): ReadinessCheck => ({ name, check: async () => {} });

  it('answers /health with 200 JSON (DW-1)', async () => {
    const url = await serve([]);

    const res = await fetch(`${url}/health`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('answers /ready with 200 when postgres, valkey, and the relay are all fine (DW-1)', async () => {
    const url = await serve([ok('postgres'), ok('valkey'), ok('relay')]);

    const res = await fetch(`${url}/ready`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ready',
      checks: [
        { name: 'postgres', ok: true },
        { name: 'valkey', ok: true },
        { name: 'relay', ok: true },
      ],
    });
  });

  it('answers /ready with 503 naming the failed checks (DW-3)', async () => {
    const url = await serve([
      { name: 'postgres', check: async () => Promise.reject(new Error('connection refused')) },
      ok('valkey'),
      { name: 'relay', check: async () => Promise.reject(new Error('relay loop stopped')) },
    ]);

    const res = await fetch(`${url}/ready`);

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: 'not_ready',
      checks: [
        { name: 'postgres', ok: false, error: 'connection refused' },
        { name: 'valkey', ok: true },
        { name: 'relay', ok: false, error: 'relay loop stopped' },
      ],
    });
  });

  it('fails a hanging check after the timeout', async () => {
    const url = await serve([{ name: 'valkey', check: () => new Promise<void>(() => {}) }], 50);

    const res = await fetch(`${url}/ready`);

    expect(res.status).toBe(503);
    expect(((await res.json()) as { checks: unknown }).checks).toEqual([
      { name: 'valkey', ok: false, error: 'timed out after 50ms' },
    ]);
  });

  it('answers an unknown path with 404', async () => {
    const url = await serve([]);

    const res = await fetch(`${url}/metrics`);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ status: 'not_found' });
  });

  it('answers a non GET method with 405', async () => {
    const url = await serve([]);

    const res = await fetch(`${url}/health`, { method: 'POST' });

    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ status: 'method_not_allowed' });
  });
});
