import { AppError } from '@payflow/shared';

export const insufficientFunds = (accountId: string) =>
  new AppError({
    code: 'insufficient_funds',
    status: 422,
    title: 'Insufficient funds',
    detail: `Account ${accountId} would go below zero`,
  });

export const duplicatePosting = (postingKey: string, transactionId: string) =>
  new AppError({
    code: 'duplicate_posting',
    status: 409,
    title: 'Duplicate posting',
    detail: `Posting key ${postingKey} already used by ledger transaction ${transactionId}`,
  });

export const alreadyReversed = (transactionId: string, reversalId: string) =>
  new AppError({
    code: 'already_reversed',
    status: 409,
    title: 'Transaction already reversed',
    detail: `Ledger transaction ${transactionId} was already reversed by ${reversalId}`,
  });
