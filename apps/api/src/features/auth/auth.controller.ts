import type { RequestHandler } from 'express';
import { REFRESH_COOKIE, clearSessionCookies, cookieOf, setSessionCookies } from '../../http/cookies.ts';
import { sessionBody, userBody, walletBody } from './auth.schemas.ts';
import { invalidRefresh, type AuthService } from './auth.service.ts';

/** The HTTP side of auth. Logs carry ids, never the email or a token. */
export function createAuthController({ service, cookieSecure }: { service: AuthService; cookieSecure: boolean }) {
  const signUp: RequestHandler = async (req, res) => {
    const { user, wallet } = await service.signUp(req.body);
    req.log.info({ user_id: user.id }, 'user signed up');
    res.status(201).json({ user: userBody(user), wallet: walletBody(wallet) });
  };

  const logIn: RequestHandler = async (req, res) => {
    const tokens = await service.logIn(req.body);
    req.log.info({ user_id: tokens.user.id, session_id: tokens.sessionId }, 'session created');
    setSessionCookies(res, tokens, cookieSecure);
    res.json(sessionBody(tokens));
  };

  const refresh: RequestHandler = async (req, res) => {
    const result = await service.refresh(cookieOf(req, REFRESH_COOKIE));
    if (result.ok) {
      req.log.info({ user_id: result.tokens.user.id, session_id: result.tokens.sessionId }, 'session refreshed');
      setSessionCookies(res, result.tokens, cookieSecure);
      res.json(sessionBody(result.tokens));
      return;
    }
    if (result.reason === 'reuse_detected') {
      req.log.warn({ user_id: result.userId, session_id: result.sessionId }, 'refresh token reuse detected');
    } else {
      req.log.info({ reason: result.reason }, 'refresh rejected');
    }
    clearSessionCookies(res, cookieSecure);
    throw invalidRefresh();
  };

  const logOut: RequestHandler = async (req, res) => {
    const result = await service.logOut(cookieOf(req, REFRESH_COOKIE));
    if (result.revoked) req.log.info({ session_id: result.sessionId, reason: result.reason }, 'session revoked');
    clearSessionCookies(res, cookieSecure);
    res.status(204).end();
  };

  return { signUp, logIn, refresh, logOut } as const;
}

/** The auth handlers `createAuthController` builds. */
export type AuthController = ReturnType<typeof createAuthController>;
