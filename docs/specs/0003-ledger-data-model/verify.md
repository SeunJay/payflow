# Verify: Ledger data model · spec 0003 · updated 2026-10-25
_Steps derived from spec 0003 acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones. You run SQL as the `payflow` role (for example `docker exec -it payflow-lab-postgres-1 psql -U payflow -d payflow`)._

## Commands
- [ ] `pnpm run up && pnpm db:migrate` on a fresh volume → migrations `0000_ledger_tables`, `0001_ledger_seed_test_funding`, `0002_ledger_guards` apply; `select code, type, currency, allow_negative from ledger_accounts` shows `test_funding | equity | NGN | t` → AC-11
- [ ] `\d ledger_entries` → composite FK `(account_id, currency)` to `ledger_accounts (id, currency)`, unique `(account_id, seq)` and `(transaction_id, account_id)`, CHECK `amount <> 0`, deferred `ledger_entries_balanced` trigger → AC-1, AC-4
- [ ] `pnpm --filter @payflow/core ledger:verify` on clean books → logs `driftCount: 0`, exit code 0 → AC-10
- [ ] `update ledger_accounts set balance = balance + 1 where code = 'test_funding'`, then `ledger:verify` → one `ledger drift` error line with string amounts, exit code 1; undo with `balance - 1` and it exits 0 again → AC-10
- [ ] `pnpm test:int` → all ledger files pass (post, guards, reverse, history, verify, concurrency) → AC-1 to AC-12

## Database guards (raw SQL, in one `begin; ... commit;`)
- [ ] Insert a transaction plus entries `+100` and `-50` → COMMIT fails with `ledger: transaction ... does not balance in NGN` → AC-1
- [ ] Insert a transaction with one entry, or none → COMMIT fails with `needs at least 2` → AC-1
- [ ] `update`, `delete`, and `truncate ... cascade` on `ledger_transactions` and `ledger_entries` → each fails with `ledger: ... is not allowed` → AC-3
- [ ] `update ledger_accounts set type = 'asset'` (also `code`, `currency`, `allow_negative`, `created_at`, `id`) → fails with `ledger: only balance and last_seq`; `set balance = balance` succeeds; `delete` and `truncate` fail → AC-3
- [ ] Entry with `currency = 'USD'` on an NGN account → FK violation `23503`; `insert into ledger_accounts (type, currency) values ('liability', 'USD')` → CHECK `ledger_accounts_currency_check` → AC-4
- [ ] Wallet (no `code`) with `allow_negative = true` → CHECK `ledger_accounts_allow_negative_check`; `update ... set balance = -1` on a wallet → CHECK `ledger_accounts_balance_check` → AC-6
- [ ] Insert a `reversal` whose `reverses_transaction_id` is itself a reversal → `ledger: transaction ... is a reversal and cannot be reversed` → AC-8

## Behavior through the API (`@payflow/core` functions, inside `withTx`)
- [ ] `openAccount` a liability, `post` a `test_deposit` of `1000000n` from `test_funding` → `getBalance` is `1000000n` NGN; one history item with amount `+1000000`, `balance_after` `1000000`, `seq` 1 → AC-5, AC-9, AC-11
- [ ] Same `post`, then throw inside the same `withTx` → no transaction under that key, both balances and `last_seq` unchanged → AC-5
- [ ] `post` with each malformed input (blank key, key over 200, blank description, unknown kind, non uuid id, 1 or 51 entries, `number` amount, zero amount, unbalanced sum, same account twice, unknown account, bigint or Infinity in metadata) → plain `Error`, not `AppError`, zero rows → AC-2
- [ ] `post` inside `withTx(..., { isolationLevel: 'serializable' })` → plain `Error` naming read committed → AC-2
- [ ] Spend from an empty wallet → `AppError` 422 `insufficient_funds`, detail `Account <id> would go below zero` → AC-6
- [ ] Replay a posting key → 409 `duplicate_posting` naming the first transaction id; fund, drain, replay the drain → still 409, not 422 → AC-7
- [ ] Two concurrent posts with one key on disjoint accounts → exactly one transaction, the other gets 409 → AC-7
- [ ] `reverse` a deposit → entries negated, `reverses_transaction_id` set, balances restored; replay its key → `duplicate_posting`; new key → `already_reversed`; reverse the reversal → plain `Error`; reverse a spent deposit → `insufficient_funds` → AC-8
- [ ] Two concurrent reversals of one transaction → exactly one succeeds → AC-8
- [ ] 120 postings, `listEntries` with `limit: 50` → pages of 50, 50, 20, newest first; exactly 100 → 2 pages, `nextCursor: null` on the second; cursor `abc` or `limit: 0` → plain `Error` → AC-9
- [ ] Opposite order postings on the same two accounts, queued behind a lock → both succeed and `verifyLedger` shows no drift; the input order control deadlocks with `40P01` → AC-12

## Value sourcing (one step per row)
- [ ] `openAccount` → `id` is a uuidv7, `created_at` set by the DB, `balance` and `last_seq` start at 0 → defaults row
- [ ] `openAccount` with `type`, `currency`, `code`, `allowNegative` → stored exactly as given → input params row
- [ ] `post` → stored `posting_key` and `description` are the trimmed inputs; `kind`, `metadata`, raw `amount` as given → input params row
- [ ] `post` → each entry's `currency` comes from the locked account row, never the input (an input cannot carry one) → entry currency row
- [ ] Post `+10` to an asset account and `-10` to a liability → both balances rise by 10 (normal side sign from `type`) → sign row
- [ ] Two postings on one account → `seq` 1 then 2, each `balance_after` equals the balance right after it → `RETURNING` row
- [ ] `post` result `id` and `createdAt` match the stored `ledger_transactions` row → transaction `RETURNING` row
- [ ] Duplicate key → the id in `detail` is the existing row's id, both for a sequential replay and after a concurrent conflict → duplicate lookup row
- [ ] `reverse` → each entry is the original's `amount` negated on the same `account_id` → reversal entries row
- [ ] `already_reversed` → `detail` names the id of the existing reversal → reversal lookup row
- [ ] `getBalance` → equals the `ledger_accounts.balance` column and currency → balance row
- [ ] `listEntries` on an equity account (credit normal) after a `+10` debit → displayed amount `-10` (sign × raw) → displayed amount row
- [ ] `listEntries` items carry the joined transaction's `kind`, `description`, `created_at` → join row
- [ ] `listEntries` `nextCursor` is the last kept `seq` as a decimal string, null when no extra row exists → pagination row
- [ ] `verifyAccount` `cached`, `rebuilt`, `lastBalanceAfter` match a manual `sum(amount)` and the `seq = last_seq` entry → verify values row
- [ ] Right cached balance but a wrong latest `balance_after` → `ok: false` → `ok` row
- [ ] `runLedgerVerify` → one `info` summary `{ checked, driftCount }`, one `error` per drifted account with string amounts, returns 1 → log and exit code row
- [ ] Test deposit uses `1_000_000n`, key `test_deposit:<accountId>`, description `Test deposit` → test constants row

## Acceptance criteria coverage
- AC-1 guards · AC-2 API (malformed, isolation) · AC-3 guards · AC-4 commands, guards · AC-5 API (deposit, rollback) · AC-6 guards, API · AC-7 API (replay, drain, concurrent) · AC-8 guards, API (reverse) · AC-9 API (deposit, pagination) · AC-10 commands · AC-11 commands, API · AC-12 API (concurrency), `pnpm test:int`
