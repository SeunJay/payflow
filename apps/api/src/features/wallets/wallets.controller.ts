import type { RequestHandler } from 'express';
import { validationFailed } from '@payflow/shared';
import { authOf } from '../../http/middleware/require-auth.ts';
import { historyBody, historyQuery, walletBody } from './wallets.schemas.ts';
import type { WalletsService } from './wallets.service.ts';

/** The HTTP side of the caller's wallet and its history. */
export function createWalletsController({ service }: { service: WalletsService }) {
  const getWallet: RequestHandler = async (_req, res) => {
    res.json(walletBody(await service.getMyWallet(authOf(res).userId)));
  };

  const getHistory: RequestHandler = async (req, res) => {
    const query = historyQuery.safeParse(req.query);
    if (!query.success) throw validationFailed(query.error);
    const { cursor, limit } = query.data;

    const page = await service.getMyHistory(authOf(res).userId, {
      ...(cursor === undefined ? {} : { cursor }),
      ...(limit === undefined ? {} : { limit }),
    });
    res.json(historyBody(page));
  };

  return { getWallet, getHistory } as const;
}

/** The wallet handlers `createWalletsController` builds. */
export type WalletsController = ReturnType<typeof createWalletsController>;
