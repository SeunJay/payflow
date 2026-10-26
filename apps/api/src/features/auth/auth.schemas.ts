// Response bodies, built field by field: every bigint leaves as a decimal
// string and every Date as ISO 8601, so JSON.stringify never sees a bigint.
import type { IssuedTokens, User, Wallet } from '@payflow/core';

export const userBody = (user: User) => ({ id: user.id, email: user.email, createdAt: user.createdAt.toISOString() });

export const walletBody = (wallet: Wallet) => ({
  id: wallet.id,
  balance: { amount: wallet.balance.amount.toString(), currency: wallet.balance.currency },
});

// No token in the body: they travel only in HttpOnly cookies.
export const sessionBody = (tokens: IssuedTokens) => ({
  user: { id: tokens.user.id, email: tokens.user.email },
  accessExpiresAt: tokens.accessExpiresAt.toISOString(),
  refreshExpiresAt: tokens.refreshExpiresAt.toISOString(),
});
