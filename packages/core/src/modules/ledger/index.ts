// Public API of the ledger module (spec 0003). Writers take `tx: Tx` first;
// readers take `db: Db | Tx`. Callers authorize; the ledger trusts them.

/** Opens a ledger account. Only system accounts (with a `code`) may set `allowNegative`. */
export { openAccount, type OpenAccountInput } from './accounts.ts';

/** Looks up a seeded system account by code; a plain Error means the migrations have not run. */
export { getSystemAccount } from './accounts.ts';

/** An account's cached balance on its normal side, with its currency. */
export { getBalance } from './accounts.ts';

/**
 * Records a balanced movement of money, or refuses it: 409 `duplicate_posting`,
 * 422 `insufficient_funds`, or a plain Error for malformed input. Call it before
 * taking your own row locks in the same unit of work (the locking contract).
 */
export { post, type PostInput } from './post.ts';

/** Posts the exact negation of a transaction: 409 `duplicate_posting` or `already_reversed`, 422 `insufficient_funds`. */
export { reverse, type ReverseInput } from './post.ts';

/** An account's entries newest first by `seq`, paginated by a `seq` cursor. */
export { listEntries, type EntryPage } from './history.ts';

/** Rebuilds balances from entries and reports drift; `runLedgerVerify` returns the CLI exit code. */
export { verifyAccount, verifyLedger, runLedgerVerify } from './verify.ts';

/** Ledger value types and the lists their CHECK constraints mirror. */
export {
  ACCOUNT_TYPES,
  CURRENCIES,
  SYSTEM_ACCOUNT_CODES,
  TRANSACTION_KINDS,
  type AccountCheck,
  type AccountType,
  type Currency,
  type EntryView,
  type JsonObject,
  type JsonValue,
  type LedgerAccount,
  type PostedEntry,
  type PostedTransaction,
  type SystemAccountCode,
  type TransactionKind,
} from './types.ts';
