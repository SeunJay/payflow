// Tables owned by the ledger module (spec 0003). The guards that keep them
// balanced and append only live in hand written migrations, not here.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { ACCOUNT_TYPES, CURRENCIES, TRANSACTION_KINDS, type JsonObject } from './types.ts';

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    code: text().unique('ledger_accounts_code_unique'),
    type: text({ enum: ACCOUNT_TYPES }).notNull(),
    currency: text({ enum: CURRENCIES }).notNull(),
    allowNegative: boolean().notNull().default(false),
    balance: bigint({ mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    lastSeq: bigint({ mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    createdAt: timestamp({ withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    check('ledger_accounts_type_check', sql`type in (${inList(ACCOUNT_TYPES)})`),
    // Multi currency later only swaps this one constraint.
    check('ledger_accounts_currency_check', sql`currency = 'NGN'`),
    check('ledger_accounts_balance_check', sql`allow_negative or balance >= 0`),
    check('ledger_accounts_allow_negative_check', sql`not allow_negative or code is not null`),
    // Target of the entries composite FK, so an entry's currency always matches its account's.
    unique('ledger_accounts_id_currency_unique').on(t.id, t.currency),
  ],
);

export const ledgerTransactions = pgTable(
  'ledger_transactions',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    postingKey: text().notNull().unique('ledger_transactions_posting_key_unique'),
    kind: text({ enum: TRANSACTION_KINDS }).notNull(),
    description: text().notNull(),
    metadata: jsonb()
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    reversesTransactionId: uuid()
      .unique('ledger_transactions_reverses_transaction_id_unique')
      .references((): AnyPgColumn => ledgerTransactions.id, { onDelete: 'restrict' }),
    createdAt: timestamp({ withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  () => [
    check('ledger_transactions_posting_key_check', sql`length(posting_key) between 1 and 200`),
    check('ledger_transactions_kind_check', sql`kind in (${inList(TRANSACTION_KINDS)})`),
    check('ledger_transactions_description_check', sql`length(description) between 1 and 500`),
    check('ledger_transactions_reversal_check', sql`(kind = 'reversal') = (reverses_transaction_id is not null)`),
  ],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    transactionId: uuid()
      .notNull()
      .references(() => ledgerTransactions.id, { onDelete: 'restrict' }),
    accountId: uuid().notNull(),
    currency: text({ enum: CURRENCIES }).notNull(),
    seq: bigint({ mode: 'bigint' }).notNull(),
    amount: bigint({ mode: 'bigint' }).notNull(),
    balanceAfter: bigint({ mode: 'bigint' }).notNull(),
  },
  (t) => [
    check('ledger_entries_amount_check', sql`amount <> 0`),
    foreignKey({
      name: 'ledger_entries_account_currency_fk',
      columns: [t.accountId, t.currency],
      foreignColumns: [ledgerAccounts.id, ledgerAccounts.currency],
    }).onDelete('restrict'),
    unique('ledger_entries_account_seq_unique').on(t.accountId, t.seq),
    unique('ledger_entries_transaction_account_unique').on(t.transactionId, t.accountId),
  ],
);
