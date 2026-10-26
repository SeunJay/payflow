import { Router, type RequestHandler } from 'express';
import type { WalletsController } from './wallets.controller.ts';

/** `GET /wallet` and `GET /wallet/history` under `/v1`, behind the access token check. */
export function walletsRoutes(controller: WalletsController, requireAuth: RequestHandler): Router {
  const router = Router();
  router.get('/wallet', requireAuth, controller.getWallet);
  router.get('/wallet/history', requireAuth, controller.getHistory);
  return router;
}
