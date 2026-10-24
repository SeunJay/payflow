# 0001. TypeScript modular monolith on Postgres with a BullMQ worker and a separate provider simulator

**Date**: 2026-10-24
**Status**: Accepted

## Summary

PayFlow Lab is written in TypeScript on Node 24, with Express 5 for HTTP, PostgreSQL 18 as the one source of truth for money, Drizzle for database access, and BullMQ on Valkey (an open source Redis) as the job queue. One shared `core` package holds every business module, and three small apps run it: the public API, the background worker, and a fake payment provider that keeps its own separate database. The point of this layout is that the money rules live in one place, and the provider stays a true outsider, which gives the reliability lessons something real to test against.

## Decision

**Chosen option**: Option 1: TypeScript modular monolith, Express 5, Drizzle on Postgres, BullMQ on Valkey (see [rationale.md](rationale.md) for all options).

One pnpm monorepo with a shared `@payflow/core` package of domain modules, run as three Node 24 processes (API, worker, simulator) against one Postgres server (two databases, two roles) and one Valkey, all started locally with Docker Compose.

**Implementation skills**: `drizzle-orm-patterns` (`giuseppe-trisciuoglio/developer-kit`, `.claude/skills/drizzle-orm-patterns/`) · `drizzle` (`bobmatnyc/claude-mpm-skills`, `.claude/skills/drizzle/`) · `bullmq-specialist` (`sickn33/agentic-awesome-skills`, `.claude/skills/bullmq-specialist/`) · `valkey` (`valkey-io/valkey-skills`, `.claude/skills/valkey/`) · `redis-core` (`redis/agent-skills`, `.claude/skills/redis-core/`) · `node` (`mcollina/skills`, `.claude/skills/node/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `pnpm` (`antfu/skills`, `.claude/skills/pnpm/`). Where a skill conflicts with this spec, this spec wins.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Proposed stack

| Layer | Choice | Reason |
|---|---|---|
| Architecture pattern | Modular monolith: one codebase, one primary database, three processes | Solo learning project; module boundaries teach domain separation without distributed systems overhead |
| Language | TypeScript (strict), ESM (`"type": "module"`) | One language across all apps; static types for money code; least language overhead, so time goes to fintech concepts |
| Runtime | Node.js 24 LTS, pinned via `.nvmrc` and `engines` | Current Active LTS; built in `--env-file` and `--watch` |
| Package manager / repo | pnpm workspaces monorepo (current pnpm major, pinned via `packageManager`) | Three apps plus shared packages in one install; workspace `exports` make boundaries real |
| HTTP framework | Express 5 (API and simulator) | Engineer's pick: simplest and most familiar; Express 5 forwards rejected async handlers to the error middleware natively |
| API style | REST + JSON under `/v1`, errors as RFC 9457 Problem Details (`application/problem+json`) plus a stable `code` field | Matches real payment APIs; `Idempotency-Key`, 409, 422, 429 + `Retry-After` all map cleanly |
| Validation | Zod 4 | One schema gives runtime checks plus TS types for request bodies, webhooks, events, and env config |
| Primary DB | PostgreSQL 18 | Row locks, isolation levels, check and deferred constraints, triggers to block ledger edits, built in `uuidv7()` |
| DB access | Drizzle ORM over node-postgres (`pg` Pool) | Engineer's pick: typed schema and queries, per transaction `isolationLevel`, select locking clause; raw `sql` escape hatch |
| Migrations | `drizzle-kit generate` to committed SQL files, applied with `drizzle-kit migrate`; hand edits allowed | Reviewable history; triggers and deferred constraints can be added by hand. `drizzle-kit push` is banned |
| IDs | UUIDv7. Table primary keys default to Postgres `uuidv7()`; event ids and correlation ids are generated in app (`@payflow/shared`) | Time ordered (indexes well), not guessable; one generation path per kind of id |
| Queue | BullMQ on Valkey 8 | Engineer's pick: mature retries, backoff, and failed job sets; Valkey doubles later as the shared rate limit store (feature 15) |
| Outbox relay | A loop inside the worker app (outbox table → BullMQ) | Keeps the three app shape; relay and consumers start and stop independently for kill drills |
| Logging | Pino + pino-http (JSON), child loggers carrying `request_id` and `correlation_id` | Structured from day one; feature 16 layers metrics, tracing, and alerts on top |
| Config | One root `.env` loaded with `node --env-file`; each app parses only the vars it needs through its own Zod schema at boot and refuses to start on bad config | No dotenv dependency; fail fast; `.env.example` committed, `.env` ignored |
| Run / typecheck | Apps run with `tsx` (`tsx watch` in dev, `tsx` in `start`). Internal packages export their `.ts` source; nothing is compiled to `dist`. "Passing build" = `pnpm -r typecheck` (`tsc --noEmit` per package) | One way to run code everywhere; no project references or emit config to maintain for a local lab |
| Tests | Vitest + Testcontainers (Postgres 18 and Valkey 8 containers per run; Docker required) | Real database in every test, never the dev data; Vitest concurrency helpers for race tests |
| Local services | Docker Compose: `postgres:18` (DBs `payflow` and `simulator`), `valkey/valkey:8` | One command up; same image versions as tests |
| Auth | Deferred to feature 4's spec | Sessions vs tokens and password hashing are feature 4 decisions (`docs/learning/concepts.md` §8.3) |
| Rate limit store | Deferred to feature 15 (Valkey is available) | Decided with the limiting algorithm; constraints below |
| Metrics / tracing / alerts | Deferred to feature 16 | Pino logs and correlation ids are the only day one requirement |
| Lint / format / boundary lint | Deferred to feature 2 | Installed from the real scaffold |
| Hosting | Local only | Hosted deployment is deferred in the scope |

### Repository layout

```
apps/
  api/          Express 5 HTTP app: routes, maps HTTP ↔ core services; owns its config schema
  worker/       Outbox relay loop + BullMQ consumers in one process; tiny health server; owns its config schema
  simulator/    Express 5 fake provider: own Drizzle schema, migrations, drizzle.config.ts, `simulator` DB
packages/
  core/         All PayFlow domain modules, the Drizzle client factory + pool, drizzle.config.ts, migrations/
  provider-contract/  Zod schemas for the provider HTTP API and webhook payloads, HMAC sign/verify helpers
  http/         Express middleware shared by api and simulator: request and correlation ids, pino-http, Problem Details error handler, /health and /ready
  shared/       Domain free, framework free: logger factory, config helpers, UUIDv7, error types, graceful shutdown helper
  test-utils/   Testcontainers setup, per file template databases, factories
tsconfig.base.json   Strict, ESM, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `noEmit`
docker-compose.yml   Postgres 18 + Valkey 8, named volumes, healthchecks, init script for the simulator DB and role
.env.example
```

### Modules in `@payflow/core`

Each module lives at `packages/core/src/modules/<name>/`, owns its tables (`schema.ts`), and exposes only `index.ts`. The scaffold creates each module with an empty `index.ts` and `schema.ts`; the slice that needs it fills them.

| Module | Owns | Filled by feature |
|---|---|---|
| `identity` | users, credentials, sessions | 4 |
| `wallets` | wallet accounts per user, platform system accounts | 3, 4 |
| `ledger` | ledger transactions and entries; the **only** writer of ledger tables; balance reads | 3 |
| `payments` | transfers, deposits, withdrawals, the state machine and its history | 5, 7, 9, 10 |
| `idempotency` | idempotency keys, stored request fingerprint and response | 6 |
| `provider` | outbound provider client, inbound webhook verification and dedupe | 8, 9 |
| `outbox` | outbox table; `record(tx, event)` API used by every module | 11 |
| `reconciliation` | reconciliation runs, exceptions, resolutions | 13, 14 |

### Dependency rules

| From | May import | Must not import |
|---|---|---|
| `apps/api`, `apps/worker` | `@payflow/core`, `@payflow/http` (api only), `@payflow/shared`, `@payflow/provider-contract` | another app |
| `apps/simulator` | `@payflow/provider-contract`, `@payflow/http`, `@payflow/shared` | `@payflow/core` (it is an outside company) |
| a core module | another module's `index.ts`, `@payflow/shared`, `@payflow/provider-contract`; another module's `schema.ts` **only** to declare a foreign key | another module's internals; writing another module's tables |
| `@payflow/http` | `@payflow/shared` | any domain package |
| `@payflow/shared` | nothing in the repo | any other package |
| `@payflow/test-utils` | anything (tests only) | being imported by non test code |

Database foreign keys across modules are allowed and encouraged (integrity beats purity); the boundary is enforced in code, not by banning FKs.

### Cross module conventions

- **Transactions are passed explicitly.** Service functions that write take a `tx: Tx` as their first argument, where `Tx` is a branded type wrapping the Drizzle transaction handle, so a raw `db` cannot be passed by mistake. The caller (API route or job handler) opens the transaction. Inside a unit of work, code never touches the global `db` (that takes a second pool connection and can deadlock under concurrency tests). Runner up: implicit propagation through `AsyncLocalStorage`, rejected because it hides which work shares a transaction, the very thing the slices teach.
- **Row locks** use Drizzle's select locking clause (`.for('update')`, with `{ skipLocked }` or `{ noWait }` where needed). Raw `` tx.execute(sql`... FOR UPDATE`) `` is the fallback if a query can't be expressed.
- **Async reactions go through the outbox**, never a direct BullMQ `add()` from a request path (the dual write problem, `docs/learning/concepts.md` §6.3).
- **Delivery is at least once, end to end.** The relay claims unsent outbox rows in batches with `FOR UPDATE SKIP LOCKED` (so more than one relay never double claims), publishes each with BullMQ `jobId` = the event id, then marks it sent. A crash between publish and mark sent republishes, so **every consumer must be idempotent** on the event id. BullMQ's `jobId` dedupe only lasts while the job is retained, so it is a convenience, not the guarantee. Features 11 and 12 build on this.
- **Money in TS is `bigint`** minor units (Drizzle `bigint({ mode: 'bigint' })`), never `number`. The ledger shape itself is spec 0003's decision.

### Migrations and test databases

- Two drizzle configs: `packages/core/drizzle.config.ts` (schema glob `src/modules/*/schema.ts`, `DATABASE_URL`) and `apps/simulator/drizzle.config.ts` (`SIMULATOR_DATABASE_URL`).
- Migrations run as an explicit step, **never on app start**: root `db:migrate` runs `db:migrate:core` then `db:migrate:sim`.
- Tests: Vitest `globalSetup` (in `@payflow/test-utils`) starts the Postgres and Valkey containers, creates both databases, runs the same migrations once into template databases, and gives each test file its own database via `CREATE DATABASE ... TEMPLATE`. Concurrency tests size the pool explicitly.

### Local runtime contract

| Process | Port | Connects to | `/health` (liveness) | `/ready` (readiness) |
|---|---|---|---|---|
| API | 3000 | Postgres `payflow`, Valkey | always 200 while the process runs | 200 after DB `SELECT 1` and Valkey `PING`, else 503 |
| Worker | 3100 (health only) | Postgres `payflow`, Valkey | always 200 | 200 when DB and Valkey answer and relay loop plus consumers are running, else 503 |
| Simulator | 4000 | Postgres `simulator` | always 200 | 200 after DB `SELECT 1`, else 503 |
| Postgres 18 | 5432 | | Compose healthcheck (`pg_isready`) | |
| Valkey 8 | 6379 | | Compose healthcheck (`valkey-cli ping`) | |

- **Postgres roles.** `payflow` role owns only the `payflow` DB; `simulator` role owns only the `simulator` DB and the payflow role has no `CONNECT` on it. Created by a script in `/docker-entrypoint-initdb.d`, which runs only on a fresh volume (`pnpm down -v` to reset). Dev passwords live in `.env.example`.
- **Valkey** runs with `appendonly yes`, `maxmemory-policy noeviction` (BullMQ requires it), and an explicit `maxmemory`. Feature 15's rate limit keys must carry a TTL and a separate key prefix, since a full Valkey makes BullMQ writes fail.
- **Reconnects.** BullMQ worker connections set `maxRetriesPerRequest: null`; the pg Pool has an `error` handler; both survive a Postgres or Valkey restart during drills (`/ready` reports 503 meanwhile).
- **Graceful shutdown.** A shared helper in `@payflow/shared` handles SIGTERM and SIGINT: stop accepting HTTP, stop the relay loop, close BullMQ workers (let in flight jobs finish up to a timeout), close the pg pool and Valkey, then exit.

### Root scripts

| Script | Does |
|---|---|
| `pnpm up` / `pnpm down` | `docker compose up -d --wait` / `docker compose down` |
| `pnpm db:migrate` | `db:migrate:core` then `db:migrate:sim` |
| `pnpm dev` | runs every app's `dev` in parallel (`tsx watch --env-file=../../.env src/main.ts`) |
| `pnpm typecheck` | `pnpm -r typecheck` (the passing build) |
| `pnpm test` | Vitest across the workspace |

Each app also has `start` (`tsx --env-file=../../.env src/main.ts`).

**Configuration required** (scaffold only; each later feature adds its own):
- `DATABASE_URL`: API and worker connection to the `payflow` database (payflow role)
- `SIMULATOR_DATABASE_URL`: simulator connection to the `simulator` database (simulator role)
- `VALKEY_URL`: API and worker connection to Valkey
- `API_PORT`, `WORKER_PORT`, `SIMULATOR_PORT`: listen ports (defaults 3000, 3100, 4000)
- `LOG_LEVEL`: Pino level, default `info`

## Consequences

**Positive**:
- Money rules live in one package; the API and worker cannot drift apart because they run the same code.
- The simulator's separate database and role force reconciliation to compare two genuinely independent sources.
- Every layer is mainstream with large communities, so docs and examples are plentiful.

**Negative / tradeoffs**:
- **Two stateful services, not one.** BullMQ needs Valkey beside Postgres; a job can exist in Valkey while its payment row is rolled back unless every enqueue goes through the outbox. Valkey persistence and memory limits must be configured, or a restart or a full memory loses or blocks jobs.
- **Express gives you nothing built in** for validation, typed routes, or request logging; `@payflow/http` assembles Zod, pino-http, and a Problem Details error handler by hand.
- **Drizzle is pre 1.0** (0.x) and may introduce breaking changes.
- BullMQ's failed job set is not a true dead letter queue; feature 12 must design replay deliberately.
- `tsx` is a runtime dependency for running the apps; there is no compiled output to ship (fine while hosting is deferred).
- `erasableSyntaxOnly` bans `enum`, `namespace`, and constructor parameter properties, keeping the code runnable by Node's own type stripping later.
- Both sides import `@payflow/provider-contract`, so a bug in a shared schema is invisible to reconciliation; bad signature and out of order webhook tests must use hand built payloads.

**Neutral**:
- `packages/core` grows large; that is by design, with modules as the internal boundary.
- Boundary enforcement starts as package `exports` only; the lint rule arrives with feature 2.

## Follow-up

- [ ] Root `AGENTS.md` does not exist yet; `/audit` (feature 2) should capture this stack, the dependency rules, the `Tx` convention, and the at least once delivery rule.
- [ ] The 9 installed skills are not yet in an `AGENTS.md` `## Agent skills` section. All are project wide (framework, ORM, queue, tests), so they belong in root `AGENTS.md`; `/audit` should add one bullet per skill.
- [ ] MCP servers chosen but not yet connected (a step in your own MCP settings): `redis/mcp-redis` (official, works with Valkey), a community Postgres MCP (e.g. Postgres MCP Pro, run in restricted read only mode), and the Docker MCP (Docker Desktop 4.43+). Record them on the `AGENTS.md` `MCP servers:` line once connected.
- [ ] Feature 2: add an import boundary lint rule (e.g. dependency-cruiser or eslint-plugin-boundaries) that enforces the dependency rules table.
- [ ] Feature 4 owns the auth decision (sessions vs tokens, password hashing); feature 15 owns the rate limit store and must honor the Valkey constraints above; feature 16 owns metrics and tracing.
