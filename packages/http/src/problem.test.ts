import type { Express } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError, createLogger } from '@payflow/shared';
import { startServer, type RunningServer } from '@payflow/test-utils';
import { createHttpApp } from './app.ts';
import { PROBLEM_CONTENT_TYPE } from './problem.ts';

// notFound and problemHandler are exercised through the real app shell, which
// is how every route reaches them.
describe('Problem Details errors', () => {
  const logger = createLogger({ name: 'test', level: 'silent' });
  let server: RunningServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    vi.restoreAllMocks();
  });

  async function serve(mount?: (app: Express) => void) {
    server = await startServer(createHttpApp({ logger, readiness: [], ...(mount ? { mount } : {}) }));
    return server.url;
  }

  it('answers an unknown route with a 404 not_found problem (DW-1)', async () => {
    const url = await serve();

    const res = await fetch(`${url}/v1/nope?x=1`);

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
    expect(await res.json()).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      code: 'not_found',
      detail: 'No route for GET /v1/nope',
      instance: '/v1/nope?x=1',
    });
  });

  it('turns a thrown AppError into its own problem', async () => {
    const url = await serve((app) => {
      app.get('/v1/wallets/:id', () => {
        throw new AppError({ code: 'wallet_not_found', status: 404, title: 'Wallet not found', detail: 'No wallet w_1' });
      });
    });

    const res = await fetch(`${url}/v1/wallets/w_1`);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      type: 'about:blank',
      title: 'Wallet not found',
      status: 404,
      code: 'wallet_not_found',
      detail: 'No wallet w_1',
      instance: '/v1/wallets/w_1',
    });
  });

  it('leaves detail out when the AppError has none', async () => {
    const url = await serve((app) => {
      app.post('/v1/things', () => {
        throw new AppError({ code: 'conflict', status: 409, title: 'Conflict' });
      });
    });

    const body = (await (await fetch(`${url}/v1/things`, { method: 'POST' })).json()) as Record<string, unknown>;

    expect(body).not.toHaveProperty('detail');
    expect(body.code).toBe('conflict');
  });

  it('turns a rejected async handler into a problem too', async () => {
    const url = await serve((app) => {
      app.get('/v1/async', async () => {
        throw new AppError({ code: 'rate_limited', status: 429, title: 'Too Many Requests' });
      });
    });

    const res = await fetch(`${url}/v1/async`);

    expect(res.status).toBe(429);
    expect(((await res.json()) as { code: unknown }).code).toBe('rate_limited');
  });

  it('answers a malformed JSON body with a 400 invalid_body problem', async () => {
    const url = await serve((app) => {
      app.post('/v1/echo', (req, res) => {
        res.json(req.body);
      });
    });

    const res = await fetch(`${url}/v1/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"amount": ',
    });

    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
    expect(await res.json()).toMatchObject({ status: 400, code: 'invalid_body', title: 'Bad Request' });
  });

  it('does not echo the client body back in the bad JSON detail', async () => {
    const url = await serve();

    const res = await fetch(`${url}/v1/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"card": "4242424242424242" oops',
    });

    expect(await res.text()).not.toContain('4242');
  });

  it('answers a body over the size limit with a 413 invalid_body problem, not a 500', async () => {
    const child = createLogger({ name: 'test', level: 'silent' });
    const error = vi.spyOn(child, 'error');
    vi.spyOn(logger, 'child').mockReturnValue(child as never);
    const url = await serve();

    const res = await fetch(`${url}/v1/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blob: 'x'.repeat(110 * 1024) }),
    });

    expect(res.status).toBe(413);
    expect(res.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
    expect(await res.json()).toEqual({
      type: 'about:blank',
      title: 'Payload Too Large',
      status: 413,
      code: 'invalid_body',
      detail: 'request entity too large',
      instance: '/v1/echo',
    });
    expect(error).not.toHaveBeenCalled();
  });

  it('keeps a body parser server error (not exposed) a plain 500 with its message hidden', async () => {
    const url = await serve((app) => {
      app.get('/v1/stream', () => {
        throw Object.assign(new Error('stream encoding should not be set'), { type: 'stream.encoding.set', status: 500, expose: false });
      });
    });

    const res = await fetch(`${url}/v1/stream`);
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toMatchObject({ code: 'internal_error' });
    expect(text).not.toContain('stream encoding');
  });

  it('answers an unsupported body charset with a 415 invalid_body problem, not a 500', async () => {
    const url = await serve();

    const res = await fetch(`${url}/v1/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=klingon' },
      body: '{}',
    });

    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ status: 415, code: 'invalid_body', title: 'Unsupported Media Type' });
  });

  it('hides an unexpected error behind a plain 500 with no internals leaked', async () => {
    const url = await serve((app) => {
      app.get('/v1/boom', () => {
        throw new Error('password=hunter2 at db.ts:42');
      });
    });

    const res = await fetch(`${url}/v1/boom`);
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      code: 'internal_error',
      instance: '/v1/boom',
    });
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('db.ts');
  });

  it('logs the full unexpected error server side', async () => {
    const child = createLogger({ name: 'test', level: 'silent' });
    const error = vi.spyOn(child, 'error');
    vi.spyOn(logger, 'child').mockReturnValue(child as never);
    const url = await serve((app) => {
      app.get('/v1/boom', () => {
        throw new Error('kaboom');
      });
    });

    await fetch(`${url}/v1/boom`);

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.objectContaining({ message: 'kaboom' }) }),
      'unhandled error',
    );
  });
});
