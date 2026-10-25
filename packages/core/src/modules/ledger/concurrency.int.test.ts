// Postings that touch the same accounts in opposite orders never deadlock (AC-12).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createLogger } from '@payflow/shared';
import { createTestDatabase, type TestDatabase } from '@payflow/test-utils';
import { createDb, type DbHandle } from '../../infra/db.ts';
import { withTx, type Tx } from '../../infra/tx.ts';
import type { LedgerAccount } from './types.ts';
import { post } from './post.ts';
import { verifyLedger } from './verify.ts';
import { fund, holdOpen, openWallet, pgCode, transfer, transferInput, waitForLockWaiters } from './test-support.ts';

describe('ledger concurrency (AC-12)', () => {
  let database: TestDatabase;
  let handle: DbHandle;
  let db: DbHandle['db'];

  beforeAll(async () => {
    database = await createTestDatabase();
    handle = createDb({ url: database.url, logger: createLogger({ name: 'test', level: 'silent' }), max: 20 });
    db = handle.db;
  });

  afterAll(async () => {
    await handle.close();
    await database.drop();
  });

  /** Two funded wallets, `low` having the smaller id (the one `post` locks first). */
  async function fundedPair(): Promise<{ low: LedgerAccount; high: LedgerAccount }> {
    const [a, b] = await Promise.all([openWallet(db), openWallet(db)]);
    await fund(db, a.id, 1_000n);
    await fund(db, b.id, 1_000n);
    return a.id < b.id ? { low: a, high: b } : { low: b, high: a };
  }

  const lockRow = (tx: Tx, id: string) => tx.execute(sql`select id from ledger_accounts where id = ${id} for update`);

  /** The negative control: locks in the caller's order, the mistake `post` avoids. */
  async function lockInInputOrder(tx: Tx, ids: readonly string[]): Promise<void> {
    for (const id of ids) await lockRow(tx, id);
  }

  it('lets a post wait behind an open post on the same accounts in the opposite order', async () => {
    const { low, high } = await fundedPair();

    const first = holdOpen(db, (tx) => post(tx, transferInput(low.id, high.id, 10n)));
    await first.worked;
    const second = transfer(db, high.id, low.id, 30n);
    await waitForLockWaiters(db, 1);
    await first.commit();

    await expect(second).resolves.toMatchObject({ kind: 'test_deposit' });
    expect((await verifyLedger(db)).drift).toEqual([]);
  });

  it('does not deadlock when both posts queue behind a lock and then race in opposite orders', async () => {
    const { low, high } = await fundedPair();

    // Hold the low account so both posts start waiting before either holds anything.
    const blocker = holdOpen(db, (tx) => lockRow(tx, low.id));
    await blocker.worked;
    const forward = transfer(db, low.id, high.id, 10n);
    const backward = transfer(db, high.id, low.id, 20n);
    await waitForLockWaiters(db, 2);
    await blocker.commit();

    const results = await Promise.allSettled([forward, backward]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect((await verifyLedger(db)).drift).toEqual([]);
  });

  it('negative control: locking in input order under the same schedule deadlocks (40P01)', async () => {
    const { low, high } = await fundedPair();

    const blocker = holdOpen(db, (tx) => lockRow(tx, low.id));
    await blocker.worked;
    const forward = withTx(db, (tx) => lockInInputOrder(tx, [low.id, high.id]));
    await waitForLockWaiters(db, 1);
    // This one takes `high` at once, then waits for `low`.
    const backward = withTx(db, (tx) => lockInInputOrder(tx, [high.id, low.id]));
    await waitForLockWaiters(db, 2);
    await blocker.commit();

    const results = await Promise.allSettled([forward, backward]);
    const codes = results.map((r) => (r.status === 'rejected' ? pgCode(r.reason) : 'ok'));
    expect(codes).toContain('40P01');
  });

  it('soak: 20 concurrent random direction postings across 10 accounts stay consistent', async () => {
    const wallets = await Promise.all(Array.from({ length: 10 }, () => openWallet(db)));
    for (const wallet of wallets) await fund(db, wallet.id, 1_000n);
    const pick = () => wallets[Math.floor(Math.random() * wallets.length)]!;

    const postings = Array.from({ length: 20 }, () => {
      const from = pick();
      let to = pick();
      while (to.id === from.id) to = pick();
      return transfer(db, from.id, to.id, BigInt(1 + Math.floor(Math.random() * 50)));
    });
    const results = await Promise.allSettled(postings);

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    expect((await verifyLedger(db)).drift).toEqual([]);
  });
});
