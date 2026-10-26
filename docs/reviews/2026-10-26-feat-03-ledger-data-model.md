# Review, feat/03-ledger-data-model, 2026-10-26

**Reviewed by**: Sonnet 5.5 (author on a different model)
**Scope**: 105 files changed vs main plus 5 untracked test files (about 40 read in depth), branch vs main
**Verdict**: Changes requested

## Summary
Adds the double entry ledger: three tables, hand written guard triggers (deferred balance check, append only, account column guard, no reversal of a reversal), a `post`/`reverse`/`listEntries`/`verify*` API, and a thorough integration suite. Design and sign handling are sound, lock ordering is correct, and bigint is used throughout. The headline issue is that the "key first" idempotency rule (AC-7/AC-8) is only checked before the row locks, so a concurrent replay against the same accounts surfaces the wrong error. `verify` also does not check what the spec says it checks for `seq`.

## Major
### 🟠 Posting key is not re-checked after the locks, so a concurrent replay gets 422 or `already_reversed` instead of 409, `packages/core/src/modules/ledger/post.ts:128-165` (and `:61-73`)
**Problem**: `assertKeyUnused` runs before the account locks (`post.ts:44`, `:58`). When two requests with the same key touch the same accounts, the second blocks at the `FOR UPDATE` lock. When the first commits, the second proceeds with the new balances and runs the funds check (`:145`) before it reaches the `ON CONFLICT` insert (`:158`) that would turn it into `duplicate_posting`. If the first posting drained the account, the replay throws 422 `insufficient_funds`. Likewise a concurrent replay of the same reversal key blocks on the original's row lock (`:65`), then finds the first reversal and throws `already_reversed` (`:73`) instead of `duplicate_posting`.
**Why it matters**: AC-7 states the key is checked before funds, and the follow-up features (6 and 9) are meant to treat 409 `duplicate_posting` as "already done, replay". A retry racing the original request is exactly the case idempotency keys exist for, and here it reports a hard failure for money that was in fact moved. The deterministic duplicate test (c) uses disjoint accounts, so it does not reach this path.
**Suggested fix**: After taking the account locks (and, for `reverse`, after the transaction row lock) re-run the key lookup before the funds check and before the `already_reversed` check. Keep the `ON CONFLICT` as the last line of defence. Add integration tests with overlapping accounts: a drained-wallet debit replayed concurrently, and the same reversal key replayed concurrently.

## Minor
### 🟡 `verify` does not check the `seq` invariants the spec says it checks, `packages/core/src/modules/ledger/verify.ts:36`
**Problem**: The spec's invariant list says `seq` is gapless 1..`last_seq` and "checked by `verify*`". The query only compares the balance and `balance_after` at `seq = last_seq`. If `last_seq` is tampered upward on an account whose rebuilt balance is 0 (for example deposit then reversal), `last_balance_after` is null and `ok` is true. Gaps, duplicates and a stale `last_seq` with a non zero balance that happens to match are also invisible.
**Why it matters**: The verifier is the only defence for the app enforced invariants, and the next `post` would write `seq` off by the tampered amount, breaking history cursors.
**Suggested fix**: Also select `count(e.*)` and `max(e.seq)` and flag the account unless both equal `last_seq`. Add a drift test for `last_seq` tampering.

### 🟡 Account INSERT is unguarded, `packages/core/migrations/0002_ledger_guards.sql:94-101`
**Problem**: The account guard covers UPDATE only. A raw INSERT can create an account with a non zero `balance` or `last_seq` and no entries.
**Why it matters**: Minted balance with no entries; only `verify` would catch it. The spec accepts raw `UPDATE balance`, but an INSERT check is cheap and closes the same hole at creation.
**Suggested fix**: Either add a BEFORE INSERT trigger or CHECK-by-trigger requiring `balance = 0 and last_seq = 0`, or record it explicitly in the spec as an accepted gap.

### 🟡 Reverse takes the transaction row lock before account locks, which the locking contract does not mention, `packages/core/src/modules/ledger/post.ts:61-65`
**Problem**: `reverse` locks the original transaction row, then accounts. A caller that already holds account locks in the same unit of work (for example `post` then `reverse`) can deadlock with another `reverse` of the same transaction that holds the transaction lock and waits for those accounts.
**Why it matters**: The locking contract in the spec and `index.ts` only speaks of account order.
**Suggested fix**: Extend the contract doc comment: call `reverse` before taking any ledger account locks in the unit of work.

### 🟡 Cursor regex admits values beyond bigint range, `packages/core/src/modules/ledger/input.ts:38`
**Problem**: `[1-9][0-9]{0,18}` accepts 9999999999999999999 (above 2^63-1). It parses to a JS bigint, then Postgres rejects it with a raw "out of range" error instead of the ledger's `invalid input` error.
**Why it matters**: Still a plain Error, but with an unhelpful message and a pg code leaking out of a validation path.
**Suggested fix**: Add a refinement that the parsed value is at most 2^63-1.

## Nits
- ⚪ `packages/core/src/modules/ledger/post.ts:90-96`, `assertReadCommitted` costs an extra round trip per post/reverse; acceptable, but could be folded into the first locking query if post latency matters later.
- ⚪ `packages/core/migrations/0001_ledger_seed_test_funding.sql:5`, `ON CONFLICT DO NOTHING` silently keeps a pre-existing `test_funding` row with different attributes; fine for a lab.
- ⚪ `packages/core/src/modules/ledger/concurrency.int.test.ts:90-99`, the soak uses `Math.random`, so a failure is not reproducible; log or seed the picks.
- ⚪ `packages/core/src/modules/ledger/errors.ts:3`, exports lack doc comments (not re-exported from `index.ts`, so the rule is not strictly triggered).

## Strengths
- Locking is correct: accounts are locked with `ORDER BY id FOR UPDATE`, balances are computed from the locked rows, and AC-12 has a deterministic schedule plus a negative control that provably deadlocks (40P01).
- Sign conventions are consistent: raw signed amount in `post`/`reverse`, normal side in balances, `balance_after` and `listEntries`, and `balance_after` and `seq` come from `RETURNING` of the locked update.
- Guards are layered well: deferred constraint triggers on both tables, composite currency FK, `ON CONFLICT DO UPDATE` is blocked by the UPDATE triggers, TRUNCATE is covered, and raw SQL bypass tests exist for each.
- The `verify` single statement snapshot claim holds under read committed (one statement, one snapshot), and the bigint round trip through `numeric` text is handled correctly.
- Tooling scripts are small, tested, and fail closed (missing gitleaks refuses the commit).

## Test coverage
Strong: 37 unit and 103 integration tests cover all 12 ACs, raw SQL bypasses, rollback, pagination edges, verify drift, and concurrency. Gaps: concurrent same key replay on overlapping accounts (the Major above), `last_seq` tampering in verify, and an out of range cursor. Tooling was given a lighter pass; no real problems found there.
