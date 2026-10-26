import type { RequestHandler } from 'express';
import { AppError } from '@payflow/shared';

const unsupportedMediaType = () =>
  new AppError({
    code: 'unsupported_media_type',
    status: 415,
    title: 'Unsupported media type',
    detail: 'Content-Type must be application/json',
  });

/**
 * Every `POST` must say `application/json`, body or not. With `SameSite=Strict`
 * and no CORS this is the CSRF defence: a cross site form cannot send that
 * type without a preflight. It reads the header itself because `req.is()`
 * returns null for a request with no body.
 */
export const requireJson: RequestHandler = (req, _res, next) => {
  if (req.method !== 'POST') {
    next();
    return;
  }
  const mediaType = (req.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') throw unsupportedMediaType();
  next();
};
