// Request schemas and response bodies. Bodies are built field by field: every
// bigint leaves as a decimal string and every Date as ISO 8601, so
// JSON.stringify never sees a bigint.
import { z } from 'zod';
import type { Wallet, WalletHistoryPage } from '@payflow/core';

const PG_BIGINT_MAX = 9_223_372_036_854_775_807n;
const CURSOR = /^[1-9][0-9]{0,18}$/;

// Checked here so neither the ledger's plain Error nor a Postgres range error is reachable from a query string.
export const historyQuery = z.object({
  cursor: z
    .string()
    .regex(CURSOR, 'cursor must be a positive integer')
    // Zod runs a refine even after the regex fails, so it must not call BigInt on a non number.
    .refine((value) => !CURSOR.test(value) || BigInt(value) <= PG_BIGINT_MAX, 'cursor is out of range')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const walletBody = (wallet: Wallet) => ({
  id: wallet.id,
  balance: { amount: wallet.balance.amount.toString(), currency: wallet.balance.currency },
});

export const historyBody = (page: WalletHistoryPage) => ({
  currency: page.currency,
  items: page.items.map((item) => ({
    transactionId: item.transactionId,
    kind: item.kind,
    description: item.description,
    amount: item.amount.toString(),
    balanceAfter: item.balanceAfter.toString(),
    createdAt: item.createdAt.toISOString(),
  })),
  nextCursor: page.nextCursor,
});
