# 0003. Double entry ledger with signed entries, cached balances, and database enforced invariants

**Date**: 2026-10-25
**Status**: In Progress

## Summary

Every movement of money in PayFlow Lab is recorded as a ledger transaction made of two or more entries that add up to zero (whatever leaves one account arrives in another). Postgres itself refuses books that don't balance, refuses any edit or delete of past entries, and refuses to let a wallet go below zero, so buggy application code can't corrupt the money. Each account keeps a cached balance and a running entry number, updated in the same database transaction as its entries, and a verify tool can rebuild every balance from the entries alone. This feature builds the tables, those guards, and a small `ledger` API (open an account, post, reverse, read, verify) that every later slice posts through.

## Requirements

**User stories**:
- As the engineer building a later slice (transfers, deposits, withdrawals, fees), I want one `post` function that either records a balanced movement or refuses it, so that no slice ever writes ledger rows by hand.
- As the platform operator, I want the database to refuse unbalanced, edited, or overdrawn books, and a command that rebuilds every balance from entries, so that I can prove the money is correct at any time.
- As a future history endpoint (feature 4), I want an account's balance and its entries, newest first and paginated, so that a user sees where their balance came from.

**Acceptance criteria**:
- **AC-1**: A ledger transaction whose entries do not sum to zero per currency, or that has fewer than two entries, is rejected at COMMIT by the database, even when the rows are inserted with raw SQL that bypasses `post`.
- **AC-2**: `post` and `reverse` reject malformed input before writing anything, with a plain `Error` (a programming bug, so a 500), not an `AppError`: input failing the Zod schema (lengths, uuid ids, entry count, JSON safe metadata), entries that don't sum to zero, a zero amount, the same account twice, an unknown account, or a call made at an isolation level other than read committed.
- **AC-3**: Any UPDATE, DELETE, or TRUNCATE on `ledger_transactions` or `ledger_entries` fails with an error. On `ledger_accounts`, only `balance` and `last_seq` may be updated; changing any other column, DELETE, and TRUNCATE all fail.
- **AC-4**: An entry whose currency differs from its account's currency cannot be saved, and only `NGN` accounts can be created.
- **AC-5**: A successful `post` writes one transaction row and one entry per account; each entry's `balance_after` equals that account's new balance and its `seq` is the account's previous `last_seq` plus one; each account's cached `balance` and `last_seq` are updated in the same unit of work. If the caller's unit of work rolls back, no ledger rows exist and no account has changed.
- **AC-6**: A posting that would take an account with `allow_negative = false` below zero raises `AppError` 422 `insufficient_funds` and writes nothing. The `CHECK (allow_negative OR balance >= 0)` constraint also rejects such a balance when written with raw SQL, and only system accounts (non null `code`) may have `allow_negative = true`.
- **AC-7**: Posting with a `posting_key` that already exists raises `AppError` 409 `duplicate_posting` whose `detail` names the existing transaction id, and changes nothing. The key is checked before funds, so replaying a debit that already drained the account still gets 409, not 422. Two concurrent posts with the same key produce exactly one transaction.
- **AC-8**: `reverse` posts a `reversal` transaction whose entries are the exact negation of the original's and whose `reverses_transaction_id` points to it. Replaying the same reversal `posting_key` raises `duplicate_posting`. A second reversal of the same transaction under a new key, sequential or concurrent, raises `AppError` 409 `already_reversed`. Reversing a reversal is a programming bug (plain `Error`), and the database rejects it too. A reversal that would overdraw an account raises `insufficient_funds`.
- **AC-9**: `getBalance` returns an account's cached normal side balance and currency. `listEntries` returns the account's entries newest first by `seq`, each with its normal side `amount` (so previous balance + `amount` = `balance_after`), `balance_after`, the transaction's `kind`, `description`, and `created_at`, paginated by a `seq` cursor, with no empty trailing page.
- **AC-10**: `verifyAccount` and `verifyLedger` rebuild each balance from entries alone, each account in one consistent SQL snapshot, and report every account whose cached `balance`, or the `balance_after` of its highest `seq` entry, disagrees with the rebuild. `runLedgerVerify` returns 1 and logs the drift when any exists, 0 when the books are clean; `pnpm --filter @payflow/core ledger:verify` exits with that code.
- **AC-11**: After `pnpm db:migrate`, the system account `test_funding` (equity, NGN, `allow_negative = true`) exists. A `test_deposit` posting of 1,000,000 kobo from `test_funding` to a newly opened liability account leaves that account at a balance of 1,000,000 (₦10,000) with one history item backed by two balanced entries.
- **AC-12**: Concurrent postings that touch the same accounts in opposite orders all complete without deadlock, and afterwards every balance equals the rebuild from entries.

## Decision

**Chosen option**: Option 2: signed entries with cached and running balances, guarded by database triggers and constraints (see [rationale.md](rationale.md) for all options).

The `ledger` module owns accounts, transactions, and entries. Postgres enforces balance, immutability, currency match, and no overdraft. The `post` function checks the posting key, locks the touched accounts in id order, updates cached balances and entry numbers, and writes entries carrying `balance_after` and `seq`, all inside the caller's read committed `tx`.

**Implementation skills**: `drizzle-orm-patterns` (`giuseppe-trisciuoglio/developer-kit`, `.claude/skills/drizzle-orm-patterns/`) · `drizzle` (`bobmatnyc/claude-mpm-skills`, `.claude/skills/drizzle/`) · `postgresql-table-design` (`wshobson/agents`, `.claude/skills/postgresql-table-design/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`). Where a skill conflicts with this spec, this spec wins.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Sign convention (read this first)

- `ledger_entries.amount` is signed: **positive is a debit, negative is a credit**. The entries of every transaction sum to zero per currency.
- Each account has a **normal side** from its `type`. `asset` and `expense` are debit normal (`sign = +1`); `liability`, `equity`, and `revenue` are credit normal (`sign = -1`).
- `ledger_accounts.balance` and `ledger_entries.balance_after` are stored **on the normal side**: `balance = sign × SUM(amount)`. A funded wallet (a liability) therefore shows a positive balance.
- **Raw vs displayed amounts.** `post` and `reverse` take and return the raw signed `amount`. `listEntries` returns `sign × amount` (the change on the account's normal side), so a wallet deposit reads `+1000000`.
- Worked example (AC-11): a test deposit of ₦10,000 posts `+1000000` on `test_funding` (equity, so its balance becomes `-1000000`, which is allowed) and `-1000000` on the wallet account (liability, so its balance becomes `+1000000`; its history shows amount `+1000000`, `balance_after` `1000000`).

### Data model sketch

All tables live in `packages/core/src/modules/ledger/schema.ts`. IDs default to Postgres `uuidv7()`. Drizzle `casing: 'snake_case'`. All `bigint` columns use `mode: 'bigint'`.

**`ledger_accounts`**
| Column | Type | Null | Rules |
|---|---|---|---|
| `id` | uuid | no | PK, default `uuidv7()` |
| `code` | text | yes | UNIQUE. Set only on system accounts (`test_funding`); null on wallet accounts |
| `type` | text | no | CHECK in (`asset`, `liability`, `equity`, `revenue`, `expense`) |
| `currency` | text | no | CHECK `currency = 'NGN'` (named `ledger_accounts_currency_check`, so multi currency later only swaps this constraint) |
| `allow_negative` | boolean | no | default `false` |
| `balance` | bigint | no | default `0`, normal side |
| `last_seq` | bigint | no | default `0`; the `seq` of the account's latest entry |
| `created_at` | timestamptz | no | default `clock_timestamp()` |

Table constraints: `CHECK (allow_negative OR balance >= 0)`; `CHECK (NOT allow_negative OR code IS NOT NULL)` (only system accounts may go negative); `UNIQUE (id, currency)` (target of the entries composite FK).

**`ledger_transactions`**
| Column | Type | Null | Rules |
|---|---|---|---|
| `id` | uuid | no | PK, default `uuidv7()` |
| `posting_key` | text | no | UNIQUE, CHECK `length(posting_key) BETWEEN 1 AND 200` |
| `kind` | text | no | CHECK in (`test_deposit`, `reversal`). A label only in this feature; each later slice extends the list in its own migration |
| `description` | text | no | CHECK `length(description) BETWEEN 1 AND 500` |
| `metadata` | jsonb | no | default `'{}'` |
| `reverses_transaction_id` | uuid | yes | FK → `ledger_transactions.id` ON DELETE RESTRICT; UNIQUE |
| `created_at` | timestamptz | no | default `clock_timestamp()` (the moment of the insert, not the caller's transaction start) |

Table constraint: `CHECK ((kind = 'reversal') = (reverses_transaction_id IS NOT NULL))`.

**`ledger_entries`**
| Column | Type | Null | Rules |
|---|---|---|---|
| `id` | uuid | no | PK, default `uuidv7()` |
| `transaction_id` | uuid | no | FK → `ledger_transactions.id` ON DELETE RESTRICT |
| `account_id` | uuid | no | part of composite FK |
| `currency` | text | no | composite FK `(account_id, currency)` → `ledger_accounts (id, currency)` ON DELETE RESTRICT |
| `seq` | bigint | no | per account entry number, starting at 1, gapless; history order and cursor |
| `amount` | bigint | no | CHECK `amount <> 0`; raw signed |
| `balance_after` | bigint | no | the account's normal side balance right after this entry |

Table constraints: `UNIQUE (account_id, seq)` (also serves history and verify); `UNIQUE (transaction_id, account_id)` (one entry per account per posting, also serves the balance trigger and reversals).

**Relationships**: account 1:N entries · transaction 1:N entries (at least 2) · transaction 0..1 : 0..1 reversal.

**Not in this feature**: the `wallets` table (user → ledger account) arrives with feature 4, because it needs `users`. Other system accounts (cash at provider, withdrawals in flight, fee revenue, fee expense) are seeded by the slices that need them.

### Database guards (hand written migrations)

Generate with `pnpm --filter @payflow/core db:generate --custom --name=<name>`, after the generated table migration.

1. **Balance at commit** (`ledger_guards`). Function `ledger_check_transaction_balanced(txn_id)` raises unless the transaction has at least 2 entries and `SUM(amount) = 0` for every currency. Called by two `CONSTRAINT TRIGGER ... AFTER INSERT ... DEFERRABLE INITIALLY DEFERRED FOR EACH ROW` triggers: one on `ledger_transactions` (catches zero or one entry) and one on `ledger_entries` (catches unbalanced sums).
2. **Immutability.** A `BEFORE UPDATE OR DELETE ... FOR EACH ROW` trigger and a `BEFORE TRUNCATE ... FOR EACH STATEMENT` trigger on `ledger_transactions` and `ledger_entries`, each raising.
3. **Account guard.** On `ledger_accounts`: `BEFORE UPDATE FOR EACH ROW` raises if any column other than `balance` and `last_seq` differs (`OLD.id IS DISTINCT FROM NEW.id`, and so on); `BEFORE DELETE` and `BEFORE TRUNCATE` raise.
4. **No reversal of a reversal.** `BEFORE INSERT` on `ledger_transactions`: when `reverses_transaction_id` is set and the target's `kind = 'reversal'`, raise.
5. **Seed** (`ledger_seed_test_funding`). Inserts `test_funding` (`equity`, `NGN`, `allow_negative = true`) with `ON CONFLICT (code) DO NOTHING`.

All guards raise with `ERRCODE = 'P0001'` and a message starting `ledger:`, so tests can match on it.

**App enforced, not database enforced**: entries are inserted only into the transaction `post` just created, and a reversal is the exact negation of its original. The database cannot tell a new transaction from an old one without fragile `xmin` checks (savepoints break them), so these rest on `post` being the only writer, plus `verify*`.

### API surface

Internal TypeScript functions exported from `packages/core/src/modules/ledger/index.ts` and from the `@payflow/core` entry, each with a doc comment. No HTTP route in this feature. Writers take `tx: Tx` first; readers take `db: Db | Tx`.

| Function | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `openAccount(tx, input)` | write | `type: AccountType` (req), `currency: 'NGN'` (req), `code: string` (opt), `allowNegative: boolean` (opt, default false; true requires `code`) | `LedgerAccount` | trusted caller | DB CHECK or unique violation on `code` (bug) |
| `post(tx, input)` | write | `postingKey` (req), `kind: TransactionKind` (req), `description` (req), `metadata: JsonObject` (opt), `entries: readonly { accountId: string; amount: bigint }[]` (req) | `PostedTransaction` | trusted caller | 409 `duplicate_posting`, 422 `insufficient_funds`, plain `Error` for malformed input |
| `reverse(tx, input)` | write | `transactionId` (req), `postingKey` (req), `description` (req) | `PostedTransaction` | trusted caller | 409 `duplicate_posting`, 409 `already_reversed`, 422 `insufficient_funds`, plain `Error` (unknown id, reversing a reversal) |
| `getBalance(db, accountId)` | read | `accountId` | `{ accountId, currency, balance: bigint }` | trusted caller | plain `Error` if unknown |
| `listEntries(db, accountId, page)` | read | `accountId`, `cursor?: string` (a decimal `seq`), `limit?: number` (integer 1..100, default 50) | `{ items: readonly EntryView[]; nextCursor: string \| null }` | trusted caller | plain `Error` if unknown account, bad cursor, or bad limit |
| `getSystemAccount(db, code)` | read | `code: SystemAccountCode` (`'test_funding'`) | `LedgerAccount` | trusted caller | plain `Error` if missing (migrations not run) |
| `verifyAccount(db, accountId)` | read | `accountId` | `AccountCheck` | trusted caller | plain `Error` if unknown |
| `verifyLedger(db)` | read | none | `{ checked: number; drift: readonly AccountCheck[] }` (`checked` = accounts examined, `drift` = those with `ok: false`) | trusted caller | none |
| `runLedgerVerify(db, logger)` | read | a `Db` and a Pino `Logger` | `Promise<0 \| 1>` | local only | none |
| `ledger:verify` script | CLI | `DATABASE_URL` | exit code from `runLedgerVerify` | local only | config error at boot |

**Types**:
- `JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }`; `JsonObject = { readonly [key: string]: JsonValue }` (no `bigint`, so `JSON.stringify` never throws).
- `LedgerAccount = { id, code: string | null, type, currency, allowNegative, balance: bigint, lastSeq: bigint, createdAt: Date }`.
- `PostedTransaction = { id, postingKey, kind, description, metadata: JsonObject, reversesTransactionId: string | null, createdAt: Date, entries: readonly { entryId, accountId, currency, amount: bigint /* raw signed */, seq: bigint, balanceAfter: bigint }[] }`, entries in account id order.
- `EntryView = { entryId, transactionId, seq: bigint, amount: bigint /* sign × raw */, balanceAfter: bigint, kind, description, createdAt: Date }`.
- `AccountCheck = { accountId, cached: bigint, rebuilt: bigint, lastBalanceAfter: bigint | null, ok: boolean }`.

**Input schema** (Zod, in `ledger/`; a failure throws a plain `Error` carrying the Zod issues): `postingKey` and `description` trimmed length 1..200 and 1..500; `kind` in the `TransactionKind` list; `accountId` and `transactionId` uuid; `entries` length 2..50; `amount` a `bigint` (`z.bigint()`) not equal to `0n`; `metadata` JSON safe.

**`post` algorithm** (all in the caller's `tx`):
1. Assert `current_setting('transaction_isolation') = 'read committed'`, else plain `Error`. Parse the input with the Zod schema.
2. Validate the shape in memory: no repeated `accountId`, `SUM(amount) = 0`. Fail with a plain `Error`.
3. **Key first**: `SELECT id FROM ledger_transactions WHERE posting_key = $1`. Found → `AppError` 409 `duplicate_posting`.
4. Lock the accounts: `SELECT ... FROM ledger_accounts WHERE id IN (...) ORDER BY id FOR UPDATE`. Fewer rows than distinct ids → plain `Error` (unknown account).
5. Group the amounts by account currency and check each group sums to zero (plain `Error` otherwise).
6. Compute each new balance as `locked.balance + sign(type) × amount`. Any negative where `allow_negative` is false → `AppError` 422 `insufficient_funds`.
7. Insert the transaction with `ON CONFLICT (posting_key) DO NOTHING RETURNING id, created_at`. No row → a concurrent post just won the key: look up its id and throw 409 `duplicate_posting`. Any other unique violation propagates (a bug).
8. In account id order: `UPDATE ledger_accounts SET balance = balance + $delta, last_seq = last_seq + 1 WHERE id = $id RETURNING balance, last_seq`, where `$delta = sign(type) × amount`.
9. Insert the entries with `currency` from the locked row, `balance_after` and `seq` from step 8's returned values.
10. Return the `PostedTransaction`. No logging inside the ledger; callers log at the edge.

**`reverse`**: assert read committed and parse the input; check the posting key first (409 `duplicate_posting`); `SELECT ... FROM ledger_transactions WHERE id = $1 FOR UPDATE` (serialises concurrent reversals; a row lock fires no UPDATE trigger). Unknown id or `kind = 'reversal'` → plain `Error`. An existing row with `reverses_transaction_id = $1` → 409 `already_reversed`. Otherwise run steps 4 to 10 with `kind: 'reversal'`, `reversesTransactionId`, `metadata: { reversed_posting_key }`, and every original amount negated.

**Error codes** (`AppError` from `@payflow/shared`, snake case like the existing codes):
| Code | Status | Title | `detail` |
|---|---|---|---|
| `insufficient_funds` | 422 | Insufficient funds | `Account <id> would go below zero` |
| `duplicate_posting` | 409 | Duplicate posting | `Posting key <key> already used by ledger transaction <id>` |
| `already_reversed` | 409 | Transaction already reversed | `Ledger transaction <id> was already reversed by <reversal id>` |

**Locking contract for callers**: `post` is deadlock free only if the caller holds no other row locks that a concurrent caller takes in a different order. Callers (features 5, 6, 9, 10) must call `post` before locking or writing their own rows in the same unit of work, or take their own locks in a consistent order.

### Value sourcing

| Action | Value produced / displayed | Source |
|---|---|---|
| `openAccount` | `id`, `created_at`, `balance`, `last_seq` | DB defaults (`uuidv7()`, `clock_timestamp()`, `0`, `0`) |
| `openAccount` | `type`, `currency`, `allow_negative`, `code` | input params |
| `post` | `posting_key`, `kind`, `description`, `metadata`, raw entry `amount` | input params |
| `post` | each entry `currency` | the locked `ledger_accounts.currency` row (never an input) |
| `post` | normal side sign | derived from `ledger_accounts.type` (sign convention above) |
| `post` | `balance_after`, `seq` | `RETURNING balance, last_seq` of the step 8 update |
| `post` | transaction `id`, `created_at` | `RETURNING` of the step 7 insert |
| `post` | existing id for `duplicate_posting` | `SELECT id FROM ledger_transactions WHERE posting_key = $1` (step 3, or after step 7's conflict) |
| `reverse` | reversal entries | the original's entries, `amount` negated, same `account_id` |
| `reverse` | reversal id for `already_reversed` | `SELECT id FROM ledger_transactions WHERE reverses_transaction_id = $1` |
| `getBalance` | `balance`, `currency` | `ledger_accounts` columns |
| `listEntries` | displayed `amount` | `sign(account.type) × ledger_entries.amount` |
| `listEntries` | `kind`, `description`, `created_at` | join to `ledger_transactions` |
| `listEntries` | order, page, `nextCursor` | `WHERE account_id = $1 AND seq < $cursor ORDER BY seq DESC LIMIT limit + 1`; when `limit + 1` rows return, drop the last and set `nextCursor` to the last kept `seq` as a decimal string, else null |
| `verifyAccount` / `verifyLedger` | `cached`, `rebuilt`, `lastBalanceAfter` | one SQL statement per call: the account row, `sign × COALESCE(SUM(amount), 0)` over its entries, and `balance_after` where `seq = last_seq`; numeric `SUM` results parsed to `bigint` |
| `verifyAccount` | `ok` | `cached = rebuilt AND (lastBalanceAfter IS NULL ? rebuilt = 0 : lastBalanceAfter = rebuilt)` |
| `runLedgerVerify` | log lines, exit code | `info` summary `{ checked, driftCount }`; one `error` line per drifted `AccountCheck` (bigints as strings); returns 1 when `drift.length > 0` |
| test deposit (AC-11) | ₦10,000 amount, key, description | test constants `1_000_000n`, `test_deposit:<accountId>`, `Test deposit`; feature 4 owns the real values |

### Key invariants

- Every transaction has at least 2 entries, and its amounts sum to zero per currency (DB deferred trigger + `post` validation).
- Transactions and entries are never updated, deleted, or truncated (DB triggers).
- An entry's currency equals its account's currency (composite FK). Only NGN exists (CHECK).
- An account with `allow_negative = false` never has `balance < 0` (CHECK + `post` check under lock); only system accounts may set `allow_negative` (CHECK).
- `ledger_accounts.balance = sign(type) × SUM(entries.amount)` and equals the `balance_after` of the entry with `seq = last_seq`; an account's `seq` values are 1..`last_seq` with no gaps (maintained by `post` under row locks; checked by `verify*`).
- One posting per `posting_key`; at most one reversal per transaction (DB unique); a reversal never reverses a reversal (DB trigger).
- Entries only join the transaction created in the same `post` call; reversals exactly negate the original (app enforced, see above).
- Only the `ledger` module writes these tables (spec 0001 rule). Money is `bigint` in TypeScript and Postgres, never `number`.

### Security model

No HTTP surface, no user data, no PII; money is simulated, so no compliance scope applies. Authorization (whose account a caller may post to or read) belongs to the calling slice (feature 4 onward); ledger functions trust their caller. The ledger's own protection is integrity: database guards that hold against application code and ad hoc SQL under the app role. They do not hold against someone deliberately running `ALTER TABLE ... DISABLE TRIGGER` or `session_replication_role = replica` as the owning role; a separate migration role is out of scope for this lab. The append only history is the audit trail (callers carry who and why in `description` and `metadata`; feature 14 adds actor fields if it needs them).

### Configuration required

No new environment variables. The `ledger:verify` script reads the existing `DATABASE_URL` through a Zod schema built with the `@payflow/shared` config helpers, closes the pool when done, and sets `process.exitCode`.

### Critical test scenarios

All are integration tests (`*.int.test.ts`) against the per file test database from `@payflow/test-utils` (spec 0001). Tests open fresh accounts and assert on deltas for `test_funding`, which is shared within a file. `kind` is only a label here, so tests move money between any accounts with `kind: 'test_deposit'`.
- Happy path: open a liability account, post a 1,000,000 kobo `test_deposit` from `test_funding`; balance is 1,000,000, one history item with amount `+1000000`, two entries summing to zero, `seq` 1, `balance_after` correct, verifies **AC-5**, **AC-9**, **AC-11**
- Raw SQL bypass: insert an unbalanced transaction, and a transaction with a single entry, directly; COMMIT fails, verifies **AC-1**
- Immutability: UPDATE, DELETE, and TRUNCATE on transactions and entries fail; on accounts, updating `type` fails while updating `balance` succeeds, verifies **AC-3**
- Currency and accounts: an entry with `currency = 'USD'` for an NGN account fails the FK; creating a `USD` account fails; a wallet (no `code`) with `allow_negative = true` fails, verifies **AC-4**, **AC-6**
- Malformed input: each bad shape and each Zod failure throws a plain `Error` and leaves zero rows; calling `post` inside `withTx(..., { isolationLevel: 'serializable' })` throws, verifies **AC-2**
- Overdraw: posting from an empty wallet throws `insufficient_funds`; a raw `UPDATE ... SET balance = -1` fails the CHECK, verifies **AC-6**
- Duplicate key, deterministic: (a) sequential replay gets 409 with the id in `detail`; (b) fund a wallet, spend it all, replay the spend: 409, not 422; (c) on disjoint accounts, open tx1 and post with key K without committing, start tx2 posting K (it blocks in `ON CONFLICT`), commit tx1; tx2 gets 409, verifies **AC-7**
- Rollback: `post` succeeds, then the caller throws inside `withTx`; no rows, balances and `last_seq` unchanged, verifies **AC-5**
- Reversal: reverse restores both balances with negated entries; replaying the reversal key gives `duplicate_posting`; a new key gives `already_reversed`; two concurrent reversals (tx1 held open, tx2 started, tx1 committed) give exactly one success; reversing a reversal throws, and a raw insert of one fails the trigger; reversing a spent deposit gives `insufficient_funds`, verifies **AC-8**
- Pagination: 120 postings, page with `limit: 50`; pages of 50, 50, 20, newest first, no gaps or repeats; exactly 100 postings with `limit: 50` gives 2 pages and `nextCursor: null` on the second; a non numeric cursor and `limit: 0` throw, verifies **AC-9**
- Verify: clean books report no drift and `runLedgerVerify` returns 0; drift injected with a raw `UPDATE ledger_accounts SET balance = balance + 1` (the guard allows `balance` changes) is reported and it returns 1, verifies **AC-10**
- Deadlock, deterministic: tx1 posts A→B and stays open while tx2 posts B→A, then tx1 commits; both succeed and balances match the rebuild. Negative control: a test helper that locks in input order instead of id order deadlocks (Postgres error `40P01`) under the same schedule, proving the test can fail. Plus 20 random direction postings on a pool of 10 as a soak, verifies **AC-12**
- Auth/permission: not applicable in this feature (no caller identity exists yet); feature 4 owns it.

## Build plan

Tracer Bullet: first a thin thread from migration to `post` to a passing integration test, then thicken it with guards, error paths, reversal, reads, and verification. Each step ends with green `pnpm typecheck`, `pnpm lint`, and `pnpm test:int`.

**Milestone 1: Thin thread (a test deposit lands)**
1. Write `ledger/schema.ts` with the three tables, columns, CHECKs, unique constraints, and composite FK above; run `db:generate`; review and commit the SQL, satisfies **AC-4**, **AC-5**
2. Add the `ledger_seed_test_funding` custom migration, satisfies **AC-11**
3. Implement `openAccount`, `getSystemAccount`, the happy path of `post` (steps 4, 6, 7, 8, 9: lock in id order, balance math, `RETURNING` updates, entries), and `getBalance`; export them with doc comments from `ledger/index.ts` and `@payflow/core`, satisfies **AC-5**, **AC-9**, **AC-11**
4. Integration test: the test deposit scenario plus the rollback scenario, satisfies **AC-5**, **AC-11**

**Milestone 2: Database guards**
5. Add the `ledger_guards` custom migration (deferred balance triggers, immutability triggers, account guard, no reversal of a reversal), satisfies **AC-1**, **AC-3**, **AC-8**
6. Raw SQL integration tests for balance, immutability, currency, system only `allow_negative`, and the no overdraft CHECK, satisfies **AC-1**, **AC-3**, **AC-4**, **AC-6**

**Milestone 3: Input, errors, and reversal**
7. The Zod input schema, the isolation assertion, and shape validation (plain `Error`s), satisfies **AC-2**
8. Key first `duplicate_posting` (steps 3 and 7) and `insufficient_funds`, with the deterministic duplicate tests, satisfies **AC-6**, **AC-7**
9. `reverse` with its row lock and `already_reversed`, with the deterministic concurrent test, satisfies **AC-8**

**Milestone 4: Reads, verification, and concurrency**
10. `listEntries` with `seq` keyset pagination and its tests, satisfies **AC-9**
11. `verifyAccount`, `verifyLedger`, `runLedgerVerify`, and the `ledger:verify` script (`tsx --env-file=../../.env scripts/ledger-verify.ts` in `packages/core/package.json`), with tests calling `runLedgerVerify` directly, satisfies **AC-10**
12. The deterministic opposite order test, its negative control, and the soak, satisfies **AC-12**

## Consequences

**Positive**:
- Every later slice is "another pattern of balanced entries" through one function; the database catches anything that slips past it.
- Balances read in O(1), history shows a running balance in a stable `seq` order, and drift is detectable down to a single entry.
- Account row locks in id order give feature 5 a deadlock free base for overspend protection.

**Negative / tradeoffs**:
- Every posting serialises on the touched account rows. A hot system account (later, cash at provider) becomes a write bottleneck under load; acceptable at lab scale, and a known pattern to revisit in the feature 17 load drill.
- The cached balance and `last_seq` are stored derived values that `post` must keep right. The DB does not recompute them; only `verify*` catches drift.
- Guards live in hand written SQL migrations that Drizzle does not model. Drizzle Kit will not regenerate or diff them, so any change to the ledger tables must keep the triggers in mind.
- Two rules (entries only in a new transaction, reversals as exact negations) are app enforced, not database enforced.
- `post` and `reverse` refuse to run above read committed, so a caller that wants serializable for its own work must post in a separate unit of work.
- A `duplicate_posting` still aborts the caller's work (it throws). Callers that want "already done, replay" (features 6 and 9) must catch it and act on the id in `detail`.
- Callers must respect the locking contract above, or they reintroduce deadlocks the ledger avoids.
- Only `balance` and `last_seq` are mutable on accounts, so changing `allow_negative` later needs a migration that temporarily disables the guard.

**Neutral**:
- `kind` is a CHECK list that each slice extends with a small migration.
- A raw SQL `UPDATE` of `balance` is still possible (the guard must allow it for `post`); `verify*` is what catches it.
- The spec 0001 module table said `wallets` owns system accounts; under this spec `ledger` owns every account and `wallets` only maps users to them.

## Follow-up

- [ ] Update the spec 0001 module table (`wallets` row: "user → ledger account mapping"; `ledger` row: "accounts, including system accounts, transactions, entries") so it matches this spec.
- [ ] Feature 4: create the `wallets` table (`user_id` UNIQUE FK → users, `ledger_account_id` UNIQUE FK → `ledger_accounts`), open a `liability` account per user, and post the test deposit with a `posting_key` such as `test_deposit:<user_id>`.
- [ ] Features 9, 10, and 14: seed their system accounts (`cash_at_provider` asset, `withdrawals_in_flight` liability, `fee_revenue`, `fee_expense`) and extend the `kind` CHECK in their own migrations.
- [ ] Feature 16: run `verifyLedger` on a schedule and alert on drift.
- [ ] Feature 17 load drill: measure contention on hot system accounts before considering sharded or batched system postings.
