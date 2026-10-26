import type { RequestHandler, Response } from 'express';
import { authenticate, type AuthContext, type AuthContextOfRequest } from '@payflow/core';
import { ACCESS_COOKIE, cookieOf } from '../cookies.ts';

const AUTH_KEY = 'auth';

const setAuth = (res: Response, caller: AuthContextOfRequest) => {
  res.locals[AUTH_KEY] = caller;
};

/** The caller `requireAuth` verified. Only valid on a route mounted behind it. */
export function authOf(res: Response): AuthContextOfRequest {
  const caller = res.locals[AUTH_KEY] as AuthContextOfRequest | undefined;
  if (!caller) throw new Error('authOf called on a route without requireAuth');
  return caller;
}

/** Checks the access cookie (never an `Authorization` header) and binds `user_id` to the request logs. */
export const requireAuth =
  (auth: AuthContext): RequestHandler =>
  (req, res, next) => {
    const caller = authenticate(auth, cookieOf(req, ACCESS_COOKIE));
    setAuth(res, caller);
    req.log = req.log.child({ user_id: caller.userId });
    next();
  };
