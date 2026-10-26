# Scope: PayFlow Lab

A simulated payment platform built to learn how fintech backends keep money correct when requests repeat, networks time out, workers crash, and two systems disagree. Users sign up, hold a wallet, fund it through a fake payment provider, send money to each other, and withdraw. Every step is built to survive failure and is proven by tests that force that failure.

**Build approach:** Tracer Bullet (each slice runs end to end through database, API, worker, and tests, real but narrow, before the next slice thickens it).
**Workflow:** Beta (after `/develop`: `/check verify`, then `/test`). The project default level of rigor. `/architect` is the recommended first stop for a feature with a real decision, but skippable when you already know the build. Any feature can carry its own tag (e.g. `· GA`) to do more or less.

_These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit: if you already know how to build a feature, use `/develop` and skip `/architect`. You decide when a feature is `done`._

_Learning companion: [docs/learning/concepts.md](../learning/concepts.md) explains every concept named below and shows which feature teaches it. Frontend work is noted but deferred, so your time goes to the backend._

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| 1 | Stack & architecture | Foundation | done |
| 2 | Coding standards & tooling | Foundation | done |
| 3 | Ledger data model | Foundation | done |
| 4 | Sign up, log in, and a funded wallet | Slice 1 | in-progress |
| 5 | Peer transfers with overspend protection | Slice 2 | planned |
| 6 | Idempotent transfer requests | Slice 3 | planned |
| 7 | Payment state machine | Slice 4 | planned |
| 8 | Payment provider simulator | Slice 5 | planned |
| 9 | Deposits through the provider with webhooks | Slice 6 | planned |
| 10 | Withdrawals with held funds | Slice 7 | planned |
| 11 | Transactional outbox and background worker | Slice 8 | planned |
| 12 | Retries, backoff, and dead letters | Slice 9 | planned |
| 13 | Reconciliation engine | Slice 10 | planned |
| 14 | Exception resolution and compensating entries | Slice 11 | planned |
| 15 | Rate limiting | Slice 12 | planned |
| 16 | Observability and alerts | Slice 13 | planned |
| 17 | Failure drills and reliability suite | Slice 14 | planned |

## Foundations

### 1. Stack & architecture · done
Decide the language, framework, database, queue, and test tooling, and the module boundaries of a modular monolith (one codebase, one primary database) with a separate worker process and a separate provider simulator app. Bring the stack suggestions you already have into that session as input.
**Done when:** the stack and module boundaries are recorded in a spec, and the API, worker, and simulator each boot locally against a local database with a passing build.
spec [0001](../specs/0001-stack-architecture/index.md) · code in `apps/`, `packages/`
- [x] Decide the stack (spec): `/architect stack & architecture`
- [x] Scaffold from the decision: `/develop stack & architecture`
- [x] Smoke check it runs: `/test`

### 2. Coding standards & tooling · done
Decide the git workflow (branching model, commit message style, how changes reach `main`, and what checks gate a merge), then capture conventions, then install lint, format, type strictness, and pre commit checks from the real scaffolded project, including a way to run tests against a real database.
**Done when:** the git workflow is recorded in a spec and in root `AGENTS.md` under `## Git`, root `AGENTS.md` reflects the real stack, and lint, format, and the test runner run clean.
spec [0002](../specs/0002-git-workflow.md)
- [x] Decide the git workflow (spec): `/architect git workflow`
- [x] Capture conventions + tooling choices: `/audit`
- [x] Install the tooling: `/develop tooling`
- [x] Check it runs clean: `/test`

### 3. Ledger data model · done · GA
The shape of money: user wallet accounts and platform system accounts, ledger transactions, ledger entries, amounts in integer minor units with a currency, and balances derived from entries. Every later slice posts through this, so it gets the most rigor.
**Done when:** a ledger transaction whose entries do not balance per currency cannot be saved, entries cannot be updated or deleted, and any wallet balance can be rebuilt from entries alone.
spec [0003](../specs/0003-ledger-data-model/index.md) · code in `packages/core/src/modules/ledger/`
- [x] Design it (spec): `/architect ledger data model`
- [x] Build it: `/develop ledger data model`
  - [x] Thin thread: schema, seed, and a test deposit posted end to end (AC-4, AC-5, AC-9, AC-11)
  - [x] Database guards: balance at commit, immutability, account guard, no reversal of a reversal (AC-1, AC-3, AC-4, AC-6, AC-8)
  - [x] Input, errors, and reversal: Zod input, duplicate posting, insufficient funds, reverse (AC-2, AC-6, AC-7, AC-8)
  - [x] Reads, verification, and concurrency: history pagination, ledger verify, deadlock tests (AC-9, AC-10, AC-12)
- [x] Verify it: `/check verify ledger data model`
- [x] Test it: `/test ledger data model`
- [x] Review it (fresh model): `/check review ledger data model`
- [x] Document it: `/document ledger data model`

## Phase 1: Money core

### 4. Sign up, log in, and a funded wallet · in-progress · GA
The walking skeleton. Real sign up and log in, a wallet created for each new user, an instant internal test deposit that posts balanced entries, and API reads for balance and history. No provider, no transfers yet.
**Done when:** a new user can sign up, log in, receive a ₦10,000 test deposit, and read a ₦10,000 balance with one history item backed by two balanced entries; calls without a valid session are rejected.
spec [0004](../specs/0004-signup-login-funded-wallet/index.md) · code in `packages/core/src/modules/identity/`, `packages/core/src/modules/wallets/`, `apps/api/src/`
- [x] Design it (spec): `/architect sign up, log in, and a funded wallet`
- [x] Build it: `/develop sign up, log in, and a funded wallet`
  - [x] Thin thread: schema, sign up with the funded wallet, log in, read ₦10,000, secrets redacted in logs (AC-1, AC-2, AC-5, AC-8, AC-14, AC-15)
  - [x] Input, errors, and authorization: JSON gate, validation, duplicate email race, invalid credentials, access token checks, history pagination, two user isolation (AC-3, AC-4, AC-6, AC-7, AC-8, AC-9)
  - [x] Refresh rotation, reuse detection, and log out, with the refresh race test and auth event logs (AC-10, AC-11, AC-12, AC-13, AC-14)
  - [x] Move the API into the [spec 0005](../specs/0005-api-feature-folder-layout.md) feature layout (routes, controllers, use case services, lint rules), behavior unchanged (AC-1 to AC-15 still green)
- [x] Verify it: `/check verify sign up, log in, and a funded wallet`
- [ ] Test it: `/test sign up, log in, and a funded wallet`
- [ ] Review it (fresh model): `/check review sign up, log in, and a funded wallet`
- [ ] Document it: `/document sign up, log in, and a funded wallet`

### 5. Peer transfers with overspend protection · needs a decision
Move money between two users' wallets in one atomic database transaction, with concurrency control so the same balance can never be spent twice.
**Done when:** Alice (₦10,000) sends Bob (₦2,000) ₦3,000 and they end at ₦7,000 and ₦5,000 with the total unchanged; two simultaneous ₦7,000 transfers from Alice result in exactly one success; a failure halfway leaves no partial entries.
- [ ] Design it (spec): `/architect peer transfers with overspend protection`

## Phase 2: Correctness under retries

### 6. Idempotent transfer requests · needs a decision
`POST /transfers` accepts an `Idempotency-Key` header so a client that timed out can safely retry. Keys are stored in the database, scoped per user, compared against the original request, and replay the original response.
**Done when:** ten concurrent identical requests with one key create exactly one transfer and one set of entries and all receive the same response; reusing the key with a different amount is rejected; a request still in flight answers a clear "try again" instead of running twice.
- [ ] Design it (spec): `/architect idempotent transfer requests`

### 7. Payment state machine · needs a decision
Explicit states (such as pending, processing, succeeded, failed, cancelled, reversed) and the allowed transitions for transfers, deposits, and withdrawals, enforced in one place with a recorded history.
**Done when:** every status change goes through one transition path; an illegal move (for example succeeded back to processing) is rejected and logged; each payment's state history can be read back.
- [ ] Design it (spec): `/architect payment state machine`

## Phase 3: Provider and webhooks

### 8. Payment provider simulator · needs a decision
A separate fake provider with its own records: it accepts deposit and withdrawal requests, sends signed webhooks, answers status lookups, exports a transaction report, and can be told to misbehave.
**Done when:** each failure mode (slow reply, timeout after success, failure, duplicate webhook, out of order webhooks, bad signature, fee deducted) can be switched on per scenario, and its records can be exported as a report.
- [ ] Design it (spec): `/architect payment provider simulator`

### 9. Deposits through the provider with webhooks · needs a decision
Users fund wallets through the provider. Webhooks are verified, deduplicated, and applied through the state machine; timeouts are treated as unknown and resolved by asking the provider.
**Done when:** a deposit succeeds only after a verified webhook or status lookup; a bad signature or stale timestamp is rejected; a webhook delivered twice posts once; a late "pending" after "succeeded" does not regress the state; a timed out request stays unknown until the status lookup settles it.
- [ ] Design it (spec): `/architect deposits through the provider with webhooks`

### 10. Withdrawals with held funds · needs a decision
Users withdraw to the outside world. Funds are held the moment a withdrawal is requested, released by compensating entries if the provider fails, and settled once on success.
**Done when:** a requested withdrawal lowers the available balance immediately; a provider failure returns the funds through new entries, never edits; success moves the money out exactly once even with duplicate webhooks.
- [ ] Design it (spec): `/architect withdrawals with held funds`

## Phase 4: Queues, retries, and events

### 11. Transactional outbox and background worker · needs a decision
Take provider calls out of the request path. The API writes the payment and its event in the same database transaction; a relay publishes events to a durable queue; a separate worker consumes them idempotently.
**Done when:** the payment and its event commit together or not at all; killing the worker mid job and restarting it finishes the job with no duplicate provider call or posting; every event carries an id, a version, and a correlation id.
- [ ] Design it (spec): `/architect transactional outbox and background worker`

### 12. Retries, backoff, and dead letters · needs a decision
A retry policy that knows which failures are worth retrying, spaces attempts with exponential backoff and jitter, stops at a cap, and parks exhausted work where you can inspect and replay it.
**Done when:** retryable failures back off with jitter up to a maximum; non retryable errors fail fast; exhausted jobs land in a dead letter place and can be replayed without duplicating any money movement.
- [ ] Design it (spec): `/architect retries, backoff, and dead letters`

## Phase 5: Reconciliation

### 13. Reconciliation engine · needs a decision
Import the provider's transaction report and compare it with internal payments and ledger entries, matching on provider reference, amount, currency, and date.
**Done when:** on a seeded report, a run flags records missing on either side, duplicates, amount or fee mismatches, and status mismatches (provider says succeeded, we say pending), while leaving pending items still inside their time window alone; every run and every exception is stored.
- [ ] Design it (spec): `/architect reconciliation engine`

### 14. Exception resolution and compensating entries · needs a decision
Resolve each reconciliation exception with a recorded action (post a missing deposit, reverse a duplicate, book a provider fee) that adds new ledger entries and never changes old ones.
**Done when:** every exception type has a resolution action; resolving it posts balanced new entries; each action records who did it, when, and why; the next run shows the exception cleared.
- [ ] Design it (spec): `/architect exception resolution and compensating entries`

## Phase 6: Resilience

### 15. Rate limiting · needs a decision
Per user limits on money endpoints and per IP limits on log in, shared across API instances.
**Done when:** callers over the limit get HTTP 429 with `Retry-After`; limits still hold with two API instances running; repeated failed log ins are slowed down.
- [ ] Design it (spec): `/architect rate limiting`

### 16. Observability and alerts · needs a decision
Structured logs, metrics, and correlation ids that let you follow one payment across API, worker, webhooks, and reconciliation, plus alerts for the things that quietly go wrong.
**Done when:** one correlation id traces a payment end to end; payments stuck in processing, a growing queue, dead letters, and reconciliation exceptions each raise an alert.
- [ ] Design it (spec): `/architect observability and alerts`

### 17. Failure drills and reliability suite · needs a decision
The reliability checklist in [concepts.md](../learning/concepts.md#9-your-reliability-checklist-mapped-to-features) as automated scenario tests against a real database and the simulator, plus a load drill (traffic spike, slow provider, queue backlog).
**Done when:** every checklist item has a passing automated scenario, and under the load drill the API sheds excess traffic gracefully instead of exhausting resources.
- [ ] Design it (spec): `/architect failure drills and reliability suite`

## Deferred
Out of scope for the current build pass, kept so the plan stays honest.
- **Operations dashboard**: wallets, transaction history, failed jobs, reconciliation exceptions, manual review screens · needs a decision
- **Customer wallet app**: a user facing frontend for funding, transfers, and history · needs a decision
- **Password reset and email verification**: account recovery on top of sign up · needs a decision
- **Session cleanup**: periodically delete refresh sessions expired or revoked for a while · from spec 0004 · needs a decision
- **API reference docs**: a published description of every endpoint · needs a decision
- **Multi currency and FX**: wallets in more than one currency and conversion between them · needs a decision · GA
- **Hosted deployment**: running the system somewhere other than your laptop · needs a decision

## Legend

**The decision box.** Every feature carries exactly one, the sub-task whose label ends with `(spec)`. Its wording varies (`Design it (spec)` normally, `Decide the stack (spec)` on Stack & architecture), so skills locate it by that `(spec)` suffix, never by an exact label. Every other box is an execution box and `/architect` never ticks one.

**Feature lifecycle**: the scope updates as a feature moves; each row is what it shows and who sets it:

| State | Set by | The feature shows |
|---|---|---|
| `planned` · needs a decision | `/scope` | one box: `Design it (spec): /architect <feature>` |
| `in-progress` (designed) | **`/architect` at spec capture** | `Design it` ticked; spec linked; `Build it: /develop <feature>` + **2 to 5 milestones**; the tier's closing boxes (`Verify it` Alpha+, `Test it` Beta+, `Review it` + `Document it` GA); any surfaced follow-up enrolled |
| `in-progress` (building) | `/develop` | milestone sub-boxes tick one by one; code pointer filled |
| `in-progress` (verified) | `/check verify` | `Build it` + milestones ticked; `Verify it` ticked |
| `done` | **you, when you decide it is** (any skill sets it when you say so); `/sync` reconciles | boxes you ran ticked, skipped ones marked skipped; the tier's last stage (`Prototype` → after `/develop`; `Alpha` → after `/check verify`; `Beta`/`GA` → after `/test`) is the suggested point to call it done; `/sync` captures conventions |

- **Next step** = the first unticked box (always a command or a tracked milestone).
- **needs a decision** = run `/architect` first; otherwise straight to `/develop` (or `/audit` for standards & tooling). The tag drops once the spec is captured.
- **Atomic build tasks live in the spec's `## Build plan`, not here**: the scope carries only the milestone rollup.
- **Status** `planned` → `in-progress` → `done`, plus `existing` (pre-workflow) and `dropped` (de-scoped, kept for history).
- **Approach tag** beside a heading (e.g. `· Facade`) overrides the project default for that feature; no tag = inherits it.
- **Workflow tier tag** beside a heading (e.g. `· GA`, `· Prototype`) sets that one feature's rigor above or below the project default; no tag inherits the default. It decides the feature's check boxes and each skill's next suggestion.
- **Workflow** (header line) is the project default, what runs after `/develop`: **Prototype** = nothing (trust develop's own build time self check); **Alpha** = `/check verify`; **Beta** = `/check verify` then `/test`; **GA** = adds a fresh model `/check review` then `/document`. A feature built on an unratified decision (an `Assumed` spec) stays flagged, but that never blocks `done`.
- **Pointer line** (`spec <n> · code in <path>`): the spec link added by `/architect`, the code path by `/develop`.
