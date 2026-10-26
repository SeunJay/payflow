import { eq } from 'drizzle-orm';
import type { Db } from '../../infra/db.ts';
import type { Tx } from '../../infra/tx.ts';
import {
  getBalance,
  getSystemAccount,
  listEntries,
  openAccount,
  post,
  type Currency,
  type TransactionKind,
} from '../ledger/index.ts';
import { ledgerAccounts } from '../ledger/schema.ts';
import { wallets } from './schema.ts';

/** ₦10,000 in kobo, posted into every new wallet at sign up. */
export const SIGN_UP_TEST_DEPOSIT = 1_000_000n;

export type Wallet = {
  readonly id: string;
  readonly balance: { readonly amount: bigint; readonly currency: Currency };
};

export type WalletHistoryItem = {
  readonly transactionId: string;
  readonly kind: TransactionKind;
  readonly description: string;
  readonly amount: bigint;
  readonly balanceAfter: bigint;
  readonly createdAt: Date;
};

export type WalletHistoryPage = {
  readonly currency: Currency;
  readonly items: readonly WalletHistoryItem[];
  readonly nextCursor: string | null;
};

/**
 * Opens the user's wallet account and posts the sign up test deposit. Before
 * `post` it writes only brand new rows, so the ledger's locks cannot deadlock.
 */
export async function openWallet(tx: Tx, userId: string): Promise<Wallet> {
  const account = await openAccount(tx, { type: 'liability', currency: 'NGN' });
  const [wallet] = await tx
    .insert(wallets)
    .values({ userId, ledgerAccountId: account.id })
    .returning({ id: wallets.id });
  if (!wallet) throw new Error('wallets: wallet insert returned no row');

  const testFunding = await getSystemAccount(tx, 'test_funding');
  const posted = await post(tx, {
    postingKey: `test_deposit:${userId}`,
    kind: 'test_deposit',
    description: 'Sign up test deposit',
    entries: [
      { accountId: testFunding.id, amount: SIGN_UP_TEST_DEPOSIT },
      { accountId: account.id, amount: -SIGN_UP_TEST_DEPOSIT },
    ],
  });
  // Found by id, never by position.
  const entry = posted.entries.find((e) => e.accountId === account.id);
  if (!entry) throw new Error(`wallets: no entry for wallet account ${account.id}`);
  return { id: wallet.id, balance: { amount: entry.balanceAfter, currency: account.currency } };
}

export async function getWallet(db: Db | Tx, userId: string): Promise<Wallet | null> {
  const [wallet] = await db
    .select({ id: wallets.id, ledgerAccountId: wallets.ledgerAccountId })
    .from(wallets)
    .where(eq(wallets.userId, userId));
  if (!wallet) return null;
  const { balance, currency } = await getBalance(db, wallet.ledgerAccountId);
  return { id: wallet.id, balance: { amount: balance, currency } };
}

export async function listWalletHistory(
  db: Db | Tx,
  userId: string,
  page: { readonly cursor?: string; readonly limit?: number },
): Promise<WalletHistoryPage | null> {
  const [wallet] = await db
    .select({ accountId: wallets.ledgerAccountId, currency: ledgerAccounts.currency })
    .from(wallets)
    .innerJoin(ledgerAccounts, eq(wallets.ledgerAccountId, ledgerAccounts.id))
    .where(eq(wallets.userId, userId));
  if (!wallet) return null;

  const entries = await listEntries(db, wallet.accountId, page);
  return {
    currency: wallet.currency,
    items: entries.items.map((e) => ({
      transactionId: e.transactionId,
      kind: e.kind,
      description: e.description,
      amount: e.amount,
      balanceAfter: e.balanceAfter,
      createdAt: e.createdAt,
    })),
    nextCursor: entries.nextCursor,
  };
}
