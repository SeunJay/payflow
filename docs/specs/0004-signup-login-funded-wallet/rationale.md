# 0004 rationale. Sign up, log in, and a funded wallet

The decision record behind [index.md](index.md). `/develop` builds from `index.md`; this file is the why.

## Context

> ⚠️ Premise note: this feature builds authentication by hand (password hashing, token signing, cookie flags, refresh rotation) instead of adopting a maintained auth library or service. Hand built auth is a classic breach source, because each of JWT verification options, cookie attributes, CSRF, and token rotation is a place to be quietly wrong. Here that is deliberate: PayFlow Lab exists to learn these mechanics, it is local only with no real users, and every risky choice is pinned by a test in `index.md`. Treat this as the lesson, not as a pattern to copy into a production system, where an established auth library or hosted provider is the right default.

PayFlow Lab (`docs/scope/scope.md`) is a solo, local only learning platform for keeping money correct under failure. Feature 4 is the walking skeleton for Phase 1: real accounts, a wallet per user, and money in that wallet that can be read back. Spec 0001 deferred the auth decision (sessions vs tokens, password hashing) to this feature, and spec 0003 built a ledger that trusts its caller, leaving "whose account may this caller touch" to this slice. `docs/learning/concepts.md` §8.3 names the concepts this feature must teach: slow salted password hashes, server sessions vs tokens, and authorization as distinct from authentication.

The forces: the API is the only client for now (frontend deferred), driven by integration tests and curl, but a customer wallet app is planned later, so how a browser would hold credentials matters. Money endpoints arrive in feature 5, and every one of them must resolve "the caller's wallet" without a chance of reaching someone else's. The stack is fixed (Express 5, Postgres via Drizzle, Valkey for BullMQ and later rate limits, Zod 4, Pino) and Valkey runs `noeviction` with a memory cap for BullMQ's sake. Rate limiting is feature 15, so log in has no brute force brake in this slice.

Sign up has to create rows in three modules (identity, wallets, ledger) atomically, under spec 0003's locking contract, and the ₦10,000 test deposit must land exactly once per user. Not deciding means feature 5 cannot start: it needs two authenticated users with known wallet accounts.

## Options considered

The load bearing choice is how a logged in caller proves who they are on each request. Password hashing, transport, and the libraries were walked as separate questions with the engineer; they are summarised after the main options.

### Option 1: Opaque server session token

Log in returns a random token; the server stores its SHA-256 hash in a Postgres `sessions` table and looks it up on every request. Sent as a bearer header or a cookie.

**Pros**:
- Log out and revocation are instant and complete.
- One token type, one table, one lookup; nothing about the user travels in the token.
- Easiest to get right: no signing algorithm, no claims, no expiry encoded in the token.

**Cons**:
- A database read on every authenticated request.
- Teaches less about the token designs most real mobile and SPA backends use.

### Option 2: Stateless signed JWT only

Log in returns a signed JWT with `sub` and `exp`; every request verifies it in memory.

**Pros**:
- No server state, no lookup per request.
- Simple to issue.

**Cons**:
- Cannot be revoked before it expires; log out is cosmetic unless a denylist is added, which is server state again.
- A long expiry (needed so users are not logged out constantly) makes a stolen token valuable for a long time.

### Option 3: Short JWT access token plus a rotating refresh session (chosen)

A 15 minute HS256 JWT authenticates requests in memory. A 7 day opaque refresh token, stored hashed in Postgres, mints new access tokens and is replaced on every use; presenting an already used one revokes the session.

**Pros**:
- Fast stateless checks on hot routes, with a small window for a stolen access token.
- Real revocation of the long lived credential, and reuse detection that catches refresh token theft.
- Teaches the token pattern used by most real API backends, plus a deterministic row lock race (two refreshes with one token).

**Cons**:
- Two token types, a refresh endpoint, and rotation logic: the most code and the most ways to be wrong.
- Log out cannot end an already issued access token before its expiry.
- Strict reuse detection logs out a client that retries a timed out refresh.

### Option 4: Short JWT plus refresh token, no rotation

As Option 3, but the refresh token stays the same for its whole life.

**Pros**:
- Simpler: no rotation write, no reuse logic.

**Cons**:
- A leaked refresh token gives silent access for up to 7 days; nothing ever detects it.

### Supporting choices (walked one by one with the engineer)

- **Transport**: HttpOnly cookies (chosen) over an `Authorization: Bearer` header (recommended for an API only service; no CSRF exposure) and over accepting both. Cookies keep tokens out of reach of page scripts for the future browser app, at the cost of CSRF defenses: `SameSite=Strict` plus a JSON only gate on writes (chosen) over a double submit CSRF token and over `SameSite=Lax`.
- **Session store**: Postgres `auth_sessions` (chosen) over Valkey with a TTL, because Valkey's `noeviction` memory is reserved for BullMQ and sessions should survive a volume reset like the rest of the data.
- **Refresh shape**: one row per session with the token as `<session id>.<secret>` (chosen) over a session row plus a history of every issued token. Carrying the session id in the token is what lets a stale secret be recognised as reuse without storing old hashes.
- **Expiry**: absolute 7 days from log in (chosen) over sliding, and over sliding with a 30 day cap.
- **Password hashing**: bcrypt via `bcryptjs` (chosen) over argon2id via `node:crypto` (recommended), scrypt via `node:crypto`, `@node-rs/argon2`, and native `bcrypt`. Passwords over 72 bytes are rejected rather than pre hashed or silently truncated.
- **JWT library and signing**: `jsonwebtoken` (chosen) over `jose` (recommended) and a hand rolled HMAC; HS256 with a secret from env (chosen) over an EdDSA key pair.
- **Revocation scope**: log out revokes the refresh session only (chosen) over checking the session on every request.
- **Refresh race**: strict revoke (chosen) over a 30 second grace window for the previous secret.

## Rationale

Option 3 fits this project because the lab's purpose is to practise the failure handling that real money backends need, and refresh rotation with reuse detection is exactly that kind of problem: an ambiguous retry (was the first refresh received or not?) resolved by a row lock and a committed side effect. It keeps the hot money routes coming in features 5 and 6 free of an auth lookup, so their concurrency tests measure ledger contention, not session reads. Keeping refresh sessions in Postgres rather than Valkey follows from spec 0001's Valkey constraints (`noeviction`, memory shared with BullMQ) and from wanting the reuse revoke to be a normal transactional write the tests can inspect.

The engineer's picks differ from four of the recommendations, and each difference is a conscious tradeoff worth stating. **JWT plus refresh instead of opaque sessions**: Option 1 is simpler and fully revocable, and would be the right call for a production API with no client yet. Option 3 works and teaches more, but it accepts a 15 minute window after log out and roughly twice the auth code. **Cookies instead of a bearer header**: for an API driven by tests and curl, a header avoids CSRF entirely. Cookies are defensible because the customer app is planned, and `SameSite=Strict` plus the JSON only gate closes the CSRF hole as long as no CORS is enabled; adding CORS later reopens it. **jsonwebtoken instead of jose**: jsonwebtoken is the most used JWT library and works fine, but it is CommonJS and its `verify` accepts whatever algorithms the token claims unless `algorithms` is passed, so the spec makes that option mandatory and tests `alg: none` and a wrong key. **bcrypt instead of argon2id**: bcrypt at cost 12 is still acceptable, just not memory hard, and its 72 byte cap is handled by rejecting longer passwords. bcryptjs avoids a native build in CI.

The composition (route calls `identity.registerUser` then `wallets.openWallet` in one `withTx`) keeps identity free of money and leaves the funding rule with wallets, matching spec 0001's module table, at the cost of the route sequencing two calls. Resolving the wallet only from the token's `sub` (`/v1/wallet`, no id in the path) removes the IDOR class (insecure direct object reference, reading another user's record by changing an id) from this feature by construction.

## Evidence: Agent Skill discovery (2026-10-26)

The search ran with the engineer's consent, on a low cost subagent using `npx skills find`. It found candidates only by registry listing; their contents were not read.
- jsonwebtoken: `jsonwebtoken/jwt-skills` (`jwt-encode`, `jwt-validate`, `jwt-decode`, about 600 to 700 installs each), `wshobson/agents@auth-implementation-patterns` (19.6K), `mindrally/skills@jwt-security` (1.6K).
- bcryptjs: `g1joshi/agent-skills@bcrypt` (8 installs, weak signal).
- cookie-parser: none found.
- MCP servers: none relevant.

The engineer installed `jsonwebtoken/jwt-skills`. Its listing shows token inspection, signing, and verification helpers, useful in tests and `/check verify`, rather than library coding conventions. The others were not installed.
