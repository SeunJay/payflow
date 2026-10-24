import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER, correlationIdOf, genReqId } from './ids.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fakeExchange(headers: IncomingMessage['headers'] = {}) {
  const sent = new Map<string, unknown>();
  const req = { headers } as IncomingMessage;
  const res = {
    setHeader: (name: string, value: unknown) => sent.set(name, value),
    getHeader: (name: string) => sent.get(name),
  } as unknown as ServerResponse;
  return { req, res, sent };
}

describe('genReqId', () => {
  it('makes a fresh UUID and echoes it as both ids when the caller sends none', () => {
    const { req, res, sent } = fakeExchange();

    const id = genReqId(req, res);

    expect(id).toMatch(UUID);
    expect(sent.get(REQUEST_ID_HEADER)).toBe(id);
    expect(sent.get(CORRELATION_ID_HEADER)).toBe(id);
  });

  it('reuses a well formed incoming request id', () => {
    const { req, res, sent } = fakeExchange({ [REQUEST_ID_HEADER]: 'req_abc.123-XYZ' });

    expect(genReqId(req, res)).toBe('req_abc.123-XYZ');
    expect(sent.get(REQUEST_ID_HEADER)).toBe('req_abc.123-XYZ');
  });

  it('keeps an incoming correlation id separate from the request id', () => {
    const { req, res, sent } = fakeExchange({ [CORRELATION_ID_HEADER]: 'corr-1' });

    const id = genReqId(req, res);

    expect(id).toMatch(UUID);
    expect(sent.get(CORRELATION_ID_HEADER)).toBe('corr-1');
  });

  it.each([
    ['spaces', 'not an id'],
    ['a newline (log injection)', 'abc\n{"level":"fatal"}'],
    ['an empty string', ''],
    ['more than 128 characters', 'a'.repeat(129)],
    ['unicode', 'reqé'],
  ])('ignores an incoming id with %s and makes its own', (_label, value) => {
    const { req, res, sent } = fakeExchange({ [REQUEST_ID_HEADER]: value, [CORRELATION_ID_HEADER]: value });

    const id = genReqId(req, res);

    expect(id).toMatch(UUID);
    expect(sent.get(CORRELATION_ID_HEADER)).toBe(id);
  });

  it('accepts an id of exactly 128 characters', () => {
    const value = 'a'.repeat(128);
    const { req, res } = fakeExchange({ [REQUEST_ID_HEADER]: value });

    expect(genReqId(req, res)).toBe(value);
  });

  it('ignores a header sent more than once', () => {
    const { req, res } = fakeExchange({ [REQUEST_ID_HEADER]: ['one', 'two'] as unknown as string });

    expect(genReqId(req, res)).toMatch(UUID);
  });
});

describe('correlationIdOf', () => {
  it('reads back the correlation id genReqId set', () => {
    const { req, res } = fakeExchange({ [CORRELATION_ID_HEADER]: 'corr-9' });
    genReqId(req, res);

    expect(correlationIdOf(res)).toBe('corr-9');
  });

  it('returns undefined before any id is set', () => {
    expect(correlationIdOf(fakeExchange().res)).toBeUndefined();
  });
});
