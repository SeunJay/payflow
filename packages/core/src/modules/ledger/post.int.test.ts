import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { AppError, createLogger } from '@payflow/shared';
import { createTestDatabase, type TestDatabase } from '@payflow/test-utils';
import { createDb, type DbHandle } from '../../infra/db.ts';
import { withTx } from '../../infra/tx.ts';
import { getBalance, getSystemAccount, openAccount } from './accounts.ts';
import { listEntries } from './history.ts';
import { post, reverse, type PostInput } from './post.ts';
import { ledgerEntries, ledgerTransactions } from './schema.ts';
import {
  countTransactions,
  DEPOSIT,
  depositEntries,
  fund,
  holdOpen,
  openWallet,
  transfer,
  transferInput,
  waitForLockWaiters,
} from './test-support.ts';

describe('ledger post', () => {
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

  it('posts a test deposit from test_funding end to end (AC-5, AC-9, AC-11)', async () => {
    const funding = await getSystemAccount(db, 'test_funding');
    expect(funding).toMatchObject({ type: 'equity', currency: 'NGN', allowNegative: true });
    const wallet = await openWallet(db);

    const posted = await fund(db, wallet.id, DEPOSIT, `test_deposit:${wallet.id}`);

    expect(await getBalance(db, wallet.id)).toEqual({ accountId: wallet.id, currency: 'NGN', balance: 1_000_000n });
    expect(posted.entries).toHaveLength(2);
    expect(posted.entries.reduce((sum, e) => sum + e.amount, 0n)).toBe(0n);
    const walletEntry = posted.entries.find((e) => e.accountId === wallet.id)!;
    expect(walletEntry).toMatchObject({ amount: -1_000_000n, seq: 1n, balanceAfter: 1_000_000n, currency: 'NGN' });
    const fundingEntry = posted.entries.find((e) => e.accountId === funding.id)!;
    expect(fundingEntry).toMatchObject({
      amount: 1_000_000n,
      seq: funding.lastSeq + 1n,
      balanceAfter: funding.balance - 1_000_000n,
    });
    const fundingAfter = await getSystemAccount(db, 'test_funding');
    expect(fundingAfter.balance).toBe(funding.balance - 1_000_000n);
    expect(fundingAfter.lastSeq).toBe(funding.lastSeq + 1n);

    const history = await listEntries(db, wallet.id);
    expect(history.nextCursor).toBeNull();
    expect(history.items).toEqual([
      expect.objectContaining({
        transactionId: posted.id,
        seq: 1n,
        amount: 1_000_000n,
        balanceAfter: 1_000_000n,
        kind: 'test_deposit',
        description: 'Test deposit',
      }),
    ]);
  });

  it('returns entries in account id order with the transaction fields', async () => {
    const wallet = await openWallet(db);
    const posted = await fund(db, wallet.id, 500n);

    const ids = posted.entries.map((e) => e.accountId);
    expect(ids).toEqual([...ids].sort());
    expect(posted).toMatchObject({ kind: 'test_deposit', metadata: {}, reversesTransactionId: null });
    expect(posted.createdAt).toBeInstanceOf(Date);
  });

  it('stores the trimmed key and description, and kind, metadata, and raw amounts as given', async () => {
    const funding = await getSystemAccount(db, 'test_funding');
    const wallet = await openWallet(db);
    const key = `trim:${randomUUID()}`;
    const metadata = { source: 'test', nested: { flags: [true, null, 3] } };

    const posted = await withTx(db, (tx) =>
      post(tx, {
        postingKey: `  ${key}  `,
        kind: 'test_deposit',
        description: '  Padded deposit  ',
        metadata,
        entries: depositEntries(funding.id, wallet.id, 75n),
      }),
    );

    const [row] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, posted.id));
    expect(row).toEqual({
      id: posted.id,
      postingKey: key,
      kind: 'test_deposit',
      description: 'Padded deposit',
      metadata,
      reversesTransactionId: null,
      createdAt: posted.createdAt,
    });
    const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.transactionId, posted.id));
    expect(entries.map((e) => [e.accountId, e.amount, e.currency]).sort()).toEqual(
      [
        [funding.id, 75n, 'NGN'],
        [wallet.id, -75n, 'NGN'],
      ].sort(),
    );
  });

  it('moves each balance on its normal side: +10 on an asset and -10 on a liability both raise them by 10', async () => {
    const asset = await withTx(db, (tx) =>
      openAccount(tx, { type: 'asset', currency: 'NGN', code: `asset_${randomUUID().slice(0, 8)}` }),
    );
    const wallet = await openWallet(db);

    const posted = await withTx(db, (tx) =>
      post(tx, {
        postingKey: `sign:${randomUUID()}`,
        kind: 'test_deposit',
        description: 'Sign check',
        entries: [
          { accountId: asset.id, amount: 10n },
          { accountId: wallet.id, amount: -10n },
        ],
      }),
    );

    expect((await getBalance(db, asset.id)).balance).toBe(10n);
    expect((await getBalance(db, wallet.id)).balance).toBe(10n);
    expect(posted.entries.map((e) => e.balanceAfter)).toEqual([10n, 10n]);
  });

  it('numbers an account entries 1, 2, 3 with balance_after tracking each step (AC-5)', async () => {
    const wallet = await openWallet(db);

    const steps = [await fund(db, wallet.id, 100n), await fund(db, wallet.id, 50n), await fund(db, wallet.id, 25n)];

    expect(steps.map((p) => p.entries.find((e) => e.accountId === wallet.id))).toEqual([
      expect.objectContaining({ seq: 1n, balanceAfter: 100n }),
      expect.objectContaining({ seq: 2n, balanceAfter: 150n }),
      expect.objectContaining({ seq: 3n, balanceAfter: 175n }),
    ]);
    expect((await getSystemAccount(db, 'test_funding')).lastSeq).toBeGreaterThanOrEqual(3n);
  });

  it('accepts an upper case account id and stores it lower case', async () => {
    const funding = await getSystemAccount(db, 'test_funding');
    const wallet = await openWallet(db);

    const posted = await withTx(db, (tx) =>
      post(tx, {
        postingKey: `upper:${randomUUID()}`,
        kind: 'test_deposit',
        description: 'Upper case id',
        entries: depositEntries(funding.id, wallet.id.toUpperCase(), 5n),
      }),
    );

    expect(posted.entries.map((e) => e.accountId)).toContain(wallet.id);
    expect((await getBalance(db, wallet.id)).balance).toBe(5n);
  });

  it('lets a system account go below zero (allow_negative) while a wallet may land exactly on zero', async () => {
    const spender = await openWallet(db);
    const payee = await openWallet(db);
    await fund(db, spender.id, 40n);

    await transfer(db, spender.id, payee.id, 40n);

    expect((await getBalance(db, spender.id)).balance).toBe(0n);
    expect((await getSystemAccount(db, 'test_funding')).balance).toBeLessThan(0n);
  });

  it('leaves no rows and no balance change when the caller rolls back (AC-5)', async () => {
    const wallet = await openWallet(db);
    const fundingBefore = await getSystemAccount(db, 'test_funding');
    const key = `rollback:${randomUUID()}`;

    const failing = withTx(db, async (tx) => {
      await post(tx, {
        postingKey: key,
        kind: 'test_deposit',
        description: 'Test deposit',
        entries: depositEntries(fundingBefore.id, wallet.id, 100n),
      });
      throw new Error('caller failed after posting');
    });

    await expect(failing).rejects.toThrow('caller failed after posting');
    const fundingAfter = await getSystemAccount(db, 'test_funding');
    expect(fundingAfter.balance).toBe(fundingBefore.balance);
    expect(fundingAfter.lastSeq).toBe(fundingBefore.lastSeq);
    expect((await getBalance(db, wallet.id)).balance).toBe(0n);
    expect((await listEntries(db, wallet.id)).items).toEqual([]);
    // The key is free again, so nothing was written under it.
    await expect(fund(db, wallet.id, 100n, key)).resolves.toMatchObject({ postingKey: key });
  });

  describe('malformed input (AC-2)', () => {
    const badInputs: [string, (ids: { funding: string; wallet: string }) => unknown][] = [
      ['an empty posting key', (a) => ({ ...base(a), postingKey: '   ' })],
      ['a posting key over 200 characters', (a) => ({ ...base(a), postingKey: 'k'.repeat(201) })],
      ['an empty description', (a) => ({ ...base(a), description: '' })],
      ['a description over 500 characters', (a) => ({ ...base(a), description: 'd'.repeat(501) })],
      ['an unknown kind', (a) => ({ ...base(a), kind: 'gift' })],
      [
        'a non uuid account id',
        (a) => ({ ...base(a), entries: [{ accountId: 'nope', amount: 1n }, base(a).entries[1]] }),
      ],
      ['a single entry', (a) => ({ ...base(a), entries: [base(a).entries[0]] })],
      [
        'more than 50 entries',
        (a) => ({ ...base(a), entries: Array.from({ length: 51 }, () => ({ accountId: a.wallet, amount: 1n })) }),
      ],
      ['a number amount', (a) => ({ ...base(a), entries: [{ accountId: a.funding, amount: 5 }, base(a).entries[1]] })],
      ['metadata holding a bigint', (a) => ({ ...base(a), metadata: { amount: 5n } })],
      ['metadata holding Infinity', (a) => ({ ...base(a), metadata: { rate: Number.POSITIVE_INFINITY } })],
      [
        'entries that do not sum to zero',
        (a) => ({
          ...base(a),
          entries: [
            { accountId: a.funding, amount: 10n },
            { accountId: a.wallet, amount: -9n },
          ],
        }),
      ],
      [
        'a zero amount',
        (a) => ({
          ...base(a),
          entries: [
            { accountId: a.funding, amount: 0n },
            { accountId: a.wallet, amount: 0n },
          ],
        }),
      ],
      [
        'the same account twice',
        (a) => ({
          ...base(a),
          entries: [
            { accountId: a.wallet, amount: 10n },
            { accountId: a.wallet, amount: -10n },
          ],
        }),
      ],
      [
        'an unknown account',
        (a) => ({
          ...base(a),
          entries: [
            { accountId: a.funding, amount: 10n },
            { accountId: randomUUID(), amount: -10n },
          ],
        }),
      ],
    ];

    function base(a: { funding: string; wallet: string }) {
      return {
        postingKey: `bad:${randomUUID()}`,
        kind: 'test_deposit',
        description: 'Test deposit',
        entries: depositEntries(a.funding, a.wallet, 10n),
      };
    }

    it.each(badInputs)('rejects %s with a plain Error and writes nothing', async (_name, build) => {
      const funding = await getSystemAccount(db, 'test_funding');
      const wallet = await openWallet(db);
      const before = await countTransactions(db);

      const attempt = withTx(db, (tx) => post(tx, build({ funding: funding.id, wallet: wallet.id }) as PostInput));

      const err: unknown = await attempt.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(AppError);
      expect(await countTransactions(db)).toBe(before);
      expect((await getBalance(db, wallet.id)).balance).toBe(0n);
    });

    it('rejects a call made above read committed', async () => {
      const funding = await getSystemAccount(db, 'test_funding');
      const wallet = await openWallet(db);

      const attempt = withTx(db, (tx) => post(tx, base({ funding: funding.id, wallet: wallet.id }) as PostInput), {
        isolationLevel: 'serializable',
      });

      const err: unknown = await attempt.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(AppError);
      expect((err as Error).message).toMatch(/read committed/);
    });
  });

  it('refuses to overdraw an account with insufficient_funds and writes nothing (AC-6)', async () => {
    const empty = await openWallet(db);
    const other = await openWallet(db);
    const before = await countTransactions(db);

    const attempt = transfer(db, empty.id, other.id, 1n);

    await expect(attempt).rejects.toMatchObject({
      code: 'insufficient_funds',
      status: 422,
      detail: `Account ${empty.id} would go below zero`,
    });
    expect(await countTransactions(db)).toBe(before);
  });

  describe('duplicate posting keys (AC-7)', () => {
    it('rejects a sequential replay with 409 naming the existing transaction', async () => {
      const wallet = await openWallet(db);
      const key = `test_deposit:${randomUUID()}`;
      const first = await fund(db, wallet.id, 100n, key);

      await expect(fund(db, wallet.id, 100n, key)).rejects.toMatchObject({
        code: 'duplicate_posting',
        status: 409,
        detail: `Posting key ${key} already used by ledger transaction ${first.id}`,
      });
      expect((await getBalance(db, wallet.id)).balance).toBe(100n);
    });

    it('checks the key before funds, so replaying a spend that drained the account is 409, not 422', async () => {
      const spender = await openWallet(db);
      const payee = await openWallet(db);
      await fund(db, spender.id, 300n);
      const key = `spend:${randomUUID()}`;
      await transfer(db, spender.id, payee.id, 300n, key);

      await expect(transfer(db, spender.id, payee.id, 300n, key)).rejects.toMatchObject({
        code: 'duplicate_posting',
      });
    });

    it('lets exactly one of two concurrent posts with the same key through', async () => {
      const [a, b, c, d] = await Promise.all([openWallet(db), openWallet(db), openWallet(db), openWallet(db)]);
      await fund(db, a.id, 50n);
      await fund(db, c.id, 50n);
      const key = `race:${randomUUID()}`;

      const first = holdOpen(db, (tx) => post(tx, transferInput(a.id, b.id, 50n, key)));
      const winner = await first.worked;
      // Disjoint accounts, so the second post blocks on the key itself (ON CONFLICT), not on account locks.
      const second = transfer(db, c.id, d.id, 50n, key);
      await waitForLockWaiters(db, 1);
      await first.commit();

      await expect(second).rejects.toMatchObject({
        code: 'duplicate_posting',
        detail: `Posting key ${key} already used by ledger transaction ${winner.id}`,
      });
      expect((await getBalance(db, c.id)).balance).toBe(50n);
      expect((await getBalance(db, d.id)).balance).toBe(0n);
      expect((await getBalance(db, b.id)).balance).toBe(50n);
    });

    it('answers a concurrent replay on the same accounts with 409, not 422, when the first post drained them', async () => {
      const spender = await openWallet(db);
      const payee = await openWallet(db);
      await fund(db, spender.id, 50n);
      const key = `race:${randomUUID()}`;

      const first = holdOpen(db, (tx) => post(tx, transferInput(spender.id, payee.id, 50n, key)));
      const winner = await first.worked;
      // Same accounts, so the replay queues on the account locks and sees the drained balance once it gets them.
      const replay = transfer(db, spender.id, payee.id, 50n, key);
      await waitForLockWaiters(db, 1);
      await first.commit();

      await expect(replay).rejects.toMatchObject({
        code: 'duplicate_posting',
        detail: `Posting key ${key} already used by ledger transaction ${winner.id}`,
      });
      expect((await getBalance(db, spender.id)).balance).toBe(0n);
      expect((await getBalance(db, payee.id)).balance).toBe(50n);
    });

    it('answers a concurrent replay that shares only one account with 409, not 422 (partial overlap)', async () => {
      const [a, b, c] = await Promise.all([openWallet(db), openWallet(db), openWallet(db)]);
      await fund(db, b.id, 50n);
      const key = `race:${randomUUID()}`;

      const first = holdOpen(db, (tx) => post(tx, transferInput(b.id, a.id, 50n, key)));
      const winner = await first.worked;
      // Shares only b, which the first post drains, so it queues on b's lock and would see 422 without the key recheck.
      const replay = transfer(db, b.id, c.id, 50n, key);
      await waitForLockWaiters(db, 1);
      await first.commit();

      await expect(replay).rejects.toMatchObject({
        code: 'duplicate_posting',
        detail: `Posting key ${key} already used by ledger transaction ${winner.id}`,
      });
      expect((await getBalance(db, c.id)).balance).toBe(0n);
    });

    it('answers a post that reuses a concurrent reversal key on shared accounts with 409, not 422', async () => {
      const wallet = await openWallet(db);
      const payee = await openWallet(db);
      const deposit = await fund(db, wallet.id, 30n);
      const key = `shared:${randomUUID()}`;

      const first = holdOpen(db, (tx) =>
        reverse(tx, { transactionId: deposit.id, postingKey: key, description: 'Reverse test deposit' }),
      );
      const reversal = await first.worked;
      // The reversal empties the wallet, so without the key check under the lock this post would get 422.
      const reuse = transfer(db, wallet.id, payee.id, 30n, key);
      await waitForLockWaiters(db, 1);
      await first.commit();

      await expect(reuse).rejects.toMatchObject({
        code: 'duplicate_posting',
        detail: `Posting key ${key} already used by ledger transaction ${reversal.id}`,
      });
      expect((await getBalance(db, wallet.id)).balance).toBe(0n);
      expect((await getBalance(db, payee.id)).balance).toBe(0n);
    });

    it('lets a concurrent replay go ahead on its own when the first post rolls back', async () => {
      const spender = await openWallet(db);
      const payee = await openWallet(db);
      await fund(db, spender.id, 50n);
      const key = `race:${randomUUID()}`;

      const first = holdOpen(db, (tx) => post(tx, transferInput(spender.id, payee.id, 50n, key)));
      await first.worked;
      const replay = transfer(db, spender.id, payee.id, 50n, key);
      await waitForLockWaiters(db, 1);
      await first.rollback();

      const posted = await replay;
      expect(posted.postingKey).toBe(key);
      expect((await getBalance(db, spender.id)).balance).toBe(0n);
      expect((await getBalance(db, payee.id)).balance).toBe(50n);
      const rows = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.postingKey, key));
      expect(rows.map((row) => row.id)).toEqual([posted.id]);
    });
  });
});
