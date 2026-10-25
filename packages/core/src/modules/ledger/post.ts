// The only writers of ledger transactions and entries (spec 0003, "post
// algorithm"). Everything runs in the caller's read committed unit of work.
import { eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../../infra/tx.ts';
import { alreadyReversed, duplicatePosting, insufficientFunds } from './errors.ts';
import { parse, postInputSchema, reverseInputSchema } from './input.ts';
import { ledgerAccounts, ledgerEntries, ledgerTransactions } from './schema.ts';
import {
  normalSign,
  type JsonObject,
  type PostedEntry,
  type PostedTransaction,
  type TransactionKind,
} from './types.ts';

export type PostInput = {
  readonly postingKey: string;
  readonly kind: TransactionKind;
  readonly description: string;
  readonly metadata?: JsonObject;
  /** Raw signed amounts: positive is a debit, negative a credit. Must sum to zero. */
  readonly entries: readonly { readonly accountId: string; readonly amount: bigint }[];
};

export type ReverseInput = {
  readonly transactionId: string;
  readonly postingKey: string;
  readonly description: string;
};

type Posting = {
  readonly postingKey: string;
  readonly kind: TransactionKind;
  readonly description: string;
  readonly metadata: JsonObject;
  readonly reversesTransactionId: string | null;
  readonly entries: readonly { readonly accountId: string; readonly amount: bigint }[];
};

export async function post(tx: Tx, input: PostInput): Promise<PostedTransaction> {
  await assertReadCommitted(tx);
  const parsed = parse(postInputSchema, input);
  assertShape(parsed.entries);
  await assertKeyUnused(tx, parsed.postingKey);
  return writePosting(tx, {
    postingKey: parsed.postingKey,
    kind: parsed.kind,
    description: parsed.description,
    metadata: parsed.metadata ?? {},
    reversesTransactionId: null,
    entries: parsed.entries,
  });
}

export async function reverse(tx: Tx, input: ReverseInput): Promise<PostedTransaction> {
  await assertReadCommitted(tx);
  const parsed = parse(reverseInputSchema, input);
  await assertKeyUnused(tx, parsed.postingKey);

  // The row lock serialises concurrent reversals of one transaction. It fires no UPDATE trigger.
  const [original] = await tx
    .select()
    .from(ledgerTransactions)
    .where(eq(ledgerTransactions.id, parsed.transactionId))
    .for('update');
  if (!original) throw new Error(`ledger: unknown transaction ${parsed.transactionId}`);
  if (original.kind === 'reversal') throw new Error(`ledger: transaction ${original.id} is a reversal`);

  const [existing] = await tx
    .select({ id: ledgerTransactions.id })
    .from(ledgerTransactions)
    .where(eq(ledgerTransactions.reversesTransactionId, original.id));
  if (existing) throw alreadyReversed(original.id, existing.id);

  const entries = await tx
    .select({ accountId: ledgerEntries.accountId, amount: ledgerEntries.amount })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.transactionId, original.id));

  return writePosting(tx, {
    postingKey: parsed.postingKey,
    kind: 'reversal',
    description: parsed.description,
    metadata: { reversed_posting_key: original.postingKey },
    reversesTransactionId: original.id,
    entries: entries.map((entry) => ({ accountId: entry.accountId, amount: -entry.amount })),
  });
}

async function assertReadCommitted(tx: Tx): Promise<void> {
  const result = await tx.execute<{ level: string }>(sql`select current_setting('transaction_isolation') as level`);
  const level = result.rows[0]?.level;
  if (level !== 'read committed') {
    throw new Error(`ledger: post and reverse need read committed, the unit of work is ${String(level)}`);
  }
}

function assertShape(entries: readonly { accountId: string; amount: bigint }[]): void {
  const ids = new Set(entries.map((entry) => entry.accountId));
  if (ids.size !== entries.length) throw new Error('ledger: an account appears twice in one posting');
  const total = entries.reduce((sum, entry) => sum + entry.amount, 0n);
  if (total !== 0n) throw new Error(`ledger: entries sum to ${String(total)}, not zero`);
}

async function findIdByKey(tx: Tx, postingKey: string): Promise<string | undefined> {
  const [row] = await tx
    .select({ id: ledgerTransactions.id })
    .from(ledgerTransactions)
    .where(eq(ledgerTransactions.postingKey, postingKey));
  return row?.id;
}

// Key first, so replaying a debit that already drained the account still gets 409, not 422.
async function assertKeyUnused(tx: Tx, postingKey: string): Promise<void> {
  const existing = await findIdByKey(tx, postingKey);
  if (existing) throw duplicatePosting(postingKey, existing);
}

async function writePosting(tx: Tx, posting: Posting): Promise<PostedTransaction> {
  const amounts = new Map(posting.entries.map((entry) => [entry.accountId, entry.amount]));
  const amountOf = (accountId: string) => {
    const amount = amounts.get(accountId);
    if (amount === undefined) throw new Error(`ledger: no amount for account ${accountId}`);
    return amount;
  };

  // Lock in id order: two postings touching the same accounts can never deadlock each other.
  const locked = await tx
    .select()
    .from(ledgerAccounts)
    .where(inArray(ledgerAccounts.id, [...amounts.keys()]))
    .orderBy(ledgerAccounts.id)
    .for('update');
  if (locked.length !== amounts.size) throw new Error('ledger: posting names an unknown account');

  const sums = new Map<string, bigint>();
  for (const account of locked) sums.set(account.currency, (sums.get(account.currency) ?? 0n) + amountOf(account.id));
  for (const [currency, sum] of sums) {
    if (sum !== 0n) throw new Error(`ledger: ${currency} entries sum to ${String(sum)}, not zero`);
  }

  const moves = locked.map((account) => {
    const amount = amountOf(account.id);
    const delta = normalSign(account.type) * amount;
    if (!account.allowNegative && account.balance + delta < 0n) throw insufficientFunds(account.id);
    return { account, amount, delta };
  });

  const [transaction] = await tx
    .insert(ledgerTransactions)
    .values({
      postingKey: posting.postingKey,
      kind: posting.kind,
      description: posting.description,
      metadata: posting.metadata,
      reversesTransactionId: posting.reversesTransactionId,
    })
    .onConflictDoNothing({ target: ledgerTransactions.postingKey })
    .returning();
  if (!transaction) {
    // A concurrent post won the key between our check and this insert.
    const winner = await findIdByKey(tx, posting.postingKey);
    if (!winner) throw new Error(`ledger: posting key ${posting.postingKey} conflicted but no row was found`);
    throw duplicatePosting(posting.postingKey, winner);
  }

  const entryRows = [];
  for (const move of moves) {
    const [updated] = await tx
      .update(ledgerAccounts)
      .set({ balance: sql`${ledgerAccounts.balance} + ${move.delta}`, lastSeq: sql`${ledgerAccounts.lastSeq} + 1` })
      .where(eq(ledgerAccounts.id, move.account.id))
      .returning({ balance: ledgerAccounts.balance, lastSeq: ledgerAccounts.lastSeq });
    if (!updated) throw new Error(`ledger: account ${move.account.id} vanished under its lock`);
    entryRows.push({
      transactionId: transaction.id,
      accountId: move.account.id,
      currency: move.account.currency,
      seq: updated.lastSeq,
      amount: move.amount,
      balanceAfter: updated.balance,
    });
  }

  const inserted = await tx
    .insert(ledgerEntries)
    .values(entryRows)
    .returning({ id: ledgerEntries.id, accountId: ledgerEntries.accountId });
  const entryIds = new Map(inserted.map((row) => [row.accountId, row.id]));
  const entries: PostedEntry[] = entryRows.map((row) => {
    const entryId = entryIds.get(row.accountId);
    if (!entryId) throw new Error(`ledger: entry for account ${row.accountId} was not returned`);
    return {
      entryId,
      accountId: row.accountId,
      currency: row.currency,
      amount: row.amount,
      seq: row.seq,
      balanceAfter: row.balanceAfter,
    };
  });

  return {
    id: transaction.id,
    postingKey: transaction.postingKey,
    kind: transaction.kind,
    description: transaction.description,
    metadata: transaction.metadata,
    reversesTransactionId: transaction.reversesTransactionId,
    createdAt: transaction.createdAt,
    entries,
  };
}
