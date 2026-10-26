import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '@payflow/shared';
import { createTestDatabase, type TestDatabase } from '@payflow/test-utils';
import { createDb, type DbHandle } from '../../infra/db.ts';
import { withTx } from '../../infra/tx.ts';
import { openAccount } from './accounts.ts';
import { listEntries } from './history.ts';
import { post } from './post.ts';
import type { EntryView } from './types.ts';
import { fund, openWallet } from './test-support.ts';

describe('ledger listEntries (AC-9)', () => {
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

  async function walletWithPostings(count: number) {
    const wallet = await openWallet(db);
    // Amounts 1..count, so each entry is distinguishable and the running balance is checkable.
    for (let i = 1; i <= count; i++) await fund(db, wallet.id, BigInt(i));
    return wallet;
  }

  async function allPages(accountId: string, limit: number) {
    const pages: (readonly EntryView[])[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await listEntries(db, accountId, cursor === undefined ? { limit } : { cursor, limit });
      pages.push(page.items);
      if (page.nextCursor === null) return pages;
      cursor = page.nextCursor;
    }
  }

  it('pages 120 entries as 50, 50, 20, newest first, with no gaps or repeats', async () => {
    const wallet = await walletWithPostings(120);

    const pages = await allPages(wallet.id, 50);

    expect(pages.map((p) => p.length)).toEqual([50, 50, 20]);
    const items = pages.flat();
    expect(items.map((e) => e.seq)).toEqual(Array.from({ length: 120 }, (_, i) => BigInt(120 - i)));
    // Normal side amounts: previous balance + amount = balance_after.
    for (const item of items) {
      expect(item.amount).toBe(item.seq);
      expect(item.balanceAfter).toBe((item.seq * (item.seq + 1n)) / 2n);
    }
  });

  it('ends exactly 100 entries in 2 pages with no empty trailing page', async () => {
    const wallet = await walletWithPostings(100);

    const first = await listEntries(db, wallet.id, { limit: 50 });
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBe('51');
    const second = await listEntries(db, wallet.id, { cursor: first.nextCursor!, limit: 50 });
    expect(second.items).toHaveLength(50);
    expect(second.nextCursor).toBeNull();
  });

  it('defaults to 50 per page and returns an empty page for an account with no entries', async () => {
    const wallet = await openWallet(db);

    expect(await listEntries(db, wallet.id)).toEqual({ items: [], nextCursor: null });
  });

  it('shows amounts on the normal side: a debit lowers equity, a credit lowers an asset', async () => {
    const suffix = randomUUID().slice(0, 8);
    const [asset, equity] = await withTx(db, async (tx) => [
      await openAccount(tx, { type: 'asset', currency: 'NGN', code: `asset_${suffix}`, allowNegative: true }),
      await openAccount(tx, { type: 'equity', currency: 'NGN', code: `equity_${suffix}`, allowNegative: true }),
    ]);

    // Debit equity by 10, credit the asset by 10.
    await withTx(db, (tx) =>
      post(tx, {
        postingKey: `sign:${randomUUID()}`,
        kind: 'test_deposit',
        description: 'Sign check',
        entries: [
          { accountId: equity.id, amount: 10n },
          { accountId: asset.id, amount: -10n },
        ],
      }),
    );

    expect((await listEntries(db, equity.id)).items[0]).toMatchObject({ amount: -10n, balanceAfter: -10n });
    expect((await listEntries(db, asset.id)).items[0]).toMatchObject({ amount: -10n, balanceAfter: -10n });
  });

  it('carries the transaction kind, description, and created_at on each item', async () => {
    const wallet = await openWallet(db);
    const posted = await fund(db, wallet.id, 10n);

    const [item] = (await listEntries(db, wallet.id)).items;

    expect(item).toEqual({
      entryId: posted.entries.find((e) => e.accountId === wallet.id)?.entryId,
      transactionId: posted.id,
      seq: 1n,
      amount: 10n,
      balanceAfter: 10n,
      kind: 'test_deposit',
      description: 'Test deposit',
      createdAt: posted.createdAt,
    });
  });

  it('only lists the requested account entries', async () => {
    const a = await openWallet(db);
    const b = await openWallet(db);
    await fund(db, a.id, 1n);
    await fund(db, b.id, 2n);

    const items = (await listEntries(db, a.id)).items;

    expect(items.map((i) => i.amount)).toEqual([1n]);
  });

  it('returns an empty last page for a cursor at the oldest seq', async () => {
    const wallet = await walletWithPostings(3);

    expect(await listEntries(db, wallet.id, { cursor: '1' })).toEqual({ items: [], nextCursor: null });
  });

  it.each([
    ['a non numeric cursor', { cursor: 'abc' }],
    ['a zero cursor', { cursor: '0' }],
    ['limit 0', { limit: 0 }],
    ['limit 101', { limit: 101 }],
    ['a fractional limit', { limit: 1.5 }],
  ])('throws on %s', async (_name, page) => {
    const wallet = await openWallet(db);

    await expect(listEntries(db, wallet.id, page)).rejects.toThrow(/^ledger: invalid input/);
  });

  it('throws on an unknown account', async () => {
    await expect(listEntries(db, randomUUID())).rejects.toThrow(/^ledger: unknown account/);
  });
});
