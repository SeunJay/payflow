# 0005. Feature folders in the API with routes, controllers, and use case services

**Date**: 2026-10-26
**Status**: Accepted

## Summary

The API's code moves into one folder per feature (`src/features/auth/`, `users/`, `wallets/`), and each feature splits into three small files with one job each: a routes file (which path and middleware runs which handler), a controller (the HTTP side: read the request, set cookies, log, answer), and a service (one function per use case: open the database transaction and call `@payflow/core`). Business rules stay in core; an API service only orchestrates. Lint rules check the boundaries, so a new slice cannot quietly put a database call in a controller or Express code in a service. The existing auth, me, and wallet code moves now, on the feature 4 branch, with identical behavior.

## Context

> ⚠️ Premise note: in this repo the classic "service" layer already exists. It is `@payflow/core`, which owns every business rule (spec 0001: the API "maps HTTP to core services and owns no business rules"). An API side service is therefore a second place logic could live, and the known failure is that rules slowly migrate into it (a balance check here, a status rule there) until core and the API disagree. This spec keeps the layer by giving it a narrow, checkable job: own the unit of work (`withTx`) and compose core calls, nothing else. If a service ever needs an `if` about money, state, or limits, that rule belongs in a core module.

`apps/api/src` today holds route files that do everything at once. `routes/auth.ts` (68 lines) parses bodies, opens transactions, composes core calls (sign up is `registerUser` then `openWallet` in one `withTx`), logs auth events, sets and clears cookies, and builds response bodies. Response mapping sits in a shared `serialize.ts`, HTTP plumbing in `cookies.ts` and `middleware/`, and the dependency type in `deps.ts`. That is fine for three routes, but the scope plans fourteen more slices (transfers, idempotent requests, payments, deposits, withdrawals, rate limiting), and each would add more mixed handlers.

Two patterns are already competing. Most handlers open `withTx` inline and call several core functions, while plain reads call one core function and branch on `null` to answer 401. Response shaping is shared in one file while request parsing (the history query schema) lives inside a route file. Without a standard, each slice picks its own mix, and the API becomes hard to read and hard to test below the HTTP level.

The forces: the team is one engineer learning fintech backend patterns, so the layout must be easy to follow on a tired evening; the repo already enforces boundaries with dependency-cruiser (spec 0001) and functional style with ESLint (no classes but `AppError`, named exports only); tests sit beside the source; and feature 4 is built but not yet verified or merged, so its code can still land in its final shape once.

## Options considered

### Option 1: Feature folders, each with routes, controller, and a use case service, enforced by lint

`src/features/<feature>/` holds `<feature>.routes.ts`, `<feature>.controller.ts`, `<feature>.service.ts`, `<feature>.schemas.ts`, and an `index.ts` that wires them into one router. Shared HTTP plumbing moves to `src/http/`. dependency-cruiser rules forbid features importing each other, controllers calling core, and services touching Express.

**Pros**:
- Everything about one feature sits in one folder; a slice adds one folder and one mount line.
- Each layer has one job, so controllers read as pure HTTP and services are callable from tests without HTTP.
- The boundaries fail `pnpm lint:deps` and CI, not just review.

**Cons**:
- About four files per feature where there was one; a plain read like `GET /v1/me` becomes a thin service function plus a thin handler.
- A second "service" word in the repo (API use cases vs core modules) that newcomers must learn to tell apart.

### Option 2: Layer folders (`routes/`, `controllers/`, `services/`) across all features

The classic Express layout: one folder per layer, each holding a file per feature.

**Pros**:
- Instantly familiar from tutorials; each layer is easy to scan as a whole.
- Same separation of jobs as Option 1.

**Cons**:
- One feature is spread across three or four folders; adding or deleting a feature touches all of them.
- Cross feature imports are harder to forbid, since every controller sits beside every other.

### Option 3: Routes and controllers only, with core as the service layer

Split handlers out of routes into controllers, and let controllers call `@payflow/core` and open `withTx` themselves.

**Pros**:
- Least code; no API side layer that could collect business rules.
- Matches spec 0001's wording most literally.

**Cons**:
- Controllers mix HTTP with unit of work composition, the very mix this standard is meant to end.
- Use cases (sign up = user + wallet + deposit in one transaction) cannot be exercised without HTTP or without repeating the composition in tests.

### Option 4: Document the layout now, migrate later

Write the standard and apply it to new slices only; move the feature 4 code in a separate refactor after feature 4 merges.

**Pros**:
- Feature 4's pull request stays exactly as built and verified so far.

**Cons**:
- Two layouts coexist until the refactor lands, and the next slice copies whichever it sees first.
- A second pull request that only moves code merged days earlier.

## Decision

**Chosen option**: Option 1: Feature folders, each with routes, controller, and a use case service, enforced by lint

The API is organized as `src/features/<feature>/` folders with `.routes.ts`, `.controller.ts`, `.service.ts`, `.schemas.ts`, and `index.ts`, shared plumbing in `src/http/`, boundaries checked by dependency-cruiser, and the feature 4 code migrated now in one change.

## Rationale

The engineer asked for the controller, service, route pattern, and the strongest version of it here is the one that gives each word a job that does not overlap with core. Controllers own HTTP (cookies, `req.log`, status codes, bodies), services own the unit of work (spec 0001 already says the caller opens the transaction, and the service is now that caller), and core keeps the rules. That split also answers the competing patterns in Context: every handler opens transactions the same way (inside its service), and every "not found means 401" check lives in one service instead of each controller.

Feature folders beat layer folders for this project's shape: the scope adds features one slice at a time, and a slice that adds one folder plus one mount line is easier to review, revert, and lint than one that touches three folders. It also mirrors how `@payflow/core` is already organized (by module), so the API and core read alike. The runner up, layer folders, gives the same separation but spreads each slice across the tree.

Lint enforcement is what keeps the premise note's risk in check. dependency-cruiser already guards spec 0001's boundaries, so adding four rules costs nothing new to operate, and a controller that imports `withTx` fails CI on day 1 rather than in a review on day 180. Migrating feature 4 now, before `/check verify` and `/test`, means those steps check the final code once, and no slice ever sees two layouts.

## Standard definition

**Layout** (paths under `apps/api/src/`):

```
app.ts                     composition root: buildApp mounts each feature's router
main.ts, config.ts, config-schema.ts
deps.ts                    FeatureDeps (db, auth, cookieSecure), renamed from RouteDeps
test-support.ts            shared integration test helpers (unchanged)
app.int.test.ts            whole app tests (today's logs.int.test.ts)
http/
  cookies.ts               session cookie names, set and clear helpers, cookieOf
  middleware/require-auth.ts
  middleware/require-json.ts
features/
  auth/
    index.ts               authFeature(deps): Router, the only export
    auth.routes.ts         paths and middleware to handlers
    auth.controller.ts     createAuthController({ service, cookieSecure })
    auth.service.ts        createAuthService({ db, auth })
    auth.schemas.ts        request schemas and response mappers
    signup-login.int.test.ts, sessions.int.test.ts
  users/                   GET /v1/me
    index.ts, users.routes.ts, users.controller.ts, users.service.ts, users.schemas.ts
  wallets/                 GET /v1/wallet, GET /v1/wallet/history
    index.ts, wallets.routes.ts, wallets.controller.ts, wallets.service.ts, wallets.schemas.ts
    wallet-access.int.test.ts
```

**Canonical pattern** (auth, abridged):

```ts
// features/auth/auth.service.ts: one function per use case; owns withTx; no Express, no logger.
import { createSession, openWallet, prepareSignUp, refreshSession, registerUser, verifyCredentials, withTx } from '@payflow/core';
import type { FeatureDeps } from '../../deps.ts';

/** The one error factory the controller needs from core, handed over here so controllers never import core values. */
export { invalidRefresh } from '@payflow/core';

export function createAuthService({ db, auth }: Pick<FeatureDeps, 'db' | 'auth'>) {
  return {
    signUp: async (body: unknown) => {
      const prepared = await prepareSignUp(auth, body); // hash before the unit of work opens
      return withTx(db, async (tx) => {
        const user = await registerUser(tx, prepared);
        return { user, wallet: await openWallet(tx, user.id) };
      });
    },
    logIn: async (body: unknown) => {
      const user = await verifyCredentials(db, auth, body);
      return withTx(db, (tx) => createSession(tx, auth, user.id));
    },
    // Returns instead of throwing: a reuse revoke must commit before the 401.
    refresh: (token: string | undefined) => withTx(db, (tx) => refreshSession(tx, auth, token)),
    // logOut likewise returns the EndResult
  } as const;
}
export type AuthService = ReturnType<typeof createAuthService>;
```

```ts
// features/auth/auth.controller.ts: HTTP only; calls its own service; logs through req.log.
import type { RequestHandler } from 'express';
import { clearSessionCookies, cookieOf, REFRESH_COOKIE, setSessionCookies } from '../../http/cookies.ts';
import { invalidRefresh, type AuthService } from './auth.service.ts';
import { sessionBody, userBody, walletBody } from './auth.schemas.ts';

export function createAuthController({ service, cookieSecure }: { service: AuthService; cookieSecure: boolean }) {
  const signUp: RequestHandler = async (req, res) => {
    const { user, wallet } = await service.signUp(req.body);
    req.log.info({ user_id: user.id }, 'user signed up');
    res.status(201).json({ user: userBody(user), wallet: walletBody(wallet) });
  };
  const refresh: RequestHandler = async (req, res) => {
    const result = await service.refresh(cookieOf(req, REFRESH_COOKIE));
    if (result.ok) { /* log, setSessionCookies, 200 */ return; }
    /* log warn or info by reason */
    clearSessionCookies(res, cookieSecure);
    throw invalidRefresh();
  };
  return { signUp, logIn, refresh, logOut } as const;
}
export type AuthController = ReturnType<typeof createAuthController>;
```

```ts
// features/auth/auth.routes.ts: paths, middleware, handlers; nothing else.
import { Router } from 'express';
import { requireJson } from '../../http/middleware/require-json.ts';
import type { AuthController } from './auth.controller.ts';

export function authRoutes(controller: AuthController): Router {
  const router = Router();
  router.use(requireJson);
  router.post('/signup', controller.signUp);
  router.post('/login', controller.logIn);
  router.post('/refresh', controller.refresh);
  router.post('/logout', controller.logOut);
  return router;
}
```

```ts
// features/auth/index.ts: the feature's only door.
/** `/v1/auth`: sign up, log in, refresh, log out (spec 0004). */
export function authFeature(deps: FeatureDeps): Router {
  const service = createAuthService(deps);
  return authRoutes(createAuthController({ service, cookieSecure: deps.cookieSecure }));
}

// app.ts (inside createHttpApp's mount)
app.use(cookieParser());
app.use('/v1/auth', authFeature(deps));
app.use('/v1', usersFeature(deps), walletsFeature(deps));
```

**Layer rules** (each is checkable):

| File | Its one job | May import (values) | Must not |
|---|---|---|---|
| `<f>.routes.ts` | Map path plus middleware to a controller handler | `express` `Router`, `src/http/middleware/*`, its controller's type | call a service or core; hold handler logic |
| `<f>.controller.ts` | HTTP: read `req`, call exactly one service function per handler, log via `req.log`, set or clear cookies, status and body | its own `<f>.service.ts`, `<f>.schemas.ts`, `src/http/*`, `@payflow/shared` (`validationFailed`, `AppError`); `@payflow/core` **types only** | import a core function or `withTx`; touch `db` |
| `<f>.service.ts` | One function per use case: open `withTx`, compose core calls, throw core's `AppError`s, return plain data | `@payflow/core`, `@payflow/shared`, `../../deps.ts` types | import `express`, `cookie-parser`, or `src/http/*`; log; hold a business rule (that goes in core) |
| `<f>.schemas.ts` | Zod request schemas (query, params) and response mappers (bigint to decimal string, `Date` to ISO) | `zod`, `@payflow/core` types | do I/O |
| `index.ts` | Build service, then controller, then routes; export only `<f>Feature(deps): Router` with a doc comment | its own folder, `../../deps.ts` | export internals |

**Behavior rules**:
- Every controller handler calls a service, even a plain read: `getMe(userId)` and `getMyWallet(userId)` throw `unauthenticated` themselves when the row is gone, so controllers never branch on `null`.
- Request bodies for sign up and log in are still parsed in core (`prepareSignUp`, `verifyCredentials`); `<f>.schemas.ts` holds only what core does not parse (the history query, response bodies).
- A service that must commit before failing (refresh, log out) returns a result; the controller turns it into the HTTP answer. Every other client fault is an `AppError` thrown from core or the service.
- Auth event logs (`user signed up`, `session created`, `session refreshed`, `refresh rejected`, `refresh token reuse detected`, `session revoked`) stay in controllers, through `req.log`, with the same fields as spec 0004.
- Mount prefixes live in `app.ts`; a routes file declares paths relative to its mount.
- Factories return `as const` objects of arrow functions (no classes), and exported types come from `ReturnType` of the factory.

**Replaces**:
- `src/routes/*.ts` handlers that open `withTx`, compose core calls, log, and shape bodies in one function
- `src/serialize.ts` (split into each feature's `<f>.schemas.ts`; auth and users each keep their own small user mapper, see Exceptions)
- `src/cookies.ts` and `src/middleware/` at the top level (moved under `src/http/`)
- `RouteDeps` (renamed `FeatureDeps`)
- Controllers or routes branching on a `null` from core to answer 401

**Enforcement**: four dependency-cruiser rules in `.dependency-cruiser.cjs`, run by `pnpm lint:deps` and CI:
- `api-features-isolated`: a file under `apps/api/src/features/<a>/` never imports `apps/api/src/features/<b>/` (shared code goes in `src/http/`).
- `api-features-through-index`: a file under `apps/api/src/` outside `features/` imports a feature only through `features/<f>/index.ts`.
- `api-controllers-and-routes-no-core-values`: `*.controller.ts` and `*.routes.ts` may import `packages/core/` only as type only imports (`dependencyTypesNot: ['type-only']`), so a stray `withTx` or core function fails.
- `api-services-no-http`: `*.service.ts` never imports `express`, `cookie-parser`, or `apps/api/src/http/`.

The existing ESLint rules already cover the rest (no classes, named exports, doc comment on each export from `index.ts`).

**Rollout**: one migration change on `feat/04-signup-login-funded-wallet`, before `/check verify` and `/test` run on feature 4. Behavior is identical: no route, status, body, cookie, or log line changes. The existing API integration and unit tests pass with only their file locations and import paths changed (`signup-login` and `sessions` into `features/auth/`, `wallet-access` into `features/wallets/`, `logs` to `src/app.int.test.ts`). `src/routes/`, `src/middleware/`, `src/serialize.ts`, and top level `src/cookies.ts` are deleted once nothing references them. New slices follow the layout from their first file.

**Exceptions**:
- Test files (`*.test.ts`, `*.int.test.ts`) and `test-support.ts` are exempt from the layer rules: race and rollback tests call core directly inside held transactions (spec 0004 test seams).
- The composition root (`app.ts`, `main.ts`, `config*.ts`, `deps.ts`) imports what it needs to wire the app.
- `src/http/middleware/require-auth.ts` calls core's `authenticate`; it is shared plumbing, not a controller.
- Small response mappers may repeat across features (auth's session body includes `user { id, email }`) rather than one feature importing another's schemas; repeat a three line mapper, never cross the feature boundary. If one grows real logic, move it to `src/http/`.

## Consequences

**Positive**:
- Each slice from feature 5 on adds one folder and one mount line, with a clear home for every kind of code.
- Use cases are callable without HTTP, which the money slices (transfers, idempotent requests) will want for concurrency tests.
- Controllers and services that break the boundaries fail CI, so the layout holds after the engineer stops thinking about it.

**Negative / tradeoffs**:
- More files and more indirection: `GET /v1/me` goes route to controller to service to core for one query. That is the price of one uniform pattern.
- The word "service" now means two things (core modules and API use cases). The premise note's risk is real: a service is the easiest place to slip a rule in, and no lint rule can tell orchestration from a business rule; that part stays a review duty.
- Controllers get one value from core through their service (the `invalidRefresh` re export), a small seam to remember when a new controller needs a core error.
- The migration touches every API file on a branch that is mid review flow; the tests are the safety net, and `/check verify` runs after it.

**Neutral**:
- Spec 0004's HTTP surface paragraph names the old file layout; its routes, bodies, and behavior are unchanged, only the file locations move.
- `apps/api/AGENTS.md` needs the new layout and rules (a `/sync` job after the migration).
- `@payflow/http` and `@payflow/core` are untouched.

## Follow-up

- [ ] Migrate the feature 4 code into this layout on `feat/04-signup-login-funded-wallet` (`/develop`), including the four dependency-cruiser rules, before `/check verify`.
- [x] Point spec 0004's HTTP surface paragraph at this spec for file locations.
- [ ] `/sync` after the migration: record the layout, layer rules, and exceptions in `apps/api/AGENTS.md`, replacing its "`/v1` routes are mounted in `src/main.ts`" line (they are mounted in `buildApp` in `app.ts`).
- [ ] When the worker grows job handlers (feature 11), decide whether it adopts the same feature folder shape; this spec covers `apps/api` only.
