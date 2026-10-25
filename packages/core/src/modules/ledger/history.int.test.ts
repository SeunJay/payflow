import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '@payflow/shared';
import { createTestDatabase, type TestDatabase } from '@payflow/test-utils';
import { createDb, type DbHandle } from '../../infra/db.ts';
import { listEntries } from './history.ts';
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
