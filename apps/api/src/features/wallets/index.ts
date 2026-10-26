import type { Router } from 'express';
import type { FeatureDeps } from '../../deps.ts';
import { requireAuth } from '../../http/middleware/require-auth.ts';
import { createWalletsController } from './wallets.controller.ts';
import { walletsRoutes } from './wallets.routes.ts';
import { createWalletsService } from './wallets.service.ts';

/** `GET /v1/wallet` and `GET /v1/wallet/history`: the caller's balance and history (spec 0004). */
export function walletsFeature(deps: FeatureDeps): Router {
  const service = createWalletsService(deps);
  return walletsRoutes(createWalletsController({ service }), requireAuth(deps.auth));
}
