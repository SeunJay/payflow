import { pino, type DestinationStream, type Logger, type LevelWithSilent } from 'pino';

export type { Logger };

// Headers that carry credentials. pino-http logs requests and responses through child loggers, so this covers them.
const REDACT_PATHS = ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'];

// Safe to keep from a database error: they name the failure, never a value.
const SAFE_DB_FIELDS = ['code', 'severity', 'routine', 'schema', 'table', 'column', 'constraint'] as const;

/** `destination` defaults to stdout; tests pass a stream to read the lines back. */
export function createLogger(options: {
  name: string;
  level: LevelWithSilent;
  destination?: DestinationStream;
}): Logger {
  return pino(
    {
      name: options.name,
      level: options.level,
      redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
      serializers: { err: serializeErr },
    },
    options.destination,
  );
}

/**
 * pino's own `err` serializer, unless the error or one of its causes is a
 * database error. Drizzle's query error puts the SQL and its parameters in its
 * message, and pg's message and `detail` can quote a value (an email, a hash),
 * while pino joins every cause's message into the top one. Those errors keep
 * only their stack frames and the fields that name the failure.
 */
export function serializeErr(err: unknown): unknown {
  // pino-http wraps a custom serializer: it gets pino's serialized error with the original on `raw`.
  const source = err instanceof Error ? err : rawOf(err);
  if (!source) return err;
  if (!touchesDatabase(source)) return err instanceof Error ? pino.stdSerializers.err(err) : err;
  return scrub(source, 0);
}

function rawOf(value: unknown): Error | undefined {
  if (typeof value !== 'object' || value === null || !('raw' in value)) return undefined;
  return value.raw instanceof Error ? value.raw : undefined;
}

const MAX_DEPTH = 10;

// Drizzle's DrizzleQueryError carries `query` and `params`; pg's DatabaseError carries `severity` and `code`.
const isDatabaseError = (err: Error) => 'query' in err || 'params' in err || ('severity' in err && 'code' in err);

function touchesDatabase(err: Error): boolean {
  let current: unknown = err;
  for (let depth = 0; current instanceof Error && depth < MAX_DEPTH; depth++) {
    if (isDatabaseError(current)) return true;
    current = current.cause;
  }
  return false;
}

function scrub(err: Error, depth: number): Record<string, unknown> {
  const sensitive = isDatabaseError(err);
  const out: Record<string, unknown> = {
    type: err.constructor.name,
    message: sensitive ? 'database error (message, SQL, and parameters not logged)' : err.message,
    stack: sensitive ? framesOf(err.stack) : err.stack,
  };
  const fields = err as unknown as Record<string, unknown>;
  const keep = sensitive ? SAFE_DB_FIELDS : (['code'] as const);
  for (const key of keep) {
    if (typeof fields[key] === 'string') out[key] = fields[key];
  }
  if (err.cause instanceof Error && depth < MAX_DEPTH) out.cause = scrub(err.cause, depth + 1);
  return out;
}

// The stack's first line repeats the message; the frames after it are safe.
const framesOf = (stack: string | undefined) =>
  (stack ?? '')
    .split('\n')
    .filter((line) => line.trimStart().startsWith('at '))
    .join('\n');
