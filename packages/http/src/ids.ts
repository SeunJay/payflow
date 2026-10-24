import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';
export const CORRELATION_ID_HEADER = 'x-correlation-id';

// Accept caller supplied ids only if they look like ids, never arbitrary text in logs.
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

function incoming(req: IncomingMessage, header: string): string | undefined {
  const value = req.headers[header];
  return typeof value === 'string' && SAFE_ID.test(value) ? value : undefined;
}

/**
 * pino-http's genReqId: reuses a valid incoming request id or makes one, and
 * echoes it back. The correlation id defaults to the request id so a chain of
 * calls without one still has something to join on.
 */
export function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const requestId = incoming(req, REQUEST_ID_HEADER) ?? randomUUID();
  const correlationId = incoming(req, CORRELATION_ID_HEADER) ?? requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  res.setHeader(CORRELATION_ID_HEADER, correlationId);
  return requestId;
}

export function correlationIdOf(res: ServerResponse): string | undefined {
  const value = res.getHeader(CORRELATION_ID_HEADER);
  return typeof value === 'string' ? value : undefined;
}
