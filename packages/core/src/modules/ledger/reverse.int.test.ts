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

  it('answers a concurrent replay of the same reversal key with duplicate_posting, not already_reversed', async () => {
    const wallet = await openWallet(db);
    const original = await fund(db, wallet.id, 100n);
    const key = `reversal:${randomUUID()}`;

    const first = holdOpen(db, (tx) =>
      reverse(tx, { transactionId: original.id, postingKey: key, description: 'first' }),
    );
    const winner = await first.worked;
    const replay = reverseOf(original.id, key);
    await waitForLockWaiters(db, 1);
    await first.commit();

    await expect(replay).rejects.toMatchObject({
      code: 'duplicate_posting',
      detail: `Posting key ${key} already used by ledger transaction ${winner.id}`,
    });
    expect(await reversalsOf(original.id)).toHaveLength(1);
  });

  it('lets a concurrent replay of a reversal key go ahead when the first reversal rolls back', async () => {
    const wallet = await openWallet(db);
    const original = await fund(db, wallet.id, 100n);
    const key = `reversal:${randomUUID()}`;

    const first = holdOpen(db, (tx) =>
      reverse(tx, { transactionId: original.id, postingKey: key, description: 'first' }),
    );
    await first.worked;
    const replay = reverseOf(original.id, key);
    await waitForLockWaiters(db, 1);
    await first.rollback();

    const reversal = await replay;
    expect(reversal.reversesTransactionId).toBe(original.id);
    expect((await reversalsOf(original.id)).map((row) => row.id)).toEqual([reversal.id]);
    expect((await getBalance(db, wallet.id)).balance).toBe(0n);
  });

  it('answers a used key with 409 even when the transaction id is unknown, because the key is checked first', async () => {
    const wallet = await openWallet(db);
    const deposit = await fund(db, wallet.id, 100n);

    await expect(reverseOf(randomUUID(), deposit.postingKey)).rejects.toMatchObject({
      code: 'duplicate_posting',
      detail: `Posting key ${deposit.postingKey} already used by ledger transaction ${deposit.id}`,
    });
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

  it('rejects a call made above read committed with a plain Error and writes nothing (AC-2)', async () => {
    const wallet = await openWallet(db);
    const original = await fund(db, wallet.id, 100n);

    const attempt = withTx(
      db,
      (tx) => reverse(tx, { transactionId: original.id, postingKey: `reversal:${randomUUID()}`, description: 'd' }),
      { isolationLevel: 'repeatable read' },
    );

    const err: unknown = await attempt.catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(AppError);
    expect((err as Error).message).toMatch(/read committed/);
    expect(await reversalsOf(original.id)).toHaveLength(0);
  });

  it.each([
    ['a non uuid transaction id', () => ({ transactionId: 'nope' })],
    ['a blank posting key', () => ({ postingKey: '  ' })],
    ['a posting key over 200 characters', () => ({ postingKey: 'k'.repeat(201) })],
    ['a blank description', () => ({ description: '' })],
  ])('rejects %s with a plain Error and writes nothing (AC-2)', async (_name, override) => {
    const wallet = await openWallet(db);
    const original = await fund(db, wallet.id, 100n);

    const attempt = withTx(db, (tx) =>
      reverse(tx, {
        transactionId: original.id,
        postingKey: `reversal:${randomUUID()}`,
        description: 'Reverse test deposit',
        ...override(),
      }),
    );

    const err: unknown = await attempt.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AppError);
    expect(await reversalsOf(original.id)).toHaveLength(0);
    expect((await getBalance(db, wallet.id)).balance).toBe(100n);
  });

  it('accepts an upper case transaction id', async () => {
    const wallet = await openWallet(db);
    const original = await fund(db, wallet.id, 100n);

    const reversal = await reverseOf(original.id.toUpperCase());

    expect(reversal.reversesTransactionId).toBe(original.id);
  });

  it('reverses a transfer between two wallets, restoring both', async () => {
    const from = await openWallet(db);
    const to = await openWallet(db);
    await fund(db, from.id, 100n);
    const moved = await transfer(db, from.id, to.id, 60n);

    await reverseOf(moved.id);

    expect((await getBalance(db, from.id)).balance).toBe(100n);
    expect((await getBalance(db, to.id)).balance).toBe(0n);
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
