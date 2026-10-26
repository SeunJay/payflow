import { describe, expect, it } from 'vitest';
import { AppError } from '@payflow/shared';
import { alreadyReversed, duplicatePosting, insufficientFunds } from './errors.ts';

describe('ledger errors', () => {
  it('insufficientFunds is a 422 AppError naming the account (AC-6)', () => {
    const err = insufficientFunds('acc_1');

    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({
      code: 'insufficient_funds',
      status: 422,
      message: 'Insufficient funds',
      detail: 'Account acc_1 would go below zero',
    });
  });

  it('duplicatePosting is a 409 AppError naming the key and the existing transaction (AC-7)', () => {
    const err = duplicatePosting('test_deposit:1', 'tx_1');

    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({
      code: 'duplicate_posting',
      status: 409,
      message: 'Duplicate posting',
      detail: 'Posting key test_deposit:1 already used by ledger transaction tx_1',
    });
  });

  it('alreadyReversed is a 409 AppError naming the original and the existing reversal (AC-8)', () => {
    const err = alreadyReversed('tx_1', 'tx_2');

    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({
      code: 'already_reversed',
      status: 409,
      message: 'Transaction already reversed',
      detail: 'Ledger transaction tx_1 was already reversed by tx_2',
    });
  });
});
