import type { Express } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from '@payflow/shared';
import { startServer, type RunningServer } from '@payflow/test-utils';
import { createHttpApp } from './app.ts';
import type { ReadinessCheck } from './health.ts';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from './ids.ts';

describe('createHttpApp', () => {
  const logger = createLogger({ name: 'test', level: 'silent' });
  let server: RunningServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  async function serve(options: { readiness?: ReadinessCheck[]; mount?: (app: Express) => void } = {}) {
    const app = createHttpApp({
      logger,
      readiness: options.readiness ?? [],
      ...(options.mount ? { mount: options.mount } : {}),
    });
    server = await startServer(app);
    return server.url;
  }

  it('serves /health and /ready from the shell (DW-1)', async () => {
    const url = await serve({ readiness: [{ name: 'postgres', check: async () => {} }] });

    const [health, ready] = await Promise.all([fetch(`${url}/health`), fetch(`${url}/ready`)]);

    expect(health.status).toBe(200);
    expect(ready.status).toBe(200);
    expect(((await ready.json()) as { checks: unknown }).checks).toEqual([{ name: 'postgres', ok: true }]);
  });

  it('wires readiness checks so a failing dependency gives 503', async () => {
    const url = await serve({ readiness: [{ name: 'valkey', check: async () => Promise.reject(new Error('down')) }] });

    const res = await fetch(`${url}/ready`);

    expect(res.status).toBe(503);
  });

  it('puts request and correlation ids on every response, errors included (DW-1)', async () => {
    const url = await serve();

    const res = await fetch(`${url}/v1/nope`);

    expect(res.status).toBe(404);
    expect(res.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
    expect(res.headers.get(CORRELATION_ID_HEADER)).toBe(res.headers.get(REQUEST_ID_HEADER));
  });

  it('echoes a caller supplied correlation id', async () => {
    const url = await serve();

    const res = await fetch(`${url}/health`, { headers: { [CORRELATION_ID_HEADER]: 'checkout-42' } });

    expect(res.headers.get(CORRELATION_ID_HEADER)).toBe('checkout-42');
  });

  it('routes mounted by the app run before the 404 fallback', async () => {
    const url = await serve({
      mount: (app) => {
        app.get('/v1/ping', (_req, res) => {
          res.json({ pong: true });
        });
      },
    });

    const res = await fetch(`${url}/v1/ping`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pong: true });
  });

  it('parses JSON bodies for mounted routes', async () => {
    const url = await serve({
      mount: (app) => {
        app.post('/v1/echo', (req, res) => {
          res.json(req.body);
        });
      },
    });

    const res = await fetch(`${url}/v1/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount: 100 }),
    });

    expect(await res.json()).toEqual({ amount: 100 });
  });

  it('rejects a JSON body over 100kb with 413', async () => {
    const url = await serve({
      mount: (app) => {
        app.post('/v1/echo', (_req, res) => {
          res.json({});
        });
      },
    });

    const res = await fetch(`${url}/v1/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blob: 'x'.repeat(110 * 1024) }),
    });

    expect(res.status).toBe(413);
  });

  it('does not advertise Express in x-powered-by', async () => {
    const url = await serve();

    const res = await fetch(`${url}/health`);

    expect(res.headers.get('x-powered-by')).toBeNull();
  });
});
