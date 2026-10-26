import { getWallet, listWalletHistory, unauthenticated } from '@payflow/core';
import type { FeatureDeps } from '../../deps.ts';

/**
 * Wallet use cases. The wallet is always the one for the caller's user id;
 * no use case takes a wallet id from the client.
 */
export function createWalletsService({ db }: Pick<FeatureDeps, 'db'>) {
  return {
    // A valid token whose wallet is gone (a local reset) is 401, not 500.
    getMyWallet: async (userId: string) => {
      const wallet = await getWallet(db, userId);
      if (!wallet) throw unauthenticated();
      return wallet;
    },
    getMyHistory: async (userId: string, page: { readonly cursor?: string; readonly limit?: number }) => {
      const history = await listWalletHistory(db, userId, page);
      if (!history) throw unauthenticated();
      return history;
    },
  } as const;
}

/** The wallet use cases `createWalletsService` builds. */
export type WalletsService = ReturnType<typeof createWalletsService>;
