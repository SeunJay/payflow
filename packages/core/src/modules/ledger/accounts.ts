import { eq } from 'drizzle-orm';
import type { Db } from '../../infra/db.ts';
import type { Tx } from '../../infra/tx.ts';
import { accountIdSchema, parse } from './input.ts';
import { ledgerAccounts } from './schema.ts';
import type { AccountType, Currency, LedgerAccount, SystemAccountCode } from './types.ts';

export type OpenAccountInput = {
  readonly type: AccountType;
  readonly currency: Currency;
  /** Set only on system accounts. */
  readonly code?: string;
  /** True requires `code`: only system accounts may go negative. */
  readonly allowNegative?: boolean;
};

export async function openAccount(tx: Tx, input: OpenAccountInput): Promise<LedgerAccount> {
  const [account] = await tx
    .insert(ledgerAccounts)
    .values({
      type: input.type,
      currency: input.currency,
      code: input.code ?? null,
      allowNegative: input.allowNegative ?? false,
    })
    .returning();
  if (!account) throw new Error('ledger: account insert returned no row');
  return account;
}

export async function getSystemAccount(db: Db | Tx, code: SystemAccountCode): Promise<LedgerAccount> {
  const [account] = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.code, code));
  if (!account) throw new Error(`ledger: system account ${code} is missing (run the migrations)`);
  return account;
}

export async function getBalance(
  db: Db | Tx,
  accountId: string,
): Promise<{ accountId: string; currency: Currency; balance: bigint }> {
  const id = parse(accountIdSchema, accountId);
  const [row] = await db
    .select({ accountId: ledgerAccounts.id, currency: ledgerAccounts.currency, balance: ledgerAccounts.balance })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.id, id));
  if (!row) throw new Error(`ledger: unknown account ${id}`);
  return row;
}
