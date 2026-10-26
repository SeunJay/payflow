// Session cookies (spec 0004, "Cookies"). Clearing must repeat the path and
// flags a cookie was set with, or browsers keep it.
import type { CookieOptions, Request, Response } from 'express';
import type { IssuedTokens } from '@payflow/core';

export const ACCESS_COOKIE = 'payflow_access';
export const REFRESH_COOKIE = 'payflow_refresh';

const ACCESS_PATH = '/v1';
// The refresh token never travels to the wallet routes.
const REFRESH_PATH = '/v1/auth';

const flags = (secure: boolean): CookieOptions => ({ httpOnly: true, sameSite: 'strict', secure });

// The access cookie outlives its JWT on purpose, so an expired JWT still arrives and earns `token_expired`.
export function setSessionCookies(res: Response, tokens: IssuedTokens, secure: boolean): void {
  res.set('Cache-Control', 'no-store');
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...flags(secure),
    path: ACCESS_PATH,
    expires: tokens.refreshExpiresAt,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...flags(secure),
    path: REFRESH_PATH,
    expires: tokens.refreshExpiresAt,
  });
}

export function clearSessionCookies(res: Response, secure: boolean): void {
  res.set('Cache-Control', 'no-store');
  res.clearCookie(ACCESS_COOKIE, { ...flags(secure), path: ACCESS_PATH });
  res.clearCookie(REFRESH_COOKIE, { ...flags(secure), path: REFRESH_PATH });
}

/** A cookie's value when it is a plain string (cookie-parser can also hand back JSON values). */
export function cookieOf(req: Request, name: string): string | undefined {
  const value: unknown = (req.cookies as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : undefined;
}
