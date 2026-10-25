import { and, desc, eq, lt } from 'drizzle-orm';
import type { Db } from '../../infra/db.ts';
import type { Tx } from '../../infra/tx.ts';
import { accountIdSchema, pageSchema, parse } from './input.ts';
import { ledgerAccounts, ledgerEntries, ledgerTransactions } from './schema.ts';
import { normalSign, type EntryView } from './types.ts';

export type EntryPage = {
  readonly items: readonly EntryView[];
  /** The `seq` of the last item as a decimal string, or null on the last page. */
  readonly nextCursor: string | null;
};

export async function listEntries(
  db: Db | Tx,
  accountId: string,
  page: { readonly cursor?: string; readonly limit?: number } = {},
): Promise<EntryPage> {
  const id = parse(accountIdSchema, accountId);
  const { cursor, limit } = parse(pageSchema, page);

  const [account] = await db
    .select({ type: ledgerAccounts.type })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.id, id));
  if (!account) throw new Error(`ledger: unknown account ${id}`);
  const sign = normalSign(account.type);

  // One row past the page tells us whether another page exists, so there is no empty trailing page.
  const rows = await db
    .select({
      entryId: ledgerEntries.id,
      transactionId: ledgerEntries.transactionId,
      seq: ledgerEntries.seq,
      amount: ledgerEntries.amount,
      balanceAfter: ledgerEntries.balanceAfter,
      kind: ledgerTransactions.kind,
      description: ledgerTransactions.description,
      createdAt: ledgerTransactions.createdAt,
    })
    .from(ledgerEntries)
    .innerJoin(ledgerTransactions, eq(ledgerEntries.transactionId, ledgerTransactions.id))
    .where(and(eq(ledgerEntries.accountId, id), cursor === undefined ? undefined : lt(ledgerEntries.seq, cursor)))
    .orderBy(desc(ledgerEntries.seq))
    .limit(limit + 1);

  const items = rows.slice(0, limit).map((row) => ({ ...row, amount: sign * row.amount }));
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? last.seq.toString() : null };
}
