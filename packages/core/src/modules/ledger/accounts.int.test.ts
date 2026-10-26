import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { AppError, createLogger } from '@payflow/shared';
import { createTestDatabase, type TestDatabase } from '@payflow/test-utils';
import { createDb, type DbHandle } from '../../infra/db.ts';
import { withTx } from '../../infra/tx.ts';
import { getBalance, getSystemAccount, openAccount } from './accounts.ts';
import { ledgerAccounts } from './schema.ts';
import { fund, openWallet, pgCode } from './test-support.ts';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('ledger accounts', () => {
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

  const storedRow = async (id: string) => {
    const [row] = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, id));
    return row;
  };

  describe('openAccount', () => {
    it('opens a wallet with database defaults: a uuidv7 id, zero balance and seq, a created_at', async () => {
      const wallet = await withTx(db, (tx) => openAccount(tx, { type: 'liability', currency: 'NGN' }));

      expect(wallet.id).toMatch(UUID_V7);
      expect(wallet).toMatchObject({ code: null, allowNegative: false, balance: 0n, lastSeq: 0n });
      expect(wallet.createdAt).toBeInstanceOf(Date);
      expect(await storedRow(wallet.id)).toEqual(wallet);
    });

    it('stores a system account exactly as given', async () => {
      const code = `sys_${randomUUID().slice(0, 8)}`;

      const account = await withTx(db, (tx) =>
        openAccount(tx, { type: 'asset', currency: 'NGN', code, allowNegative: true }),
      );

      expect(await storedRow(account.id)).toMatchObject({ type: 'asset', currency: 'NGN', code, allowNegative: true });
    });

    it('refuses allowNegative on a wallet without a code (AC-6)', async () => {
      const attempt = withTx(db, (tx) => openAccount(tx, { type: 'liability', currency: 'NGN', allowNegative: true }));

      const err: unknown = await attempt.catch((e: unknown) => e);
      expect(err).not.toBeInstanceOf(AppError);
      expect(pgCode(err)).toBe('23514');
    });

    it('refuses a second account with the same system code', async () => {
      const code = `sys_${randomUUID().slice(0, 8)}`;
      await withTx(db, (tx) => openAccount(tx, { type: 'asset', currency: 'NGN', code }));

      const attempt = withTx(db, (tx) => openAccount(tx, { type: 'asset', currency: 'NGN', code }));

      expect(pgCode(await attempt.catch((e: unknown) => e))).toBe('23505');
    });

    it('rolls back with the caller, leaving no account behind', async () => {
      let openedId = '';

      await withTx(db, async (tx) => {
        openedId = (await openAccount(tx, { type: 'liability', currency: 'NGN' })).id;
        throw new Error('caller failed');
      }).catch(() => undefined);

      expect(openedId).toMatch(UUID_V7);
      expect(await storedRow(openedId)).toBeUndefined();
    });
  });

  describe('getSystemAccount', () => {
    it('finds the seeded test_funding account (AC-11)', async () => {
      expect(await getSystemAccount(db, 'test_funding')).toMatchObject({
        code: 'test_funding',
        type: 'equity',
        currency: 'NGN',
        allowNegative: true,
      });
    });
  });

  describe('getBalance (AC-9)', () => {
    it('returns the cached balance and currency', async () => {
      const wallet = await openWallet(db);
      await fund(db, wallet.id, 4_200n);

      expect(await getBalance(db, wallet.id)).toEqual({ accountId: wallet.id, currency: 'NGN', balance: 4_200n });
      expect((await storedRow(wallet.id))?.balance).toBe(4_200n);
    });

    it('accepts an upper case id', async () => {
      const wallet = await openWallet(db);

      expect((await getBalance(db, wallet.id.toUpperCase())).accountId).toBe(wallet.id);
    });

    it('reads a credit normal system account on its normal side', async () => {
      const funding = await getSystemAccount(db, 'test_funding');

      expect((await getBalance(db, funding.id)).balance).toBe(funding.balance);
    });

    it('throws a plain Error on an unknown account', async () => {
      await expect(getBalance(db, randomUUID())).rejects.toThrow(/^ledger: unknown account/);
    });

    it('throws a plain Error on a non uuid id', async () => {
      await expect(getBalance(db, 'wallet-1')).rejects.toThrow(/^ledger: invalid input/);
    });
  });
});
