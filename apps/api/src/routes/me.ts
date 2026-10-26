import { Router } from 'express';
import { getUser, unauthenticated } from '@payflow/core';
import type { RouteDeps } from '../deps.ts';
import { authOf, requireAuth } from '../middleware/require-auth.ts';
import { userBody } from '../serialize.ts';

/** `GET /v1/me`: the caller's own user, from the access token's `sub`. */
export function meRouter({ db, auth }: RouteDeps): Router {
  const router = Router();

  router.get('/me', requireAuth(auth), async (_req, res) => {
    // A valid token for a user that is gone (a local reset) is 401, not 500.
    const user = await getUser(db, authOf(res).userId);
    if (!user) throw unauthenticated();
    res.json(userBody(user));
  });

  return router;
}
