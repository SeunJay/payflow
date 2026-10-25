import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { AppError, createLogger } from '@payflow/shared';
import { createTestDatabase, type TestDatabase } from '@payflow/test-utils';
import { createDb, type DbHandle } from '../../infra/db.ts';
import { withTx } from '../../infra/tx.ts';
import { getBalance, getSystemAccount } from './accounts.ts';
import { reverse } from './post.ts';
import { ledgerTransactions } from './schema.ts';
import { fund, holdOpen, openWallet, transfer, waitForLockWaiters } from './test-support.ts';

describe('ledger reverse (AC-8)', () => {
  let database: TestDatabase;
  let handle: DbHandle;
  let db: DbHandle['db'];

  beforeAll(async () => {
    database = await createTestDatabase();
    handle = createDb({ url: database.url, logger: createLogger({ name: 'test', level: 'silent' }) });
    db = handle.db;
  });

  afterAll(async () => {
    await handle.close();
    await database.drop();
  });

  const reverseOf = (transactionId: string, postingKey = `reversal:${randomUUID()}`) =>
    withTx(db, (tx) => reverse(tx, { transactionId, postingKey, description: 'Reverse test deposit' }));

  const reversalsOf = (transactionId: string) =>
    db.select().from(ledgerTransactions).where(eq(ledgerTransactions.reversesTransactionId, transactionId));

  it('posts the exact negation and restores both balances', async () => {
    const wallet = await openWallet(db);
    const fundingBefore = await getSystemAccount(db, 'test_funding');
    const original = await fund(db, wallet.id, 700n);

    const reversal = await reverseOf(original.id);

    expect(reversal).toMatchObject({
      kind: 'reversal',
      reversesTransactionId: original.id,
      description: 'Reverse test deposit',
      metadata: { reversed_posting_key: original.postingKey },
    });
    expect(reversal.entries.map((e) => [e.accountId, e.amount])).toEqual(
      original.entries.map((e) => [e.accountId, -e.amount]),
    );
    expect(reversal.entries.find((e) => e.accountId === wallet.id)).toMatchObject({ seq: 2n, balanceAfter: 0n });
    expect((await getBalance(db, wallet.id)).balance).toBe(0n);
    expect((await getSystemAccount(db, 'test_funding')).balance).toBe(fundingBefore.balance);
  });

  it('rejects a replay of the same reversal key with duplicate_posting', async () => {
    const wallet = await openWallet(db);
    const original = await fund(db, wallet.id, 100n);
    const key = `reversal:${randomUUID()}`;
    const first = await reverseOf(original.id, key);

    await expect(reverseOf(original.id, key)).rejects.toMatchObject({
      code: 'duplicate_posting',
      detail: `Posting key ${key} already used by ledger transaction ${first.id}`,
    });
  });

  it('rejects a second reversal under a new key with already_reversed', async () => {
    const wallet = await openWallet(db);
    const original = await fund(db, wallet.id, 100n);
    const first = await reverseOf(original.id);

    await expect(reverseOf(original.id)).rejects.toMatchObject({
      code: 'already_reversed',
      status: 409,
      detail: `Ledger transaction ${original.id} was already reversed by ${first.id}`,
    });
  });

  it('lets exactly one of two concurrent reversals succeed', async () => {
    const wallet = await openWallet(db);
    const original = await fund(db, wallet.id, 100n);

    const first = holdOpen(db, (tx) =>
      reverse(tx, { transactionId: original.id, postingKey: `reversal:${randomUUID()}`, description: 'first' }),
    );
    const winner = await first.worked;
    const second = reverseOf(original.id);
    await waitForLockWaiters(db, 1);
    await first.commit();

    await expect(second).rejects.toMatchObject({
      code: 'already_reversed',
      detail: `Ledger transaction ${original.id} was already reversed by ${winner.id}`,
    });
    expect(await reversalsOf(original.id)).toHaveLength(1);
    expect((await getBalance(db, wallet.id)).balance).toBe(0n);
  });

  it('treats reversing a reversal as a bug (plain Error)', async () => {
    const wallet = await openWallet(db);
    const original = await fund(db, wallet.id, 100n);
    const reversal = await reverseOf(original.id);

    const err: unknown = await reverseOf(reversal.id).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AppError);
    expect((err as Error).message).toMatch(/is a reversal/);
  });

  it('treats an unknown transaction id as a bug (plain Error)', async () => {
    const err: unknown = await reverseOf(randomUUID()).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AppError);
  });

  it('refuses a reversal that would overdraw with insufficient_funds', async () => {
    const wallet = await openWallet(db);
    const payee = await openWallet(db);
    const deposit = await fund(db, wallet.id, 100n);
    await transfer(db, wallet.id, payee.id, 100n);

    await expect(reverseOf(deposit.id)).rejects.toMatchObject({ code: 'insufficient_funds', status: 422 });
    expect(await reversalsOf(deposit.id)).toHaveLength(0);
  });
});
