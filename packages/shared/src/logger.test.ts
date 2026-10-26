import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, serializeErr } from './logger.ts';

const SECRET = 'alice@example.com';

// A stand in for Drizzle's DrizzleQueryError around a pg DatabaseError.
function queryError() {
  const pgError = Object.assign(new Error(`invalid input syntax for type integer: "${SECRET}"`), {
    severity: 'ERROR',
    code: '22P02',
    routine: 'pg_strtoint32_safe',
    detail: `Key (email)=(${SECRET}) already exists.`,
    where: `unnamed portal parameter $1 = '${SECRET}'`,
  });
  return Object.assign(new Error(`Failed query: select $1::int\nparams: ${SECRET}`, { cause: pgError }), {
    query: 'select $1::int',
    params: [SECRET],
  });
}

function capture() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { lines, logger: createLogger({ name: 'test', level: 'info', destination }) };
}

describe('createLogger (AC-14)', () => {
  it('redacts the cookie, set-cookie, and authorization headers', () => {
    const { lines, logger } = capture();

    logger.info(
      {
        req: { headers: { cookie: 'payflow_access=jwt', authorization: 'Bearer jwt' } },
        res: { headers: { 'set-cookie': ['payflow_refresh=secret'] } },
      },
      'request completed',
    );

    const line = lines.join('');
    expect(line).not.toContain('jwt');
    expect(line).not.toContain('secret');
    expect(JSON.parse(line)).toMatchObject({
      req: { headers: { cookie: '[Redacted]', authorization: '[Redacted]' } },
      res: { headers: { 'set-cookie': '[Redacted]' } },
    });
  });

  it('logs a failed query with no SQL text, parameters, or quoted values, keeping the SQLSTATE', () => {
    const { lines, logger } = capture();

    logger.error({ err: queryError() }, 'unhandled error');

    const line = lines.join('');
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain('select $1');
    expect(JSON.parse(line)).toMatchObject({
      err: { type: 'Error', cause: { code: '22P02', routine: 'pg_strtoint32_safe' } },
    });
  });

  it('scrubs a database error nested under an ordinary one but keeps the outer message', () => {
    const wrapped = new Error('sign up failed', { cause: queryError() });

    const out = JSON.stringify(serializeErr(wrapped));

    expect(out).not.toContain(SECRET);
    expect(out).toContain('sign up failed');
  });

  it('serializes an ordinary error the usual pino way', () => {
    const err = new Error('boom', { cause: new Error('underneath') });

    expect(serializeErr(err)).toMatchObject({ type: 'Error', message: 'boom: underneath' });
  });

  it('scrubs the pino serialized form pino-http hands a custom serializer, using its raw error', () => {
    const wrapped = { type: 'DrizzleQueryError', message: `Failed query params: ${SECRET}`, raw: queryError() };

    expect(JSON.stringify(serializeErr(wrapped))).not.toContain(SECRET);
  });

  it('passes a non error through untouched', () => {
    expect(serializeErr('just text')).toBe('just text');
  });
});
