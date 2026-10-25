// Ledger value types. Money is always `bigint` minor units (kobo for NGN).

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const CURRENCIES = ['NGN'] as const;
export type Currency = (typeof CURRENCIES)[number];

// Each later slice extends this list together with the `kind` CHECK in its own migration.
export const TRANSACTION_KINDS = ['test_deposit', 'reversal'] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export const SYSTEM_ACCOUNT_CODES = ['test_funding'] as const;
export type SystemAccountCode = (typeof SYSTEM_ACCOUNT_CODES)[number];

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = Readonly<Record<string, JsonValue>>;

/** +1 for debit normal accounts, -1 for credit normal ones. Balances are stored as `sign × SUM(amount)`. */
export function normalSign(type: AccountType): 1n | -1n {
  return type === 'asset' || type === 'expense' ? 1n : -1n;
}

export type LedgerAccount = {
  readonly id: string;
  readonly code: string | null;
  readonly type: AccountType;
  readonly currency: Currency;
  readonly allowNegative: boolean;
  readonly balance: bigint;
  readonly lastSeq: bigint;
  readonly createdAt: Date;
};

export type PostedEntry = {
  readonly entryId: string;
  readonly accountId: string;
  readonly currency: Currency;
  /** Raw signed: positive is a debit, negative a credit. */
  readonly amount: bigint;
  readonly seq: bigint;
  readonly balanceAfter: bigint;
};

export type PostedTransaction = {
  readonly id: string;
  readonly postingKey: string;
  readonly kind: TransactionKind;
  readonly description: string;
  readonly metadata: JsonObject;
  readonly reversesTransactionId: string | null;
  readonly createdAt: Date;
  /** In account id order. */
  readonly entries: readonly PostedEntry[];
};

export type EntryView = {
  readonly entryId: string;
  readonly transactionId: string;
  readonly seq: bigint;
  /** `sign × raw amount`: the change on the account's normal side. */
  readonly amount: bigint;
  readonly balanceAfter: bigint;
  readonly kind: TransactionKind;
  readonly description: string;
  readonly createdAt: Date;
};

export type AccountCheck = {
  readonly accountId: string;
  readonly cached: bigint;
  readonly rebuilt: bigint;
  readonly lastBalanceAfter: bigint | null;
  readonly ok: boolean;
};
