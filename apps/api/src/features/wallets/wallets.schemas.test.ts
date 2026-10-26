import { describe, expect, it } from 'vitest';
import type { WalletHistoryPage } from '@payflow/core';
import { historyBody, historyQuery, walletBody } from './wallets.schemas.ts';

const PG_BIGINT_MAX = '9223372036854775807';

describe('history query (AC-8)', () => {
  it('leaves both fields out when the query is empty, so core applies its default of 50', () => {
    expect(historyQuery.parse({})).toEqual({});
  });

  it.each([
    ['the smallest cursor', { cursor: '1' }, { cursor: '1' }],
    ['the largest Postgres bigint as a cursor', { cursor: PG_BIGINT_MAX }, { cursor: PG_BIGINT_MAX }],
    ['limit 1', { limit: '1' }, { limit: 1 }],
    ['limit 100', { limit: '100' }, { limit: 100 }],
    ['both together', { cursor: '42', limit: '7' }, { cursor: '42', limit: 7 }],
  ])('accepts %s', (_name, query, parsed) => {
    expect(historyQuery.parse(query)).toEqual(parsed);
  });

  it.each([
    ['a word cursor', { cursor: 'abc' }],
    ['cursor 0', { cursor: '0' }],
    ['a leading zero cursor', { cursor: '01' }],
    ['a negative cursor', { cursor: '-1' }],
    ['one past the largest bigint', { cursor: '9223372036854775808' }],
    ['a 19 digit cursor above the largest bigint', { cursor: '9999999999999999999' }],
    ['a 20 digit cursor', { cursor: '10000000000000000000' }],
    ['a repeated cursor', { cursor: ['1', '2'] }],
    ['limit 0', { limit: '0' }],
    ['limit 101', { limit: '101' }],
    ['a fractional limit', { limit: '1.5' }],
    ['a word limit', { limit: 'ten' }],
  ])('rejects %s without throwing', (_name, query) => {
    expect(historyQuery.safeParse(query).success).toBe(false);
  });
});

describe('wallet and history bodies (AC-8)', () => {
  it('sends the balance as a decimal string, so JSON never sees a bigint', () => {
    const body = walletBody({ id: 'w1', balance: { amount: 1_000_000n, currency: 'NGN' } });

    expect(JSON.parse(JSON.stringify(body))).toEqual({ id: 'w1', balance: { amount: '1000000', currency: 'NGN' } });
  });

  it('keeps amounts past Number.MAX_SAFE_INTEGER exact', () => {
    const body = walletBody({ id: 'w1', balance: { amount: 9_007_199_254_740_993n, currency: 'NGN' } });

    expect(body.balance.amount).toBe('9007199254740993');
  });

  it('maps each history item with string amounts and ISO dates, and passes the cursor through', () => {
    const page: WalletHistoryPage = {
      currency: 'NGN',
      items: [
        {
          transactionId: 't1',
          kind: 'test_deposit',
          description: 'Sign up test deposit',
          amount: -250n,
          balanceAfter: 0n,
          createdAt: new Date('2026-10-26T12:00:00.123Z'),
        },
      ],
      nextCursor: '17',
    };

    expect(JSON.parse(JSON.stringify(historyBody(page)))).toEqual({
      currency: 'NGN',
      items: [
        {
          transactionId: 't1',
          kind: 'test_deposit',
          description: 'Sign up test deposit',
          amount: '-250',
          balanceAfter: '0',
          createdAt: '2026-10-26T12:00:00.123Z',
        },
      ],
      nextCursor: '17',
    });
  });

  it('maps an empty page to no items and a null cursor', () => {
    expect(historyBody({ currency: 'NGN', items: [], nextCursor: null })).toEqual({
      currency: 'NGN',
      items: [],
      nextCursor: null,
    });
  });
});
