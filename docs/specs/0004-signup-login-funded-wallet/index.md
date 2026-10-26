# 0004. Email and password accounts with short JWT access cookies, rotating refresh sessions, and a wallet funded at sign up

**Date**: 2026-10-26
**Status**: Accepted

## Summary

A person signs up with an email and password, and in the same database transaction they get a wallet (a ledger account of their own) holding a ₦10,000 test deposit. Logging in sets two HttpOnly cookies (browser cookies that page scripts cannot read). The first is a 15 minute signed access token (a JWT) that the wallet routes check. The second is a 7 day refresh token that is swapped for a new one on every use, so a stolen, already used refresh token is caught and its session is shut down. Every wallet route works on the caller's own wallet only, taken from the token, so there is no way to ask for someone else's.

## Requirements

**User stories**:
- As a new user, I want to sign up with my email and a password and find ₦10,000 already in my wallet, so that I can try the platform straight away.
- As a returning user, I want to log in and read my balance and history, and stay logged in for a week without retyping my password, so that using the API is not a chore.
- As a user, I want to log out and have that session really end, so that a token I leaked is useless.
- As the platform operator, I want a reused refresh token to kill its session and log a warning, so that a stolen token is contained and visible.
- As the engineer building feature 5, I want each user tied to exactly one wallet ledger account, so that transfers post between two known accounts.

**Acceptance criteria**:
- **AC-1**: `POST /v1/auth/signup` with a valid email and password returns 201 with `{ user: { id, email, createdAt }, wallet: { id, balance: { amount: "1000000", currency: "NGN" } } }`. The stored email is trimmed and lowercased, and the password is stored only as a bcrypt hash (never plain, never in a log).
- **AC-2**: Sign up is one unit of work: the `users` row, a new `liability` NGN ledger account, the `wallets` row, and a `test_deposit` posting of 1,000,000 kobo from `test_funding` with posting key `test_deposit:<user_id>` all commit together or not at all. A failure after the user insert leaves no user, account, wallet, or ledger rows.
- **AC-3**: Invalid input returns 422 `validation_failed` and writes nothing: a missing or non string field, an email that is not valid or is longer than 254 characters after trimming, or a password shorter than 12 or longer than 72 UTF-8 bytes. Any `POST` to a `/v1/auth/*` route whose `Content-Type` media type is not `application/json` returns 415 `unsupported_media_type` before the handler runs, with or without a body. A body that is not valid JSON, is over 100kb, or has an unsupported charset gets the shell's existing 400, 413, or 415 `invalid_body` (unchanged). An unknown `/v1` path still returns 404 `not_found`.
- **AC-4**: Signing up with an email that already exists, in any letter case or with surrounding spaces, returns 409 `email_taken`. Two concurrent sign ups with the same email create exactly one user (and one wallet and one deposit), and the other gets 409 `email_taken`. Inserting a non lowercase email with raw SQL fails the `users_email_lowercase` CHECK.
- **AC-5**: `POST /v1/auth/login` with the right email and password returns 200 with `{ user: { id, email }, accessExpiresAt, refreshExpiresAt }` and no token in the body. It sets `payflow_access` (the JWT; `HttpOnly`, `SameSite=Strict`, `Path=/v1`, `Expires` = the session's `expires_at`, `Secure` when `COOKIE_SECURE` is true) and `payflow_refresh` (`<session id>.<secret>`; same flags, `Path=/v1/auth`, `Expires` = the session's `expires_at`). The access cookie outlives its JWT on purpose, so an expired JWT still reaches the server and earns `token_expired` (AC-7) instead of vanishing. The response carries `Cache-Control: no-store`. It creates one `auth_sessions` row whose `expires_at` is its `created_at` plus the refresh TTL. Logging in again creates another, independent session.
- **AC-6**: A wrong password and an unknown email both return 401 `invalid_credentials` with an identical body. The unknown email path still runs exactly one bcrypt compare (against a dummy hash), so both paths cost one hash.
- **AC-7**: `GET /v1/me`, `GET /v1/wallet`, and `GET /v1/wallet/history` require a valid `payflow_access` cookie. A missing cookie, a malformed token, a bad signature, an algorithm other than HS256 (including `none`), or a wrong `iss` or `aud` returns 401 `unauthenticated`. A correctly signed but expired token returns 401 `token_expired`. A valid token whose user or wallet no longer exists (for example after a local database reset with the same `JWT_SECRET`) returns 401 `unauthenticated`, not 500. An `Authorization` header is ignored (it neither authenticates nor helps).
- **AC-8**: Right after sign up and log in, `GET /v1/wallet` returns `{ id, balance: { amount: "1000000", currency: "NGN" } }` and `GET /v1/wallet/history` returns `{ currency: "NGN", items: [one item with kind "test_deposit", amount "1000000", balanceAfter "1000000"], nextCursor: null }`. That item's ledger transaction has exactly two entries that sum to zero. History is newest first and paginates by `cursor` and `limit` (1 to 100, default 50) with no empty trailing page. A non numeric or out of range `cursor` or `limit` returns 422 `validation_failed`. `GET /v1/me` returns `{ id, email, createdAt }`.
- **AC-9**: A user can only ever read their own wallet. The wallet is resolved from the access token's `sub` (subject, the user id), never from a path, query, or body value. With two users, each sees only their own balance and history.
- **AC-10**: `POST /v1/auth/refresh` with the session's current refresh token returns 200 with the AC-5 body shape and sets both cookies anew. The session's `current_token_hash` is replaced, `rotated_at` is set, and `expires_at` is unchanged (absolute expiry). The refresh token just used no longer works.
- **AC-11**: Presenting a refresh token whose session id is valid but whose secret is not the current one (an already rotated token) revokes the session with `revoked_reason = 'reuse_detected'`. That revocation is committed even though the response is 401 `invalid_refresh`, the session's current token stops working too, and a `warn` log names the user and session ids. Two concurrent refreshes with the same token produce exactly one 200; the other gets 401 `invalid_refresh` and the session ends up revoked as `reuse_detected`, so the refresh token the 200 just issued also fails afterwards (the whole session is ended, by design).
- **AC-12**: A refresh with a missing, malformed, unknown, expired, or revoked refresh token returns 401 `invalid_refresh` and changes nothing (except the AC-11 case). The database rejects a session row where exactly one of `revoked_at` and `revoked_reason` is set.
- **AC-13**: `POST /v1/auth/logout` always returns 204 and clears both cookies (same `Path` values). A current refresh token revokes its session with reason `logout`; a stale secret on a live session revokes it with reason `reuse_detected`; a missing, malformed, unknown, or already revoked token changes nothing. An access token issued before log out keeps working until its own expiry (at most the access TTL); this is the accepted JWT tradeoff.
- **AC-14**: No log line contains a password, an access token, a refresh token, or the value of a `Cookie`, `Set-Cookie`, or `Authorization` header, including the `error` line written for an unexpected 500 (a failed query's parameters and SQL text are not logged). Auth events log `user_id` and `session_id`, never the email.
- **AC-15**: The API refuses to boot (exit 1, every problem printed) when `JWT_SECRET` is missing or under 32 characters, when a TTL is out of range or the refresh TTL is not longer than the access TTL, when `BCRYPT_COST` is outside 4 to 15, or when `COOKIE_SECURE` is anything other than `true` or `false`.

## Decision

**Chosen option**: Option 3: short lived HS256 JWT access cookie plus a rotating, Postgres backed refresh session with reuse detection (see [rationale.md](rationale.md) for all options).

`identity` owns users, password hashing (bcryptjs), JWT signing and checking (jsonwebtoken), and refresh sessions. `wallets` owns the user to ledger account mapping and the sign up test deposit. `apps/api` owns cookies, routes, and the JSON only gate. Sign up runs `registerUser` then `openWallet` in one `withTx`.

**Implementation skills**: `drizzle-orm-patterns` (`giuseppe-trisciuoglio/developer-kit`, `.claude/skills/drizzle-orm-patterns/`) · `drizzle` (`bobmatnyc/claude-mpm-skills`, `.claude/skills/drizzle/`) · `postgresql-table-design` (`wshobson/agents`, `.claude/skills/postgresql-table-design/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `node` (`mcollina/skills`, `.claude/skills/node/`) · `jwt-validate`, `jwt-encode`, `jwt-decode` (`jsonwebtoken/jwt-skills`, `.claude/skills/jwt-*/`, token inspection and signing helpers for tests and `/check verify`, not library conventions). Where a skill conflicts with this spec, this spec wins.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Data model sketch

IDs default to Postgres `uuidv7()`. Timestamps default to `clock_timestamp()` (as in spec 0003). Drizzle `casing: 'snake_case'`. One generated migration creates all three tables.

**`users`** (`packages/core/src/modules/identity/schema.ts`)
| Column | Type | Null | Rules |
|---|---|---|---|
| `id` | uuid | no | PK |
| `email` | text | no | UNIQUE (`users_email_unique`); CHECK `email = lower(email)` (`users_email_lowercase`); CHECK `length(email) BETWEEN 3 AND 254` |
| `password_hash` | text | no | bcrypt hash string (`$2b$<cost>$...`, 60 chars); CHECK `length(password_hash) = 60` |
| `created_at` | timestamptz | no | default `clock_timestamp()` |

**`auth_sessions`** (`identity/schema.ts`)
| Column | Type | Null | Rules |
|---|---|---|---|
| `id` | uuid | no | PK. The `sid` in the refresh token and in the JWT |
| `user_id` | uuid | no | FK to `users.id` ON DELETE RESTRICT; index `auth_sessions_user_id_idx` |
| `current_token_hash` | text | no | lowercase hex SHA-256 of the current secret; CHECK `current_token_hash ~ '^[0-9a-f]{64}$'` |
| `created_at` | timestamptz | no | default `clock_timestamp()`; the log in time |
| `expires_at` | timestamptz | no | set once at insert to `clock_timestamp() + refresh TTL`; never updated |
| `rotated_at` | timestamptz | yes | the last successful refresh |
| `revoked_at` | timestamptz | yes | |
| `revoked_reason` | text | yes | CHECK in (`logout`, `reuse_detected`) |

Table constraints: CHECK `(revoked_at IS NULL) = (revoked_reason IS NULL)` (`auth_sessions_revoked_pair`); CHECK `expires_at > created_at`.

**`wallets`** (`packages/core/src/modules/wallets/schema.ts`)
| Column | Type | Null | Rules |
|---|---|---|---|
| `id` | uuid | no | PK |
| `user_id` | uuid | no | UNIQUE; FK to `users.id` ON DELETE RESTRICT (imports `identity/schema.ts` only for the FK) |
| `ledger_account_id` | uuid | no | UNIQUE; FK to `ledger_accounts.id` ON DELETE RESTRICT (imports `ledger/schema.ts` only for the FK) |
| `created_at` | timestamptz | no | default `clock_timestamp()` |

**Relationships**: user 1:N auth_sessions · user 1:1 wallet · wallet 1:1 ledger account (a `liability` NGN account with `code` null and `allow_negative` false).

**Retention**: expired and revoked sessions stay in the table; no cleanup in this feature. Users and wallets are never deleted (RESTRICT everywhere).

**No ledger migration**: `test_deposit` is already in the `kind` CHECK and `test_funding` is already seeded (spec 0003).

### State transitions

`auth_sessions`, decided under the row lock in one place per action:

```
active (revoked_at null, expires_at > now)
  ├─ refresh with current secret ─────────► active (new current_token_hash, rotated_at = now)
  ├─ refresh or logout with stale secret ─► revoked (reuse_detected)
  ├─ logout with current secret ──────────► revoked (logout)
  └─ clock passes expires_at ─────────────► expired (derived, no write)
revoked, expired: terminal. Every refresh answers invalid_refresh; logout is a no op.
```

An expired session presented with a stale secret is not revoked (it is already dead); the expiry check runs before the secret check.

### Tokens

**Access token (JWT)**: the issuer computes `iat = Math.floor(Date.now() / 1000)` and `exp = iat + ACCESS_TOKEN_TTL_SECONDS` itself, then signs with `jsonwebtoken` `sign({ sid, iat, exp }, JWT_SECRET, { algorithm: 'HS256', issuer: 'payflow-api', audience: 'payflow-api', subject: userId })` (no `expiresIn`, which cannot be combined with an `exp` claim). The same `exp` gives `accessExpiresAt = new Date(exp * 1000)`. Checked with `verify(token, JWT_SECRET, { algorithms: ['HS256'], issuer: 'payflow-api', audience: 'payflow-api' })`; the `algorithms` list is mandatory (it blocks `none` and algorithm swap attacks). A `TokenExpiredError` (thrown only after the signature checks out) maps to `token_expired`; any other error maps to `unauthenticated`. The decoded payload is then parsed with Zod (`sub` and `sid` uuid, `exp` and `iat` integers); a failure is `unauthenticated`. No clock tolerance.

**Refresh token**: `<session id>.<secret>`, where `secret = randomBytes(32).toString('base64url')` (43 characters). Parsing: split at the first `.`; the left part must be a uuid and the right part must match `^[A-Za-z0-9_-]{43}$`, else the token is malformed. The database stores only `sha256(secret)` as hex. Hashes are compared with `crypto.timingSafeEqual` on the decoded bytes.

**Password hash**: `bcryptjs` `hash(password, BCRYPT_COST)` and `compare`. Hashing happens before the sign up transaction opens and comparing happens before the session insert, so no database connection or lock is held during the roughly quarter second a hash takes.

**Dummy hash**: `createAuthContext` computes `hash('payflow-dummy-password', BCRYPT_COST)` once at boot. Log in with an unknown email compares the given password against it and then fails.

### Module surfaces (`@payflow/core`)

Exported from each module's `index.ts` and from the `@payflow/core` entry, each with a doc comment. Writers take `tx: Tx` first; readers take `db: Db | Tx`.

**`identity`**
| Function | Kind | Inputs | Output | Errors |
|---|---|---|---|---|
| `createAuthContext(config)` | setup | `{ jwtSecret, accessTtlSeconds, refreshTtlSeconds, bcryptCost }` | `Promise<AuthContext>` (that config plus `dummyHash`, readonly) | none |
| `prepareSignUp(auth, body)` | pure, async | `body: unknown` | `{ email, passwordHash }` | 422 `validation_failed` |
| `registerUser(tx, prepared)` | write | `{ email, passwordHash }` | `User` (`{ id, email, createdAt }`) | 409 `email_taken` when `INSERT ... ON CONFLICT (email) DO NOTHING RETURNING ...` returns no row (no error parsing; a concurrent insert of the same email blocks on the unique index until the first commits, then returns no row); any DB error propagates |
| `verifyCredentials(db, auth, body)` | read | `body: unknown` | `User` | 422 `validation_failed` (the email rule is the sign up one; the password rule is only "string, 1 to 72 bytes" so a short wrong password still gets 401, not 422), 401 `invalid_credentials` |
| `createSession(tx, auth, userId)` | write | user id | `IssuedTokens` | none |
| `refreshSession(tx, auth, refreshToken)` | write | `string \| undefined` | `RefreshResult` (see below) | none thrown for client faults |
| `endSession(tx, refreshToken)` | write | `string \| undefined` | `EndResult` (see below) | none |
| `authenticate(auth, accessToken)` | pure | `string \| undefined` | `AuthContextOfRequest` (`{ userId, sessionId }`) | 401 `unauthenticated`, 401 `token_expired` |
| `getUser(db, userId)` | read | user id | `User \| null` | none (the route turns `null` into 401 `unauthenticated`) |

Types: `IssuedTokens = { user: { id, email }, accessToken, accessExpiresAt: Date, refreshToken, refreshExpiresAt: Date }`. `RefreshResult = { ok: true; tokens: IssuedTokens } | { ok: false; reason: 'malformed' | 'unknown' | 'expired' | 'revoked' | 'reuse_detected'; userId?: string; sessionId?: string }`. `EndResult = { revoked: false } | { revoked: true; sessionId: string; userId: string; reason: 'logout' | 'reuse_detected' }`. Neither function logs; the route logs from the result.

**Why `refreshSession` returns instead of throwing**: a reuse revoke must be committed, and throwing inside `withTx` rolls it back. The route commits the unit of work, then turns `ok: false` into 401 `invalid_refresh` (and logs `warn` for `reuse_detected`).

**`refreshSession` algorithm** (caller's read committed `tx`):
1. Parse the token. Malformed or missing gives `{ ok: false, reason: 'malformed' }`.
2. `SELECT id, user_id, current_token_hash, revoked_at, expires_at > clock_timestamp() AS live FROM auth_sessions WHERE id = $sid FOR UPDATE`. No row gives `unknown`.
3. `revoked_at` set gives `revoked`. Not `live` gives `expired`. Neither writes anything.
4. Hash mismatch: `UPDATE auth_sessions SET revoked_at = clock_timestamp(), revoked_reason = 'reuse_detected' WHERE id = $sid`, then return `reuse_detected` with the ids.
5. Match: new secret, `UPDATE auth_sessions SET current_token_hash = $new, rotated_at = clock_timestamp() WHERE id = $sid RETURNING expires_at`; sign a new JWT; load the user's email; return `ok: true` with `refreshExpiresAt` = the unchanged `expires_at`.

The row lock in step 2 is what makes AC-11's race deterministic: the second refresh waits, then reads the new hash under read committed and lands in step 4.

**`endSession`**: parse (malformed or missing: `{ revoked: false }`); lock the row as in step 2; unknown, revoked, or expired: `{ revoked: false }`; mismatch: revoke as `reuse_detected`; match: revoke as `logout`; both return `{ revoked: true, ... }` with the reason.

**`createSession`**: new secret; `INSERT INTO auth_sessions (user_id, current_token_hash, expires_at) VALUES ($1, $2, clock_timestamp() + make_interval(secs => $ttl::int)) RETURNING id, expires_at` (the explicit `::int` cast, since Postgres cannot infer a parameter's type inside `make_interval`); sign the JWT with `sid = id`. The `expires_at > created_at` CHECK holds because both defaults are `clock_timestamp()` read in the same row insert and the TTL is at least 3600 seconds.

**`wallets`**
| Function | Kind | Inputs | Output | Errors |
|---|---|---|---|---|
| `openWallet(tx, userId)` | write | user id | `{ id, balance: { amount: bigint, currency: 'NGN' } }` | ledger errors propagate (all are bugs here) |
| `getWallet(db, userId)` | read | user id | `{ id, balance: { amount: bigint, currency } } \| null` | none (`null` when the user has no wallet; the route answers 401 `unauthenticated`) |
| `listWalletHistory(db, userId, page)` | read | `{ cursor?: string; limit?: number }` already validated | `{ currency, items: readonly WalletHistoryItem[]; nextCursor: string \| null } \| null` | none (`null` as above) |

`listWalletHistory` reads the `wallets` row joined to `ledger_accounts.currency` in one query, then calls `ledger.listEntries` on that account. `getWallet` reads the `wallets` row, then `ledger.getBalance`. Two statements are fine here: an account's currency never changes (spec 0003 account guard).

`WalletHistoryItem = { transactionId, kind, description, amount: bigint, balanceAfter: bigint, createdAt: Date }`, mapped from the ledger's `EntryView`.

**`openWallet` algorithm**: `ledger.openAccount(tx, { type: 'liability', currency: 'NGN' })`; insert the `wallets` row; `ledger.getSystemAccount(tx, 'test_funding')`; `ledger.post(tx, { postingKey: 'test_deposit:' + userId, kind: 'test_deposit', description: 'Sign up test deposit', entries: [{ accountId: testFunding.id, amount: 1_000_000n }, { accountId: walletAccount.id, amount: -1_000_000n }] })`; return the wallet with `balance` from the `balanceAfter` of the entry in `PostedTransaction.entries` whose `accountId` is the wallet account (found by id, never by position). The amount is the exported constant `SIGN_UP_TEST_DEPOSIT = 1_000_000n` in `wallets`.

**Locking contract (spec 0003)**: before `post`, this unit of work writes only brand new rows (user, account, wallet) that no concurrent caller can lock, so taking the `test_funding` and wallet account locks inside `post` cannot deadlock. Every sign up does lock `test_funding`, so concurrent sign ups queue on that one row for the length of the posting (not the bcrypt hash, which happens earlier).

### HTTP surface (`apps/api`)

`apps/api/src/app.ts` exports `buildApp({ db, logger, config, auth, readiness })` returning the Express app (`readiness` is passed straight to `createHttpApp`: `main.ts` passes the Postgres and Valkey pings, tests pass `[]`, so tests need no Valkey), so integration tests run the real app against the per file test database through `startServer` and `fetch`. `main.ts` builds the deps and calls it. Routes live in `apps/api/src/routes/` (`auth.ts`, `me.ts`, `wallet.ts`), middleware in `src/middleware/` (`require-json.ts`, `require-auth.ts`), and cookie names and options in `src/cookies.ts`. File locations follow [spec 0005](../0005-api-feature-folder-layout.md) from its migration on: the `auth`, `users`, and `wallets` features under `src/features/`, middleware and cookies under `src/http/`. `cookie-parser` is mounted in `buildApp` (not in the shared `@payflow/http` shell).

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/v1/auth/signup` | POST | `email: string` (req), `password: string` (req) | 201 `{ user: { id, email, createdAt }, wallet: { id, balance: { amount, currency } } }` | public | 415, 422 `validation_failed`, 409 `email_taken` |
| `/v1/auth/login` | POST | `email` (req), `password` (req) | 200 `{ user: { id, email }, accessExpiresAt, refreshExpiresAt }` + both cookies | public | 415, 422 `validation_failed`, 401 `invalid_credentials` |
| `/v1/auth/refresh` | POST | `payflow_refresh` cookie; body `{}` or empty | 200 same as login + both cookies | refresh cookie | 415, 401 `invalid_refresh` (clears both cookies) |
| `/v1/auth/logout` | POST | `payflow_refresh` cookie; body `{}` or empty | 204, both cookies cleared | refresh cookie (optional) | 415 |
| `/v1/me` | GET | `payflow_access` cookie | 200 `{ id, email, createdAt }` | access cookie | 401 `unauthenticated`, 401 `token_expired` |
| `/v1/wallet` | GET | `payflow_access` cookie | 200 `{ id, balance: { amount, currency } }` | access cookie | 401 |
| `/v1/wallet/history` | GET | `cursor` (opt, query), `limit` (opt, query) | 200 `{ currency, items: [{ transactionId, kind, description, amount, balanceAfter, createdAt }], nextCursor }` | access cookie | 401, 422 `validation_failed` |

**JSON only gate** (`require-json.ts`, mounted on the `/v1/auth` router for `POST`, so an unknown `/v1` path still falls through to 404; every later slice's write router mounts it too). It runs after the shell's `express.json`, so a broken or oversized body is answered by the shell's `invalid_body` first, which is fine. It reads `req.get('content-type')`, take the part before `;`, trim, lowercase; anything other than `application/json` (including a missing header) gives 415. It does not use `req.is()`, which returns null for a request with no body and would let an empty, form typed log out through. A cross site HTML form cannot send `application/json` without a CORS preflight, and the API enables no CORS, so this gate plus `SameSite=Strict` is the CSRF defense.

**Auth middleware** (`require-auth.ts`): reads `req.cookies.payflow_access` (accepted only when `typeof` is `string`), calls `authenticate`, and stores `{ userId, sessionId }` with a typed helper pair `setAuth(res, ctx)` and `authOf(res)` over `res.locals` (so no `any` leaks from Express's locals type). It also binds `user_id` onto the request logger (`req.log = req.log.child({ user_id })`).

**Cookies** (`cookies.ts`): `payflow_access`: `{ httpOnly: true, sameSite: 'strict', secure: COOKIE_SECURE, path: '/v1', expires: refreshExpiresAt }`. `payflow_refresh`: same flags, `path: '/v1/auth'`, `expires: refreshExpiresAt`. The access cookie deliberately outlives its 15 minute JWT so the server can say `token_expired`. Clearing uses `res.clearCookie` with the same `path`, `httpOnly`, `sameSite`, and `secure`, or browsers keep the cookie. The helper that sets or clears cookies also sets `Cache-Control: no-store`.

**Body handling**: sign up and log in parse the body with their Zod schemas (unknown keys stripped). Refresh and log out ignore the body entirely (any JSON, including `{}`, is accepted).

**Route flows**:
- Sign up: `prepareSignUp` (hash outside the tx), then `withTx(db, async (tx) => { const user = await registerUser(tx, prepared); const wallet = await openWallet(tx, user.id); return { user, wallet }; })`, then 201. Logs `info` `user signed up` `{ user_id }`.
- Log in: `verifyCredentials`, then `withTx` with `createSession`, set cookies, 200. Logs `info` `session created` `{ user_id, session_id }`.
- Refresh: `withTx` with `refreshSession`; after commit, `ok` sets cookies and returns 200 (`info` `session refreshed`), otherwise clear cookies and throw `invalid_refresh` (`warn` `refresh token reuse detected` `{ user_id, session_id }` for `reuse_detected`, `info` `refresh rejected` `{ reason }` otherwise).
- Log out: `withTx` with `endSession`, clear cookies, 204 (`info` `session revoked` `{ session_id, reason }` when a revoke happened, so `endSession` returns what it did to the route rather than logging itself).
- Me and wallet reads: `getUser`, `getWallet`, or `listWalletHistory` returning `null` (the token's user or wallet is gone) gives 401 `unauthenticated`.
- History: parse the query with Zod (`cursor` matching `^[1-9][0-9]{0,18}$` and refined to `BigInt(cursor) <= 9223372036854775807n`, the Postgres `bigint` maximum; `limit` coerced integer 1 to 100), failure gives 422; then `listWalletHistory`. Neither the ledger's plain `Error` nor a Postgres out of range error is reachable from client input.

**Serialising**: every `bigint` leaves as a decimal string, every `Date` as an ISO 8601 string. The route builds the response object field by field; `JSON.stringify` is never handed a `bigint`.

**Error codes** (`AppError` from `@payflow/shared`, Problem Details from `@payflow/http`):
| Code | Status | Title | `detail` |
|---|---|---|---|
| `validation_failed` | 422 | Validation failed | `z.prettifyError` text (field paths and rule messages; Zod does not echo input values) |
| `invalid_body` | 400, 413, 415 | (existing, from `@payflow/http`) | unchanged: bad JSON, too large, unsupported charset |
| `unsupported_media_type` | 415 | Unsupported media type | `Content-Type must be application/json` |
| `email_taken` | 409 | Email already registered | `An account with this email already exists` |
| `invalid_credentials` | 401 | Invalid email or password | none |
| `unauthenticated` | 401 | Authentication required | none |
| `token_expired` | 401 | Access token expired | `Refresh the session and retry` |
| `invalid_refresh` | 401 | Invalid refresh token | none (the reason is logged, never returned) |

### Value sourcing

| Action | Value produced / displayed | Source |
|---|---|---|
| sign up | normalised email | body `email`, Zod `trim()` then `toLowerCase()` then `z.email()`, max 254 |
| sign up | password byte length | `Buffer.byteLength(password, 'utf8')`, 12 to 72 |
| sign up | `password_hash` | `bcryptjs.hash(password, BCRYPT_COST)` |
| sign up | user `id`, `createdAt` | `RETURNING` of the `users` insert (DB defaults) |
| sign up | `email_taken` | zero rows from `INSERT ... ON CONFLICT (email) DO NOTHING RETURNING` |
| sign up | ledger account | `ledger.openAccount` (`liability`, `NGN`) |
| sign up | wallet `id` | `RETURNING` of the `wallets` insert |
| sign up | deposit amount | `SIGN_UP_TEST_DEPOSIT = 1_000_000n` (₦10,000 in kobo) in `wallets` |
| sign up | posting key, kind, description | `'test_deposit:' + userId`, `'test_deposit'`, `'Sign up test deposit'` |
| sign up | wallet balance in the 201 | the wallet entry's `balanceAfter` from the `post` result |
| log in | the user to compare | `SELECT id, email, password_hash, created_at FROM users WHERE email = $normalised` |
| log in | hash for an unknown email | `AuthContext.dummyHash` (computed at boot) |
| log in, refresh | refresh secret | `randomBytes(32).toString('base64url')` |
| log in, refresh | `current_token_hash` | hex `sha256(secret)` |
| log in | session `id`, `expires_at` | `RETURNING` of the `auth_sessions` insert; `expires_at = clock_timestamp() + make_interval(secs => REFRESH_TOKEN_TTL_SECONDS)` |
| log in, refresh | access JWT claims | `sub` = user id, `sid` = session id, `iss` and `aud` = `'payflow-api'`; `iat` = app clock in whole seconds, `exp` = `iat + ACCESS_TOKEN_TTL_SECONDS`, both computed by the issuer before signing |
| log in, refresh | `accessExpiresAt` | `new Date(exp * 1000)` from that same computed `exp`, as an ISO string |
| log in, refresh | `refreshExpiresAt`, both cookies' `Expires` | `auth_sessions.expires_at` |
| log in, refresh, logout | `Cache-Control: no-store` | the cookie helper |
| sign up | the wallet's posted entry | the `PostedTransaction.entries` item whose `accountId` equals the new wallet account id |
| `/v1/wallet/history` | account id and currency | `wallets` joined to `ledger_accounts` where `wallets.user_id = sub` |
| all cookies | `Secure` flag | `COOKIE_SECURE` |
| refresh | expired or not | `expires_at > clock_timestamp()` in the locking `SELECT` (database clock, the same clock that set it) |
| refresh | `rotated_at`, `revoked_at` | `clock_timestamp()` in the `UPDATE` |
| refresh, logout | `revoked_reason` | the branch taken (`reuse_detected` or `logout`) |
| authenticated routes | caller's user id | the verified JWT `sub` |
| `/v1/me` | `id`, `email`, `createdAt` | `users` row for `sub` |
| `/v1/wallet` | wallet `id`, `ledger_account_id` | `wallets` row where `user_id = sub` |
| `/v1/wallet` | `balance.amount`, `balance.currency` | `ledger.getBalance` on that account |
| `/v1/wallet/history` | items, `nextCursor` | `ledger.listEntries(db, accountId, { cursor, limit })`, `EntryView` fields renamed (`transactionId`, `kind`, `description`, `amount`, `balanceAfter`, `createdAt`) |
| `/v1/wallet/history` | `currency` | `ledger_accounts.currency` from the join above |
| logs | `user_id`, `session_id`, `reason` | the values above; email, passwords, and tokens are never passed to a logger |

### Key invariants

- An email exists at most once, always stored lowercased (UNIQUE plus CHECK; the Zod normalisation is the friendly path, the CHECK the guarantee).
- Passwords never leave the process except as a bcrypt hash; tokens are never stored plain (the refresh secret is stored only as SHA-256; the JWT is never stored).
- Every user has exactly one wallet, and every wallet one liability ledger account (UNIQUE on both FK columns; created in the same unit of work as the user).
- Every wallet's first ledger transaction is its sign up `test_deposit` of 1,000,000 kobo, posted exactly once (posting key `test_deposit:<user_id>` is UNIQUE).
- A session's `expires_at` never changes after insert; a revoked session never becomes active again (no code path clears `revoked_at`).
- At most one refresh succeeds per secret (row lock plus hash replacement under it).
- A wallet route never takes a wallet or user id from the client.
- Only `identity` writes `users` and `auth_sessions`; only `wallets` writes `wallets`; only `ledger` writes ledger tables (spec 0001).

### Security model

- **Public**: sign up and log in. **Refresh cookie**: refresh and log out (the refresh cookie travels only to `/v1/auth`). **Access cookie**: `/v1/me` and `/v1/wallet*`. No roles yet; every authenticated user may read only their own user and wallet, enforced by the route shape (AC-9).
- **Authentication vs authorization**: the JWT proves who the caller is; the route deciding "your wallet is the one for `sub`" is the authorization, with nothing for the client to tamper with.
- **CSRF**: `SameSite=Strict` cookies plus the JSON only gate on every write; no CORS is enabled. If a browser frontend on another origin arrives (deferred customer app), this needs revisiting.
- **Token theft**: access tokens live 15 minutes and are not revocable before expiry (AC-13). Refresh tokens rotate on every use; a replayed one revokes the session (AC-11). The refresh cookie is never sent to wallet routes.
- **Brute force**: not limited in this feature. Feature 15 adds per IP and per account limits on log in and sign up; until then this is a known open gap (local lab, no real users).
- **Enumeration**: sign up reveals existing emails (409, chosen deliberately); log in does not (same body, same hash cost).
- **Logs**: `createLogger` in `packages/shared/src/logger.ts` sets pino `redact` paths `req.headers.authorization`, `req.headers.cookie`, and `res.headers["set-cookie"]` (censor `[Redacted]`), so every logger in every app (and the pino-http child loggers built from it) is covered. The same `createLogger` sets an `err` serializer that wraps `pino.stdSerializers.err` and drops `query`, `params`, and any nested `cause` that carries them (Drizzle and `pg` errors attach the SQL and its parameters, which would include emails, password hashes, and token hashes). The AC-14 tests, including one that forces a database failure into a 500, are the contract.
- **Compliance**: money is simulated and the only personal data is an email address; no regulated scope. The `auth_sessions` table doubles as the record of logins, refreshes (latest only), and revocations with reasons.
- **Out of scope**: password reset, email verification, log out everywhere, MFA, account deletion.

### Configuration required

The schema moves to `apps/api/src/config-schema.ts` (exported, importable by tests with no side effect); `apps/api/src/config.ts` keeps only `export const config = loadConfig(configSchema)`, which `main.ts` imports and tests never do. Tests build their config object directly and pass it to `buildApp`. Env values arrive as strings, so numbers use `z.coerce.number().int().min(..).max(..).default(..)`, and the "refresh longer than access" rule is a `.refine` on the whole object. Added to the schema and `.env.example`:
- `JWT_SECRET`: HS256 signing secret, `z.string().min(32)`. `.env.example` carries an obviously dev only value; tests set their own.
- `ACCESS_TOKEN_TTL_SECONDS`: integer 60 to 86400, default 900.
- `REFRESH_TOKEN_TTL_SECONDS`: integer 3600 to 2592000, default 604800; must be greater than the access TTL.
- `BCRYPT_COST`: integer 4 to 15, default 12. Integration tests use 4.
- `COOKIE_SECURE`: `z.enum(['true', 'false']).default('true').transform((v) => v === 'true')` (strict: `1`, `yes`, and `on` are rejected). `.env.example` sets `false` for plain http on localhost.

New dependencies: `jsonwebtoken` and `@types/jsonwebtoken`, `bcryptjs` (v3 ships its own types) in `@payflow/core`; `cookie-parser` and `@types/cookie-parser` in `@payflow/api`. All through the pnpm catalog. Check current versions and the ESM import shape (Context7) when adding them.

### Critical test scenarios

Integration tests (`*.int.test.ts`) run the real `buildApp` against the per file test database with `startServer` and `fetch`, reading `Set-Cookie` and sending `Cookie` by hand. `BCRYPT_COST = 4`. **Test seams**: the atomic sign up, duplicate email race, and refresh race tests do not go through HTTP. They call the core functions (`registerUser`, `openWallet`, `refreshSession`) inside their own `withTx` callbacks, which the test holds open with a deferred promise at the point named, so no production hook exists. Concurrency tests prove the second transaction is waiting before releasing the first (`waitForLockWaiters`, as in spec 0003).
- Happy path (the scope's done when): sign up, log in, `GET /v1/wallet` shows `"1000000"`, history has one `test_deposit` item, and a direct SQL check finds two entries summing to zero for that transaction; `verifyLedger` reports no drift, verifies **AC-1**, **AC-2**, **AC-5**, **AC-8**
- Atomic sign up: inside one `withTx`, run `registerUser` and `openWallet`, then throw; no `users`, `wallets`, or new ledger rows remain and `test_funding` is unchanged, verifies **AC-2**
- Validation: each bad email and password shape, a 73 byte multibyte password, and a 12 byte one; `text/plain`, form encoded, and missing `Content-Type` on signup and on an empty logout give 415; malformed JSON gives 400 `invalid_body`; `POST /v1/nope` gives 404, verifies **AC-3**
- Duplicate email: sequential `Alice@X.com ` after `alice@x.com` gives 409; two concurrent `registerUser` calls with one email (tx1 held open after its insert, tx2 blocked on the unique index, then tx1 commits) leave exactly one user and tx2 gets `email_taken`; raw SQL uppercase insert fails the CHECK, verifies **AC-4**
- Credentials: wrong password and unknown email give byte identical 401 bodies; a spy on `bcryptjs.compare` (unit level) sees one call on the unknown email path, verifies **AC-6**
- Access token: missing cookie, garbage, a token signed with another secret, an `alg: none` token, an HS256 token with the wrong `aud`, and an expired one (signed with an `exp` in the past); only the last gives `token_expired`; a valid JWT in an `Authorization` header with no cookie gives 401; a valid JWT for a user id that does not exist gives 401 `unauthenticated` on `/v1/me` and `/v1/wallet`, verifies **AC-7**
- Isolation: Alice and Bob each sign up; Bob's cookie returns Bob's wallet id and balance only; there is no request shape that returns Alice's, verifies **AC-9**
- Pagination: post 120 extra entries to a wallet through the ledger in test setup; pages of 50, 50, 21 newest first; `cursor=abc`, `cursor=9999999999999999999`, `limit=0`, `limit=101` give 422, verifies **AC-8**
- Rotation: refresh gives new cookies, hash changed, `expires_at` unchanged; replaying the old token gives 401 and the session is `reuse_detected`; the new token then also fails, verifies **AC-10**, **AC-11**
- Refresh race: two refreshes with one token, tx1 held open after its `FOR UPDATE`, tx2 waiting, commit tx1; one success, one `reuse_detected`, the revocation is visible from a fresh connection (it committed), and the refresh token the winner received then fails over HTTP, verifies **AC-11**
- Refresh failures: missing cookie, malformed, unknown uuid, expired (session inserted with a past `expires_at` via raw SQL), revoked; each 401 with no row change; raw SQL row with `revoked_at` set and `revoked_reason` null fails, verifies **AC-12**
- Log out: current token revokes as `logout` and both cookies are cleared with matching paths; stale secret revokes as `reuse_detected`; no cookie, garbage, and a second log out all give 204 with no change; the old access token still reads `/v1/wallet` until expiry, verifies **AC-13**
- Logs: capture the logger into a stream for a sign up, log in, refresh, and log out cycle; no line contains the password, either token, or a `cookie`/`set-cookie`/`authorization` value, and no line contains the email. Then force a 500 (a route in the test app runs a query that fails with the email as a parameter) and check the `error` line holds neither the email nor the SQL parameters, verifies **AC-14**
- Config: unit tests of the exported `configSchema` for each bad value (including `COOKIE_SECURE=yes`) and the refresh greater than access refine, verifies **AC-15**
- Auth/permission: covered by the access token and isolation scenarios above (anonymous gets 401 `unauthenticated`; another user's wallet is unreachable by construction).

## Build plan

Tracer Bullet: first a thin thread from migration to sign up, log in, and a ₦10,000 balance over real HTTP, with secrets kept out of logs from the first log in. Then thicken it with every error path and authorization check, then with refresh rotation, reuse detection, and log out. Each step ends with green `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, and `pnpm test:int`.

**Milestone 1: Thin thread (sign up, log in, read ₦10,000)**
1. Write `identity/schema.ts` (`users`, `auth_sessions`) and `wallets/schema.ts` (`wallets`) with every column, CHECK, UNIQUE, FK, and index above; run `db:generate` once; review and commit the SQL, satisfies **AC-2**, **AC-4**, **AC-12**
2. Split `apps/api/src/config-schema.ts` out of `config.ts` and add the config vars there and to `.env.example`; add `jsonwebtoken`, `bcryptjs`, and `cookie-parser` through the catalog, satisfies **AC-15**
3. In `identity`: `createAuthContext`, `prepareSignUp` (Zod schema and bcrypt), `registerUser`, `verifyCredentials` (happy path), `createSession`, `authenticate` (happy path), `getUser`. In `wallets`: `openWallet`, `getWallet`. Export with doc comments, satisfies **AC-1**, **AC-2**, **AC-5**
4. Add the `redact` paths and the query safe `err` serializer to `createLogger` in `@payflow/shared` (it stays free of domain and framework imports), with its unit test, satisfies **AC-14**
5. In `apps/api`: `buildApp` factory (`main.ts` uses it), `cookie-parser`, `cookies.ts`, `require-auth.ts`, and the routes `POST /v1/auth/signup`, `POST /v1/auth/login`, `GET /v1/me`, `GET /v1/wallet`, satisfies **AC-1**, **AC-5**, **AC-8**
6. Integration test: the happy path scenario plus the atomic sign up rollback, satisfies **AC-1**, **AC-2**, **AC-5**, **AC-8**

**Milestone 2: Input, errors, and authorization**
7. `require-json.ts`, `validation_failed` mapping, and the validation tests, satisfies **AC-3**
8. `email_taken` from the unique violation, the lowercase CHECK test, and the deterministic concurrent sign up test, satisfies **AC-4**
9. `invalid_credentials` with the dummy hash compare, and its tests, satisfies **AC-6**
10. `token_expired` vs `unauthenticated` in `authenticate`, Zod payload parsing, and the access token tests (including `alg: none` and the ignored `Authorization` header), satisfies **AC-7**
11. `GET /v1/wallet/history` with query validation, `listWalletHistory`, the pagination tests, and the two user isolation test, satisfies **AC-8**, **AC-9**

**Milestone 3: Refresh rotation, reuse detection, and log out**
12. `refreshSession` (lock, expiry, revoked, reuse revoke, rotate) and `POST /v1/auth/refresh` committing before it answers 401, with the rotation and failure tests, satisfies **AC-10**, **AC-11**, **AC-12**
13. The deterministic refresh race test, satisfies **AC-11**
14. `endSession` and `POST /v1/auth/logout` with cookie clearing, and the log out tests, satisfies **AC-13**
15. Auth event log lines (`user signed up`, `session created`, `session refreshed`, `refresh rejected`, `refresh token reuse detected`, `session revoked`) and the full cycle log capture test, satisfies **AC-11**, **AC-14**

## Consequences

**Positive**:
- The walking skeleton is real: a user, a session, a wallet, and money in it, end to end over HTTP, with every later slice able to post between two known wallet accounts.
- Wallet routes need no database lookup to authenticate (the JWT is checked in memory), and authorization cannot be forgotten because the route has no id to check.
- Refresh rotation with reuse detection contains a stolen refresh token, and the refresh race is a deterministic row lock lesson that feeds features 5 and 6.
- Secrets are redacted in the shared logger factory, so the worker and the simulator's webhook signatures (feature 8) are covered too.

**Negative / tradeoffs**:
- Log out does not end an access token already issued; for up to `ACCESS_TOKEN_TTL_SECONDS` a copied access token still works. Instant revocation would mean a session lookup per request.
- Strict reuse detection logs a user out when a client retries a refresh after a timeout, or when two tabs refresh at once. That is the price of catching theft with no grace window.
- This is hand built auth: JWT verification options, cookie flags, and rotation are each a place to get security wrong, held only by the tests above. A production system would lean on a maintained auth library or service.
- jsonwebtoken is CommonJS with an older API shape, and the `algorithms` option is a footgun if a future edit drops it. bcrypt caps passwords at 72 bytes and is not memory hard.
- Every sign up locks `test_funding`, so sign ups serialise on one row during the posting. That's fine at lab scale, and it's an early taste of the hot system account issue flagged in spec 0003.
- Log in and sign up have no rate limit until feature 15; bcrypt cost is the only brake on guessing.
- Sign up reveals whether an email is registered.
- Expired and revoked session rows accumulate with no cleanup.
- No `lock_timeout` is set: a sign up waits as long as it takes on a same email insert or on the `test_funding` row, and a refresh waits on its session row. At lab scale these waits are milliseconds; feature 17's load drill is where a timeout gets decided.
- The dummy hash uses the current `BCRYPT_COST`, while stored hashes keep the cost they were made with. If the cost changes later, the unknown email path and the wrong password path take different times again until old hashes are rehashed (no rehash on log in in this feature).
- The access cookie lives as long as the refresh session, so an expired JWT keeps riding along on `/v1` requests until the client refreshes; it is useless to anyone without the secret, and it is what makes `token_expired` reachable.

**Neutral**:
- Three new dependencies (`jsonwebtoken`, `bcryptjs`, `cookie-parser`) and five new env vars.
- `apps/api` gains a `buildApp` factory and a routes and middleware layout that later slices follow.
- The sign up test deposit is a lab affordance that real deposits (feature 9) do not replace automatically; whether to keep it is a later call.
- Clients must send `Content-Type: application/json` even on body less `POST`s (refresh, log out).

## Follow-up

- [ ] Update the spec 0001 module table: `identity` row "users, password hashes, refresh sessions (`auth_sessions`)"; `wallets` row "user to ledger account mapping, sign up test deposit" (this also closes the matching follow up item in spec 0003).
- [ ] Record the newly installed `jsonwebtoken/jwt-skills` (`jwt-decode`, `jwt-encode`, `jwt-validate`, in `.agents/skills/` and linked into `.claude/skills/`) in root `AGENTS.md` `## Agent skills`; they are token tools for tests and verification, not library conventions, so root is the right home. `/sync` owns that edit. Review their contents before relying on them, since skills run with full agent permissions.
- [ ] Add identity and auth conventions (cookie names and paths, the `refreshSession` commit then throw pattern, JWT verify options) to `packages/core/AGENTS.md` and `apps/api/AGENTS.md` once built (`/sync`).
- [ ] Feature 15: per IP and per account limits on `POST /v1/auth/login` and `POST /v1/auth/signup`, plus slowing repeated failed log ins.
- [ ] Feature 5: tests need wallets with chosen balances (Bob at ₦2,000). Fund them in test setup through `ledger.post` from `test_funding` with a test kind, not through a new API endpoint.
- [ ] Feature 9: decide whether the automatic sign up deposit stays (as a dev affordance behind a flag) or goes once real deposits exist.
- [ ] Deferred password reset: add `password_changed_at` and a "log out everywhere" revoke of all of a user's sessions.
- [ ] Later: a scheduled cleanup of sessions expired or revoked for more than N days.
