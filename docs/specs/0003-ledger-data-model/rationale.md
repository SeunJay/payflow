# 0003. Ledger data model: rationale

Decision record for [index.md](index.md). `/develop` does not need this file.

## Context

Every money movement in PayFlow Lab (test deposits, transfers, provider deposits, withdrawals, fees, reversals) has to be recorded so the books prove themselves: money is never created or destroyed inside the ledger, only moved, and any balance can be explained from history. Fourteen later slices post through this model, and several of them (overspend protection, duplicate webhooks, held funds, reconciliation, compensating entries) are lessons about what happens when code is wrong or runs twice. The model therefore has to stay correct even when the application code calling it is buggy.

The stack is fixed by spec 0001: Postgres 18 (check and deferred constraints, triggers, row locks, `uuidv7()`), Drizzle over `pg`, money as `bigint` minor units, writes inside an explicit `tx: Tx`, one owning database role, migrations as committed SQL with hand edits allowed. Spec 0001 assigned "wallet accounts and system accounts" to `wallets` and "transactions and entries, the only writer of ledger tables" to `ledger`, which pulls in two directions once balances are cached.

Scope fixes the bar for "done": an unbalanced transaction cannot be saved, entries cannot be updated or deleted, and any wallet balance can be rebuilt from entries alone. It is NGN only for now, with multi currency and FX deferred but expected. Feature 5 must later prove that two concurrent overspends produce exactly one success, so the ledger needs to give it a sound locking base without taking over its design. There are no users or HTTP routes yet (auth arrives in feature 4).

Getting this wrong is expensive: every later migration, query, and test builds on the sign convention, the account model, and where the invariants live.

## Options considered

### Option 1: Derived only ledger with app level rules

Accounts, transactions, and signed entries. There is no stored balance: every read is `SUM(amount)`. Balancing and immutability are enforced in the `post` function only.

**Pros**: nothing derived can drift; smallest schema; easiest to read.
**Cons**: a raw SQL write or a future bug can save unbalanced or edited books, failing the scope's "cannot be saved" bar; every balance read scans entries; feature 5 loses a balance column to lock and constrain.

### Option 2: Signed entries, cached and running balances, database enforced invariants (chosen)

Ledger owned accounts with an accounting `type` and a cached normal side `balance`; signed entries carrying `balance_after`; a deferred constraint trigger for balance, triggers for immutability, a composite FK for currency, a CHECK for no overdraft, and a required unique `posting_key`. `post` locks accounts in id order and updates balances in the caller's transaction.

**Pros**: the database refuses bad books whatever the caller does; O(1) balance reads and a running balance for history; per account serialisation and a CHECK give feature 5 a sound base; drift is detectable per entry.
**Cons**: a stored derived value to keep right; triggers live in hand written SQL that Drizzle doesn't model; hot accounts serialise writes.

### Option 3: Direction column with positive amounts, balances maintained by triggers

Entries carry `direction` (`debit`/`credit`) and a positive `amount`; an AFTER INSERT trigger updates the account balance and fills `balance_after` itself, so the app never computes balances.

**Pros**: reads like an accounting textbook; balance math lives in one place the app can't bypass.
**Cons**: every sum needs a CASE, so sign bugs move into queries; business logic hidden in PL/pgSQL is harder to test and to read for a TypeScript learner; the overdraft check fires as an opaque constraint error instead of a clear `insufficient_funds` decided under a lock the app controls.

## Rationale

The scope's done line is about what cannot be saved, not what the app usually avoids, so the core invariants (balance, immutability, currency match, no overdraft) must live in Postgres; that rules out Option 1. Between 2 and 3, the deciding force is that this is a learning lab in TypeScript whose later lessons (feature 5's locking, feature 6's replay) are about application code under concurrency: keeping the balance math in `post`, under explicit `FOR UPDATE` locks taken in id order, keeps that logic visible and testable, while the database stays a backstop rather than the engine. Signed amounts make the balancing rule a single `SUM = 0`, which is also simpler to enforce in a trigger.

Ledger owns accounts (rather than `wallets`, as spec 0001 sketched) because a cached balance is ledger data: keeping it in another module's table would break the "only ledger writes ledger tables" rule the slices depend on. A required `posting_key` adds a second layer of duplicate protection under features 6 and 9 at almost no cost. Recording only `created_at`, no account lifecycle, and seeding only `test_funding` follow the same rule: build what the next slice needs, and let each later slice add its own accounts, kinds, and columns with small additive migrations.

The engineer picked every recommendation during the design conversation. One detail was refined while writing: `currency` is `text` with a CHECK instead of `char(3)`, following the installed `postgresql-table-design` skill's guidance to avoid `char(n)`. The behaviour is the same.

### Refinements from the cross check

An independent review of the draft (2026-10-25) led to these changes, all accepted by the engineer:
- A per account `seq` (backed by `ledger_accounts.last_seq`) replaces UUIDv7 ordering for history and verification, because UUIDv7 order across connections depends on the clock.
- `post` and `reverse` check the posting key before funds, so a replay always reports `duplicate_posting`, and `ON CONFLICT` targets `posting_key` only.
- Both require read committed, because `FOR UPDATE` and the duplicate lookup fail with serialization errors at stricter levels.
- Balances are written as `balance + delta ... RETURNING`, verification reads each account in one statement, and `created_at` uses `clock_timestamp()`.
- New database guards: only system accounts may go negative, and a reversal cannot reverse a reversal. Appending to an old transaction stays app enforced, because an `xmin` based check breaks under savepoints.
- Concurrency tests are deterministic (one transaction held open while the other starts), with a negative control that proves the deadlock test can fail.

### Refinement from the code review (2026-10-26)

A fresh model review of the built branch found that "key before funds" only held for a sequential replay. A concurrent replay that shares accounts with the first post waits on the account locks, then reads the drained balance and got 422 `insufficient_funds`. A concurrent replay of a reversal key waited on the transaction row lock and got `already_reversed`. Both broke the idempotency promise of AC-7 and AC-8. The tests only raced posts on disjoint accounts, where `ON CONFLICT` already answers correctly.

Options weighed:
- **Check the key again right after each lock (chosen).** Under read committed, every new statement sees rows committed before it starts, so a lookup placed after the lock wait sees the winner. One extra indexed `SELECT`, no new lock, and the lock order stays exactly as it was. Con: the key is looked up twice on every call.
- **Take a transaction scoped advisory lock on a hash of the posting key before the account locks.** This serialises replays up front. Con: a second kind of lock with its own ordering rules, hash collisions that serialise unrelated posts, and one more thing a caller's locking contract must respect.
- **Insert the transaction row (`ON CONFLICT DO NOTHING`) before the funds check.** The insert itself would wait on the key and answer 409. Con: a caller that catches `insufficient_funds` and keeps going would be left with a transaction row that has no entries, which the deferred balance trigger then rejects at COMMIT, failing the caller's whole unit of work far from the cause.

The engineer accepted the first option. The early check stays, so the common sequential replay still answers before taking any lock.

Cross check (Sonnet, 2026-10-26) confirmed the fix holds under read committed and matches the code. The engineer accepted its follow-ups: the AC text now covers a rolled back winner and payload blind keys, step 4 states that one shared account is enough, `reverse` lists its full check order, and the test plan adds partial overlap, post vs reverse on one key, and rollback schedules, each proven to be waiting via `pg_stat_activity`.
