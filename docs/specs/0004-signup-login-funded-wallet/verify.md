# Verify: Sign up, log in, and a funded wallet · spec 0004 · updated 2026-10-26
_Steps derived from spec 0004 acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

Setup you may want first: `pnpm run up && pnpm db:migrate`, then `pnpm dev` (API on :3000). Use a cookie jar (`curl -c jar -b jar`) and send `Content-Type: application/json` on every `POST`. Check the database with a read only `psql` session.

## UI / manual (HTTP)
- [x] `POST /v1/auth/signup` with `{"email":"  Ada@Example.COM ","password":"correct horse battery"}` → 201, `user.email` is `ada@example.com`, `wallet.balance` is `{"amount":"1000000","currency":"NGN"}` → AC-1
- [x] In the database, that user's `password_hash` starts `$2b$12$` and is 60 characters; the password appears nowhere → AC-1
- [x] For that user: one `wallets` row, one `liability` NGN `ledger_accounts` row with no `code`, one `ledger_transactions` row with `posting_key = 'test_deposit:<user id>'`, kind `test_deposit`, description `Sign up test deposit`, and exactly two entries summing to zero → AC-2
- [x] Sign up with ` ADA@example.com` again → 409 `email_taken`; still one user with that email → AC-4
- [x] Sign up with `text/plain`, with a form body, and with no `Content-Type` → 415 `unsupported_media_type`; `POST /v1/auth/logout` with no body and no `Content-Type` → 415 → AC-3
- [x] Sign up with an 11 byte password, a 73 byte password (`é` × 36 plus `a`), a non string email, and an email over 254 characters → 422 `validation_failed`, no rows written; a 72 byte `é` × 36 password → 201 → AC-3
- [x] Broken JSON → 400 `invalid_body`; a body over 100kb → 413; `application/json; charset=latin1` → 415 `invalid_body`; `POST /v1/nope` → 404 `not_found` → AC-3
- [x] Log in with the right password → 200 with `{ user: { id, email }, accessExpiresAt, refreshExpiresAt }` and no token in the body; `Cache-Control: no-store`; `payflow_access` has `Path=/v1`, `payflow_refresh` has `Path=/v1/auth`, both `HttpOnly; SameSite=Strict`, both `Expires` equal to the session's `expires_at`; no `Secure` with `COOKIE_SECURE=false` → AC-5
- [x] The new `auth_sessions` row has `expires_at - created_at` of exactly 604800 seconds; `refreshExpiresAt` equals it; `accessExpiresAt` is 15 minutes after log in; logging in again adds a second row → AC-5
- [x] Log in with a wrong password and with an unknown email → both 401 `invalid_credentials` with identical bodies; a 1 character wrong password → 401, not 422 → AC-6
- [x] With the access cookie, `GET /v1/wallet` → `{ id, balance: { amount: "1000000", currency: "NGN" } }`; `GET /v1/wallet/history` → one `test_deposit` item, amount and balanceAfter `"1000000"`, `nextCursor: null`; `GET /v1/me` → `{ id, email, createdAt }` → AC-8
- [x] Without a cookie, with garbage, with a token signed by another secret, with `alg: none`, with a wrong `aud`, and with the JWT only in an `Authorization` header → 401 `unauthenticated` on all three reads → AC-7
- [x] A correctly signed token with a past `exp` (use the jwt-encode skill with the dev `JWT_SECRET`) → 401 `token_expired` → AC-7
- [x] A correctly signed token whose `sub` is a random uuid → 401 `unauthenticated`, not 500 → AC-7
- [x] Sign up a second user; with their cookie, `GET /v1/wallet?userId=<first user id>` returns only their own wallet; no request shape returns the first user's → AC-9
- [x] History: `?cursor=abc`, `?cursor=0`, `?cursor=9999999999999999999`, `?limit=0`, `?limit=101` → 422 `validation_failed`, never 500 → AC-8
- [x] `POST /v1/auth/refresh` → 200, both cookies replaced, `refreshExpiresAt` unchanged; in the row, `current_token_hash` changed, `rotated_at` set, `expires_at` unchanged → AC-10
- [x] Replay the old refresh token → 401 `invalid_refresh`, both cookies cleared, the row shows `revoked_reason = 'reuse_detected'`, a `warn` log `refresh token reuse detected` with `user_id` and `session_id`, and the newest refresh token now fails too → AC-11
- [x] Refresh with no cookie, garbage, an unknown session id, an expired session, and a revoked one → 401 `invalid_refresh`, rows unchanged → AC-12
- [x] Log out with the current refresh token → 204, both cookies cleared with `Path=/v1` and `Path=/v1/auth`, row revoked as `logout`; the old access cookie still reads `/v1/wallet` until it expires; a second log out → 204, nothing changes → AC-13
- [x] Watch the API logs through that whole cycle: no email, password, token, or cookie value appears; `cookie`, `set-cookie`, and `authorization` show `[Redacted]`; auth events carry `user_id` and `session_id` only → AC-14
- [x] Start the API with `JWT_SECRET=short`, with `COOKIE_SECURE=yes`, with `BCRYPT_COST=16`, and with `REFRESH_TOKEN_TTL_SECONDS=900`: each exits 1 and prints every problem → AC-15

## Value sourcing checks (vary the source, watch the output)
- [x] Email normalisation: sign up with `  MiXeD@Ex.com ` → stored and returned as `mixed@ex.com`; log in with `MIXED@EX.COM` → 200
- [x] Password byte length counts UTF-8 bytes, not characters: 36 × `é` (72 bytes) passes, 37 × `é` fails
- [x] `password_hash` follows `BCRYPT_COST`: restart with `BCRYPT_COST=10`, sign up, hash starts `$2b$10$`
- [x] User `id` and `createdAt` come from the insert: the 201 values match the `users` row exactly
- [x] `email_taken` comes from the insert returning no row: two simultaneous sign ups with one email give one 201 and one 409, one user, one wallet, one deposit
- [x] Ledger account and wallet `id`: the 201 `wallet.id` matches `wallets.id`, and its `ledger_account_id` is a `liability` NGN account
- [x] Deposit amount, posting key, kind, description: exactly `1000000`, `test_deposit:<user id>`, `test_deposit`, `Sign up test deposit`
- [x] The 201 balance is the wallet entry's `balance_after` (not the funding entry's): it is `1000000`, never negative
- [x] Unknown email log in uses the dummy hash: timing of unknown email and wrong password log ins is similar (one hash each)
- [x] Refresh secret and stored hash: the cookie's part after the dot is 43 base64url characters, and `sha256` of it in hex equals `current_token_hash`
- [x] Session `id` and `expires_at` come from the insert: the refresh cookie starts with the row's `id`; restart with `REFRESH_TOKEN_TTL_SECONDS=7200` and the new row's span is 7200 seconds
- [x] JWT claims: decode the access cookie (jwt-decode skill): `sub` is the user id, `sid` the session id, `iss` and `aud` are `payflow-api`, `exp - iat` equals `ACCESS_TOKEN_TTL_SECONDS` (try 120)
- [x] `accessExpiresAt` equals `exp × 1000` from that same token
- [x] `refreshExpiresAt` and both cookies' `Expires` equal `auth_sessions.expires_at`, before and after a refresh
- [x] `Cache-Control: no-store` on log in, refresh (200 and 401), and log out
- [x] `Secure` flag follows `COOKIE_SECURE`: absent with `false`, present with `true`
- [x] Expiry uses the database clock: set a session's `expires_at` to `now() - interval '1 second'` in SQL, then refresh → 401, row not revoked
- [x] `rotated_at` and `revoked_at` are set by the database during refresh and log out (compare with `now()` in SQL)
- [x] `revoked_reason` matches the branch: current token log out gives `logout`, a stale token gives `reuse_detected`
- [x] The caller's user id is the JWT `sub`: `/v1/me`, `/v1/wallet`, and history for two users each show their own data
- [x] `/v1/wallet` balance comes from `ledger_accounts.balance` of the wallet's account: post an extra test deposit in SQL test setup and the balance moves by that amount
- [x] History items and `nextCursor` come from the ledger entries newest first; `currency` comes from the account (`NGN`)
- [x] Logs carry only `user_id`, `session_id`, and `reason`: grep the log for the email after a full cycle and find nothing

## Commands
- [x] `pnpm typecheck && pnpm lint && pnpm lint:deps` → clean → all
- [x] `pnpm test:unit` → green, including `config-schema.test.ts` and `logger.test.ts` → AC-14, AC-15
- [x] `pnpm test:int` → green, including `apps/api/src/*.int.test.ts` and `identity/users.int.test.ts` → AC-1 to AC-14
- [x] `pnpm --filter @payflow/core ledger:verify` after a few sign ups → no drift → AC-2

## Acceptance-criteria coverage
- AC-1 sign up steps 1, 2 · AC-2 step 3, ledger:verify · AC-3 steps 5 to 7 · AC-4 step 4 and the race check · AC-5 steps 8, 9 · AC-6 step 10 · AC-7 steps 12 to 14 · AC-8 steps 11, 16 · AC-9 step 15 · AC-10 step 17 · AC-11 step 18 · AC-12 step 19 · AC-13 step 20 · AC-14 step 21 · AC-15 step 22

## Layout (spec 0005) · added 2026-10-26
_The API moved into feature folders with behavior unchanged. These steps check the move; every step above still applies as written._
- [x] `pnpm test:int apps/api` → 4 files green: `src/app.int.test.ts`, `src/features/auth/signup-login.int.test.ts`, `src/features/auth/sessions.int.test.ts`, `src/features/wallets/wallet-access.int.test.ts` → AC-1 to AC-14
- [x] `pnpm lint:deps` → clean; then add one throwaway file per rule and each fails with its rule name: a `features/users/x.controller.ts` importing `withTx` (`api-controllers-and-routes-no-core-values`) or `../wallets/wallets.schemas.ts` (`api-features-isolated`); a `features/users/x.service.ts` importing `express` or `../../http/cookies.ts` (`api-services-no-http`); a `src/x.ts` importing `./features/auth/auth.service.ts` (`api-features-through-index`). Delete them after → spec 0005 Enforcement
- [x] `src/routes/`, `src/middleware/`, `src/serialize.ts`, and top level `src/cookies.ts` are gone, and `grep -rn "RouteDeps" apps/api` finds nothing → spec 0005 Rollout
