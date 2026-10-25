// The database guards hold even when application code is bypassed with raw SQL.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '@payflow/shared';
import { createTestDatabase, type TestDatabase } from '@payflow/test-utils';
import { createDb, type DbHandle } from '../../infra/db.ts';
import { getBalance } from './accounts.ts';
import { fund, openWallet, pgCode, rawTx } from './test-support.ts';

describe('ledger database guards', () => {
  let database: TestDatabase;
  let handle: DbHandle;

  beforeAll(async () => {
    database = await createTestDatabase();
    handle = createDb({ url: database.url, logger: createLogger({ name: 'test', level: 'silent' }) });
  });

  afterAll(async () => {
    await handle.close();
    await database.drop();
  });

  const query = (text: string, values: unknown[] = []) => handle.pool.query(text, values);

  async function insertTransaction(client: { query: typeof handle.pool.query }, kind = 'test_deposit') {
    const result = await client.query<{ id: string }>(
      `insert into ledger_transactions (posting_key, kind, description) values ($1, $2, 'raw') returning id`,
      [`raw:${randomUUID()}`, kind],
    );
    return result.rows[0]!.id;
  }

  const insertEntry = (
    client: { query: typeof handle.pool.query },
    entry: { transactionId: string; accountId: string; amount: bigint; seq?: bigint; currency?: string },
  ) =>
    client.query(
      `insert into ledger_entries (transaction_id, account_id, currency, seq, amount, balance_after)
       values ($1, $2, $3, $4, $5, 0)`,
      [entry.transactionId, entry.accountId, entry.currency ?? 'NGN', String(entry.seq ?? 1n), String(entry.amount)],
    );

  describe('balance at commit (AC-1)', () => {
    it('rejects an unbalanced transaction at COMMIT', async () => {
      const [a, b] = await Promise.all([openWallet(handle.db), openWallet(handle.db)]);

      const attempt = rawTx(handle.pool, async (client) => {
        const id = await insertTransaction(client);
        await insertEntry(client, { transactionId: id, accountId: a.id, amount: 100n });
        await insertEntry(client, { transactionId: id, accountId: b.id, amount: -50n });
      });

      await expect(attempt).rejects.toThrow(/^ledger: transaction .* does not balance in NGN/);
    });

    it('rejects a transaction with a single entry at COMMIT', async () => {
      const a = await openWallet(handle.db);

      const attempt = rawTx(handle.pool, async (client) => {
        const id = await insertTransaction(client);
        await insertEntry(client, { transactionId: id, accountId: a.id, amount: 100n });
      });

      await expect(attempt).rejects.toThrow(/^ledger: transaction .* has 1 entries, needs at least 2/);
    });

    it('rejects a transaction with no entries at COMMIT', async () => {
      const attempt = rawTx(handle.pool, async (client) => {
        await insertTransaction(client);
      });

      await expect(attempt).rejects.toThrow(/has 0 entries/);
    });

    it('accepts a balanced raw transaction', async () => {
      const [a, b] = await Promise.all([openWallet(handle.db), openWallet(handle.db)]);

      const attempt = rawTx(handle.pool, async (client) => {
        const id = await insertTransaction(client);
        await insertEntry(client, { transactionId: id, accountId: a.id, amount: 100n });
        await insertEntry(client, { transactionId: id, accountId: b.id, amount: -100n });
      });

      await expect(attempt).resolves.toBeUndefined();
    });
  });

  describe('immutability (AC-3)', () => {
    it.each([
      ['update ledger_transactions', `update ledger_transactions set description = 'changed'`],
      ['delete from ledger_transactions', `delete from ledger_transactions`],
      ['truncate ledger_transactions', `truncate ledger_transactions cascade`],
      ['update ledger_entries', `update ledger_entries set amount = amount * 2`],
      ['delete from ledger_entries', `delete from ledger_entries`],
      ['truncate ledger_entries', `truncate ledger_entries`],
      ['delete from ledger_accounts', `delete from ledger_accounts`],
      ['truncate ledger_accounts', `truncate ledger_accounts cascade`],
    ])('refuses %s', async (_name, statement) => {
      const wallet = await openWallet(handle.db);
      await fund(handle.db, wallet.id, 100n);

      await expect(query(statement)).rejects.toThrow(/^ledger: .* is not allowed/);
      expect((await getBalance(handle.db, wallet.id)).balance).toBe(100n);
    });

    it.each([
      ['type', `type = 'asset'`],
      ['currency', `currency = 'NGN '`],
      ['code', `code = 'sneaky'`],
      ['allow_negative', `allow_negative = true`],
      ['created_at', `created_at = now() - interval '1 day'`],
      ['id', `id = uuidv7()`],
    ])('refuses to change an account %s', async (_name, assignment) => {
      const wallet = await openWallet(handle.db);

      await expect(query(`update ledger_accounts set ${assignment} where id = $1`, [wallet.id])).rejects.toThrow(
        /^ledger: only balance and last_seq/,
      );
    });

    it('allows balance and last_seq to change on an account', async () => {
      const wallet = await openWallet(handle.db);

      await query(`update ledger_accounts set balance = balance + 1, last_seq = last_seq + 1 where id = $1`, [
        wallet.id,
      ]);

      expect((await getBalance(handle.db, wallet.id)).balance).toBe(1n);
    });
  });

  describe('currency and accounts (AC-4, AC-6)', () => {
    it('refuses an entry whose currency differs from its account', async () => {
      const [a, b] = await Promise.all([openWallet(handle.db), openWallet(handle.db)]);

      const attempt = rawTx(handle.pool, async (client) => {
        const id = await insertTransaction(client);
        await insertEntry(client, { transactionId: id, accountId: a.id, amount: 100n, currency: 'USD' });
        await insertEntry(client, { transactionId: id, accountId: b.id, amount: -100n, currency: 'USD' });
      });

      const err: unknown = await attempt.catch((e: unknown) => e);
      expect(pgCode(err)).toBe('23503');
    });

    it('refuses to create a non NGN account', async () => {
      const err: unknown = await query(
        `insert into ledger_accounts (type, currency) values ('liability', 'USD')`,
      ).catch((e: unknown) => e);

      expect(pgCode(err)).toBe('23514');
      expect((err as Error).message).toMatch(/ledger_accounts_currency_check/);
    });

    it('refuses allow_negative on an account without a code', async () => {
      const err: unknown = await query(
        `insert into ledger_accounts (type, currency, allow_negative) values ('liability', 'NGN', true)`,
      ).catch((e: unknown) => e);

      expect((err as Error).message).toMatch(/ledger_accounts_allow_negative_check/);
    });

    it('refuses a negative balance on an account that may not go negative', async () => {
      const wallet = await openWallet(handle.db);

      const err: unknown = await query(`update ledger_accounts set balance = -1 where id = $1`, [wallet.id]).catch(
        (e: unknown) => e,
      );

      expect((err as Error).message).toMatch(/ledger_accounts_balance_check/);
    });
  });

  it('refuses a raw insert that reverses a reversal (AC-8)', async () => {
    const [a, b] = await Promise.all([openWallet(handle.db), openWallet(handle.db)]);
    let reversalId = '';
    await rawTx(handle.pool, async (client) => {
      const originalId = await insertTransaction(client);
      await insertEntry(client, { transactionId: originalId, accountId: a.id, amount: 10n });
      await insertEntry(client, { transactionId: originalId, accountId: b.id, amount: -10n });
      const result = await client.query<{ id: string }>(
        `insert into ledger_transactions (posting_key, kind, description, reverses_transaction_id)
         values ($1, 'reversal', 'raw reversal', $2) returning id`,
        [`raw:${randomUUID()}`, originalId],
      );
      reversalId = result.rows[0]!.id;
      await insertEntry(client, { transactionId: reversalId, accountId: a.id, amount: -10n, seq: 2n });
      await insertEntry(client, { transactionId: reversalId, accountId: b.id, amount: 10n, seq: 2n });
    });

    const attempt = query(
      `insert into ledger_transactions (posting_key, kind, description, reverses_transaction_id)
       values ($1, 'reversal', 'reversal of a reversal', $2)`,
      [`raw:${randomUUID()}`, reversalId],
    );

    await expect(attempt).rejects.toThrow(/^ledger: transaction .* is a reversal and cannot be reversed/);
  });
});
