import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@payflow/shared';
import { createTestDatabase, type TestDatabase } from '@payflow/test-utils';
import { createDb, type DbHandle } from '../../infra/db.ts';
import { getSystemAccount } from './accounts.ts';
import { runLedgerVerify, verifyAccount, verifyLedger } from './verify.ts';
import { fund, openWallet, rawTx, transfer } from './test-support.ts';

// Tests run in order: the books are clean until the drift test corrupts them.
describe('ledger verify (AC-10)', () => {
  const logger = createLogger({ name: 'test', level: 'silent' });
  let database: TestDatabase;
  let handle: DbHandle;
  let db: DbHandle['db'];

  beforeAll(async () => {
    database = await createTestDatabase();
    handle = createDb({ url: database.url, logger });
    db = handle.db;
  });

  afterAll(async () => {
    await handle.close();
    await database.drop();
  });

  it('reports clean books and returns 0', async () => {
    const [a, b] = await Promise.all([openWallet(db), openWallet(db)]);
    await fund(db, a.id, 900n);
    await transfer(db, a.id, b.id, 400n);
    const info = vi.spyOn(logger, 'info');
    const error = vi.spyOn(logger, 'error');

    const result = await verifyLedger(db);

    expect(result).toEqual({ checked: 3, drift: [] });
    expect(await runLedgerVerify(db, logger)).toBe(0);
    expect(info).toHaveBeenCalledWith({ checked: 3, driftCount: 0 }, 'ledger verify finished');
    expect(error).not.toHaveBeenCalled();
    expect(await verifyAccount(db, a.id)).toEqual({
      accountId: a.id,
      cached: 500n,
      rebuilt: 500n,
      lastBalanceAfter: 500n,
      ok: true,
    });
    vi.restoreAllMocks();
  });

  it('treats an account with no entries and a zero balance as clean', async () => {
    const wallet = await openWallet(db);

    expect(await verifyAccount(db, wallet.id)).toMatchObject({ rebuilt: 0n, lastBalanceAfter: null, ok: true });
  });

  it('reads a system account on its normal side', async () => {
    const funding = await getSystemAccount(db, 'test_funding');

    expect(await verifyAccount(db, funding.id)).toMatchObject({ cached: -900n, rebuilt: -900n, ok: true });
  });

  it('reports injected drift, logs it, and returns 1', async () => {
    const wallet = await openWallet(db);
    await fund(db, wallet.id, 250n);
    // The account guard allows balance changes (post needs them); verify is what catches this.
    await handle.pool.query('update ledger_accounts set balance = balance + 1 where id = $1', [wallet.id]);
    const error = vi.spyOn(logger, 'error');

    const check = await verifyAccount(db, wallet.id);
    const result = await verifyLedger(db);
    const code = await runLedgerVerify(db, logger);

    expect(check).toEqual({ accountId: wallet.id, cached: 251n, rebuilt: 250n, lastBalanceAfter: 250n, ok: false });
    expect(result.drift).toEqual([check]);
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(
      { accountId: wallet.id, cached: '251', rebuilt: '250', lastBalanceAfter: '250' },
      'ledger drift',
    );
    vi.restoreAllMocks();
  });

  it('catches a latest balance_after that disagrees even when the cached balance is right', async () => {
    const wallet = await openWallet(db);
    const funding = await getSystemAccount(db, 'test_funding');
    // A balanced raw deposit that bypasses post: cached balances and seqs are right,
    // but the wallet entry carries a wrong balance_after.
    await rawTx(handle.pool, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into ledger_transactions (posting_key, kind, description) values ($1, 'test_deposit', 'raw') returning id`,
        [`raw:${randomUUID()}`],
      );
      await client.query(
        `insert into ledger_entries (transaction_id, account_id, currency, seq, amount, balance_after)
         values ($1, $2, 'NGN', $3, 10, $4), ($1, $5, 'NGN', 1, -10, 999)`,
        [rows[0]!.id, funding.id, String(funding.lastSeq + 1n), String(funding.balance - 10n), wallet.id],
      );
      await client.query(`update ledger_accounts set balance = balance - 10, last_seq = last_seq + 1 where id = $1`, [
        funding.id,
      ]);
      await client.query(`update ledger_accounts set balance = 10, last_seq = 1 where id = $1`, [wallet.id]);
    });

    expect(await verifyAccount(db, funding.id)).toMatchObject({ ok: true });
    expect(await verifyAccount(db, wallet.id)).toEqual({
      accountId: wallet.id,
      cached: 10n,
      rebuilt: 10n,
      lastBalanceAfter: 999n,
      ok: false,
    });
  });

  it('throws on an unknown account', async () => {
    await expect(verifyAccount(db, randomUUID())).rejects.toThrow(/^ledger: unknown account/);
  });
});
