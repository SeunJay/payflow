import { Router } from 'express';
import { z } from 'zod';
import { getWallet, listWalletHistory, unauthenticated } from '@payflow/core';
import { validationFailed } from '@payflow/shared';
import type { RouteDeps } from '../deps.ts';
import { authOf, requireAuth } from '../middleware/require-auth.ts';
import { historyBody, walletBody } from '../serialize.ts';

const PG_BIGINT_MAX = 9_223_372_036_854_775_807n;
const CURSOR = /^[1-9][0-9]{0,18}$/;

// Checked here so neither the ledger's plain Error nor a Postgres range error is reachable from a query string.
const historyQuery = z.object({
  cursor: z
    .string()
    .regex(CURSOR, 'cursor must be a positive integer')
    // Zod runs a refine even after the regex fails, so it must not call BigInt on a non number.
    .refine((value) => !CURSOR.test(value) || BigInt(value) <= PG_BIGINT_MAX, 'cursor is out of range')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/**
 * `GET /v1/wallet` and `GET /v1/wallet/history`. The wallet is always the one
 * for the token's `sub`; no route takes a wallet or user id from the client.
 */
export function walletRouter({ db, auth }: RouteDeps): Router {
  const router = Router();

  router.get('/wallet', requireAuth(auth), async (_req, res) => {
    const wallet = await getWallet(db, authOf(res).userId);
    if (!wallet) throw unauthenticated();
    res.json(walletBody(wallet));
  });

  router.get('/wallet/history', requireAuth(auth), async (req, res) => {
    const query = historyQuery.safeParse(req.query);
    if (!query.success) throw validationFailed(query.error);
    const { cursor, limit } = query.data;

    const page = await listWalletHistory(db, authOf(res).userId, {
      ...(cursor === undefined ? {} : { cursor }),
      ...(limit === undefined ? {} : { limit }),
    });
    if (!page) throw unauthenticated();
    res.json(historyBody(page));
  });

  return router;
}
