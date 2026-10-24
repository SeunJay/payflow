import { STATUS_CODES } from 'node:http';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '@payflow/shared';

/** RFC 9457 Problem Details plus the stable `code` field clients branch on. */
export type Problem = {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance?: string;
};

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export const notFound: RequestHandler = (req, _res, next) => {
  next(new AppError({ code: 'not_found', status: 404, title: 'Not Found', detail: `No route for ${req.method} ${req.path}` }));
};

/**
 * Last middleware. AppErrors become their own problem; anything else is a 500
 * with no internals leaked (the log keeps the full error).
 */
export const problemHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let problem: Problem;
  if (err instanceof AppError) {
    problem = { type: 'about:blank', title: err.message, status: err.status, code: err.code };
    if (err.detail !== undefined) problem.detail = err.detail;
  } else if (isBodyParserError(err)) {
    // A JSON parse message can quote the client's body, so it gets fixed text.
    const detail = err.type === 'entity.parse.failed' ? 'Request body is not valid JSON' : err.message;
    problem = { type: 'about:blank', title: STATUS_CODES[err.status] ?? 'Bad Request', status: err.status, code: 'invalid_body', detail };
  } else {
    req.log.error({ err }, 'unhandled error');
    problem = { type: 'about:blank', title: 'Internal Server Error', status: 500, code: 'internal_error' };
  }
  problem.instance = req.originalUrl;
  res.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(problem);
};

type BodyParserError = { type: string; status: number; message: string; expose: true };

// body-parser marks every client error (bad JSON, too large, bad charset) with a
// string `type`, a 4xx `status`, and `expose: true` (its message is safe to show).
function isBodyParserError(err: unknown): err is BodyParserError {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Partial<Record<keyof BodyParserError, unknown>>;
  return typeof e.type === 'string' && e.expose === true && typeof e.status === 'number' && e.status >= 400 && e.status < 500;
}
