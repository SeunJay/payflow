import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '@payflow/test-utils';
import { healthRouter, type ReadinessCheck } from './health.ts';

describe('healthRouter', () => {
  let server: RunningServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  async function serve(checks: ReadinessCheck[], timeoutMs?: number) {
    const app = express();
    app.use(healthRouter(checks, timeoutMs));
    server = await startServer(app);
    return server.url;
  }

  const ok = (name: string): ReadinessCheck => ({ name, check: async () => {} });
  const failing = (name: string, message: string): ReadinessCheck => ({
    name,
    check: async () => Promise.reject(new Error(message)),
  });

  it('answers /health with 200 even when dependencies are down', async () => {
    const url = await serve([failing('postgres', 'down')]);

    const res = await fetch(`${url}/health`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('answers /ready with 200 and every check ok when all pass (DW-1)', async () => {
    const url = await serve([ok('postgres'), ok('valkey')]);

    const res = await fetch(`${url}/ready`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ready',
      checks: [
        { name: 'postgres', ok: true },
        { name: 'valkey', ok: true },
      ],
    });
  });

  it('answers /ready with 503 naming only the failed checks (DW-3)', async () => {
    const url = await serve([ok('postgres'), failing('valkey', 'ECONNREFUSED')]);

    const res = await fetch(`${url}/ready`);

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: 'not_ready',
      checks: [
        { name: 'postgres', ok: true },
        { name: 'valkey', ok: false, error: 'ECONNREFUSED' },
      ],
    });
  });

  it('fails a check that hangs past the timeout instead of hanging the probe', async () => {
    const url = await serve([{ name: 'postgres', check: () => new Promise<void>(() => {}) }], 50);

    const res = await fetch(`${url}/ready`);

    expect(res.status).toBe(503);
    expect(((await res.json()) as { checks: unknown }).checks).toEqual([
      { name: 'postgres', ok: false, error: 'timed out after 50ms' },
    ]);
  });

  it('reports a non Error rejection as text', async () => {
    const url = await serve([{ name: 'odd', check: () => Promise.reject('just a string') }]);

    const body = (await (await fetch(`${url}/ready`)).json()) as Record<string, unknown>;

    expect(body.checks).toEqual([{ name: 'odd', ok: false, error: 'just a string' }]);
  });

  it('is ready when there are no checks', async () => {
    const url = await serve([]);

    const res = await fetch(`${url}/ready`);

    expect(res.status).toBe(200);
  });
});
