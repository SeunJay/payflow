# Review, feat/04-signup-login-funded-wallet, 2026-10-26

**Reviewed by**: Sonnet 5.5 (author on a different model)
**Scope**: about 75 files, branch vs main (vendored jwt agent skills and the lockfile skipped)
**Verdict**: Approve with nits

## Summary
Adds sign up, log in, refresh rotation with reuse detection, log out, `/v1/me`, and a funded wallet with history, laid out in api feature folders (spec 0005). The core logic is careful: every refresh decision is made under the session row lock, a reuse revoke commits because client faults are returned instead of thrown, the JWT verify pins `algorithms`, issuer and audience, and login always costs one bcrypt compare. I found no blockers or majors. The remaining points are small: a hot row lock on sign up, a missing test beside the wallets module, and a few nits.

## Minor
### 🟡 Every sign up locks the same `test_funding` account row until commit, `packages/core/src/modules/wallets/wallets.ts:51-60`
**Problem**: `openWallet` posts a deposit that debits the shared `test_funding` system account (`getSystemAccount` then `post` with that account as one entry). The ledger `post` takes `FOR UPDATE` locks on every account it touches, and the sign up transaction (`auth.service.ts:22-25`) holds that lock until it commits.
**Why it matters**: Sign ups are serialized through one row. The hold time is short (the bcrypt hash is done before the transaction opens), so it is fine for a lab, but throughput of sign up is capped by one hot row, and a slow commit stalls every other sign up. The race test only covers two sign ups on one email.
**Suggested fix**: Accept it and say so in the spec consequences, or note it as the reason a later feature may want a per user or sharded funding source. No code change needed now.

### 🟡 The wallets module has no test beside its source, `packages/core/src/modules/wallets/wallets.ts:1`
**Problem**: `openWallet`, `getWallet`, and `listWalletHistory` are new logic, but `packages/core/src/modules/wallets/` has no `*.test.ts` or `*.int.test.ts`. They are exercised only through the api tests (`apps/api/src/features/wallets/wallets.service.int.test.ts`, `wallet-access.int.test.ts`, `signup-login.int.test.ts`).
**Why it matters**: AGENTS.md says tests sit beside the source. The behaviour is covered end to end, so the risk is low, but a core change would not get a failing test next to it, and the identity module does have `users.int.test.ts` beside it.
**Suggested fix**: Add a small `wallets.int.test.ts` for the null returns of `getWallet` and `listWalletHistory` for an unknown user, and the balance after `openWallet`.

### 🟡 The dummy hash is made at the configured cost, but stored hashes keep the cost they were made with, `packages/core/src/modules/identity/auth-context.ts:16` and `users.ts:40`
**Problem**: The "same cost for unknown email and wrong password" guarantee holds only while every stored hash was made at the current `BCRYPT_COST`. If the cost is changed later, real users compare at their old cost and unknown emails at the new one.
**Why it matters**: A timing difference would let a caller tell known from unknown emails. Sign up already reveals existing emails by design (spec 0004 line 263), so the exposure is small, and the guarantee stated for log in would be slightly false after a cost change.
**Suggested fix**: Add a one line comment at `createAuthContext` that changing `BCRYPT_COST` breaks the equal cost property until old hashes are rehashed, or record it in the spec.

## Nits
- ⚪ `packages/shared/src/logger.ts:79-83`, a scrubbed database error keeps full `node_modules` file paths in its stack frames. Judged acceptable: only frames are kept, no SQL, message, or params. Optionally trim paths to the `.pnpm` package name, or leave as is.
- ⚪ `apps/api/src/features/auth/auth.schemas.ts:5-10` and `apps/api/src/features/users/users.schemas.ts:4`, `walletBody` and `userBody` are duplicated across features (the `api-features-isolated` rule forces it). If a body shape changes it must change in two places; a shared helper in `apps/api/src/http/` would fix it.
- ⚪ `packages/core/src/modules/identity/tokens.ts:12`, `AuthContextOfRequest` reads like a variant of `AuthContext` but is the caller identity. A name like `Caller` would be clearer.

## Questions the caller asked me to judge
- **Health paths**: not a finding. Spec 0001 (line 112) and `packages/http/src/health.ts:12,16` define `/health` and `/ready`, so 404 on `/health/live` and `/health/ready` is correct. The verify note should be corrected rather than the code.
- **500 log with node_modules paths**: acceptable, see the first nit. The sensitive parts (message, SQL, params) are removed, and `logger.test.ts` covers it.
- **`.dependency-cruiser.cjs` exclude change**: sound. `doNotFollow: node_modules` still stops traversal, so third party packages appear as leaf nodes only, which is what lets `api-services-no-http` match `node_modules/(express|cookie-parser)/`. I ran `depcruise apps packages` and it reports no violations (156 modules, 470 dependencies). The new rules are scoped (test files and `test-support.ts` exempted on purpose).

## Strengths
- Refresh rotation is correct and race safe: row lock, expiry before secret check, reuse revoke committed by returning a result instead of throwing, constant time hash compare, and a real concurrent refresh test (`sessions.int.test.ts:110`).
- JWT verify pins HS256, issuer, audience, then re-parses the payload with Zod; cookies are HttpOnly, SameSite Strict, path scoped, and `requireJson` is a documented CSRF defence.
- Migration constraints back the app rules (lowercase email, hash length, revoked pair check, RESTRICT foreign keys), and sign up uses `ON CONFLICT DO NOTHING` with a held transaction race test.
- Log redaction covers cookie and set-cookie headers, and the DB error scrubber keeps SQL and params out of logs.

## Test coverage
Strong: unit tests for tokens, input, cookies, schemas, config and logger; integration tests for sign up, log in, refresh, reuse, logout, wallet access between users, and the sign up email race. Gaps are only the missing wallets test beside its source (minor above) and no test of a changed `BCRYPT_COST` against old hashes (not needed unless the third minor is acted on).
