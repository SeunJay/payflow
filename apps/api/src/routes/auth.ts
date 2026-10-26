import { Router } from 'express';
import {
  createSession,
  endSession,
  invalidRefresh,
  openWallet,
  prepareSignUp,
  refreshSession,
  registerUser,
  verifyCredentials,
  withTx,
} from '@payflow/core';
import { REFRESH_COOKIE, clearSessionCookies, cookieOf, setSessionCookies } from '../cookies.ts';
import type { RouteDeps } from '../deps.ts';
import { requireJson } from '../middleware/require-json.ts';
import { sessionBody, userBody, walletBody } from '../serialize.ts';

/** `/v1/auth`: sign up, log in, refresh, log out. Logs carry ids, never the email or a token. */
export function authRouter({ db, auth, cookieSecure }: RouteDeps): Router {
  const router = Router();
  router.use(requireJson);

  router.post('/signup', async (req, res) => {
    // The hash is computed before the unit of work opens.
    const prepared = await prepareSignUp(auth, req.body);
    const { user, wallet } = await withTx(db, async (tx) => {
      const user = await registerUser(tx, prepared);
      return { user, wallet: await openWallet(tx, user.id) };
    });
    req.log.info({ user_id: user.id }, 'user signed up');
    res.status(201).json({ user: userBody(user), wallet: walletBody(wallet) });
  });

  router.post('/login', async (req, res) => {
    const user = await verifyCredentials(db, auth, req.body);
    const tokens = await withTx(db, (tx) => createSession(tx, auth, user.id));
    req.log.info({ user_id: user.id, session_id: tokens.sessionId }, 'session created');
    setSessionCookies(res, tokens, cookieSecure);
    res.json(sessionBody(tokens));
  });

  router.post('/refresh', async (req, res) => {
    // Commits first: a reuse revoke must stick even though the answer is 401.
    const result = await withTx(db, (tx) => refreshSession(tx, auth, cookieOf(req, REFRESH_COOKIE)));
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
  });

  router.post('/logout', async (req, res) => {
    const result = await withTx(db, (tx) => endSession(tx, cookieOf(req, REFRESH_COOKIE)));
    if (result.revoked) req.log.info({ session_id: result.sessionId, reason: result.reason }, 'session revoked');
    clearSessionCookies(res, cookieSecure);
    res.status(204).end();
  });

  return router;
}
