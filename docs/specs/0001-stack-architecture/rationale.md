# 0001. Stack and architecture: decision record

Build spec: [index.md](index.md).

## Context

PayFlow Lab is a simulated payment platform for learning how fintech backends keep money correct when requests repeat, networks time out, workers crash, and two systems disagree (`docs/scope/scope.md`). It is a solo, local only learning project with no real users. The scope fixes the shape: a modular monolith (one codebase, one primary database), a separate worker process, and a separate provider simulator app. Frontend work is deferred.

Forces that shape the stack:
- **Correctness under concurrency is the curriculum.** Slices 2 and 3 need explicit database transactions, row locks (`SELECT ... FOR UPDATE`), and chosen isolation levels; the ledger (feature 3, GA) needs constraints and triggers that refuse unbalanced or edited entries.
- **Failure must be forceable.** Drills kill the worker and relay mid job, so the queue must survive restarts and the processes must start and stop independently.
- **The provider must be a real outsider.** Reconciliation only teaches anything if the simulator's records can disagree with PayFlow's.
- **Learning budget.** Time should go to fintech concepts, not to fighting the language or the tooling.

Not deciding leaves every later spec without a stack to design against.

## Options considered

### Option 1: TypeScript, Express 5, Drizzle, BullMQ on Valkey (chosen)

The engineer's picks, layer by layer, on a pnpm monorepo with a shared core package.

**Pros**:
- Familiar, minimal HTTP layer; huge Express example base.
- Drizzle gives typed schema and queries with per transaction isolation levels, and drops to raw SQL easily (basis: Drizzle transactions docs).
- BullMQ is the most widely used Node queue; Valkey becomes reusable for the shared rate limit store in feature 15.

**Cons**:
- Two stateful services (Postgres and Valkey) to keep consistent, which raises the stakes of the outbox.
- Express adds no validation, typing, or structured logging out of the box.
- Drizzle is still 0.x.

### Option 2: TypeScript, Fastify 5, Kysely on pg, pg-boss (the recommended alternative)

Same monorepo and modules, but every piece of state lives in Postgres.

**Pros**:
- One stateful service: jobs and payments can share a Postgres transaction, so there is no dual write between DB and queue (basis: database backed queue first).
- Fastify includes schema validation and Pino logging; Kysely writes SQL shaped code with explicit locks.

**Cons**:
- The queue living in the same transaction removes the dual write problem, so the outbox lesson (feature 11) feels less necessary.
- Rate limiting across instances (feature 15) would need Postgres or a later Valkey anyway.
- Fewer tutorials than Express and BullMQ.

### Option 3: Go, chi or net/http, pgx with sqlc, River (Postgres queue)

A Go monolith with generated, type checked SQL.

**Pros**:
- Common in fintech; explicit SQL and transactions; one small binary per process.

**Cons**:
- A new language on top of new concepts doubles the learning load.
- More boilerplate per endpoint and per test.

### Option 4: Kotlin, Spring Boot, JPA, RabbitMQ

The traditional bank stack.

**Pros**:
- Very mature transaction management; RabbitMQ has first class dead letter exchanges.

**Cons**:
- Heavy setup and slow feedback; JPA hides the locking you are trying to learn; a broker adds the most ops work of any option.

## Rationale

TypeScript on Node keeps the language cost near zero, so effort goes to the concurrency, idempotency, and reconciliation lessons the scope is built around. Postgres is the only serious choice for a ledger that must refuse unbalanced and edited entries at the database layer (basis: double entry ledger with database enforced invariants). The pnpm monorepo with one `core` package keeps a single modular monolith codebase while letting the API and worker run as separate processes, and keeping the simulator outside `core` with its own database preserves the "two systems disagree" condition that reconciliation needs (basis: modular monolith, monolith first).

The engineer chose Express 5, Drizzle, and BullMQ over the recommended Fastify, Kysely, and pg-boss. All three work for this project; the tradeoffs to accept knowingly:
- **BullMQ adds Valkey, a second stateful store.** This is the most consequential choice. It makes the transactional outbox mandatory rather than educational: any `queue.add()` outside the outbox can lose or invent work. It also means Valkey needs AOF persistence and `noeviction`. The upside is real: the dual write problem becomes concrete, and Valkey is already there for feature 15 (basis: transactional outbox pattern).
- **Express 5** means hand assembling Zod validation, pino-http, and a Problem Details error handler. That is a few dozen lines, and building them is itself instructive.
- **Drizzle** documents per transaction isolation levels (basis: Drizzle transactions docs) and has a Postgres select locking clause (`.for('update', { skipLocked })`, confirmed by the cross check rather than the docs search), with raw `sql` as a fallback.

The cross check also moved dev runs from Node's built in type stripping to `tsx`. Node refuses to strip types in some workspace link setups, and a stack spec should not leave how code runs as a scaffold time experiment.

Smaller calls: errors follow RFC 9457 so 409, 422, and 429 share one shape (basis: RFC 9457 Problem Details). UUIDv7 keys index well on large append only ledger tables. Transactions pass explicitly as a `tx` argument, so it is always visible which writes share a transaction. Vitest with Testcontainers gives every test run a throwaway real Postgres, so concurrency tests never run against mocks.

## References

**Project sources**:
- `docs/scope/scope.md`: feature 1 shape (modular monolith, separate worker and simulator), build approach, deferred items
- `docs/learning/concepts.md`: §6.3 transactional outbox, §8.1 shared rate limit store, §8.3 auth deferred to feature 4

**Practices & standards**:
- Monolith first; modular monolith with explicit module boundaries
- Database backed queue first (the default that Option 2 follows)
- Transactional outbox for the dual write problem
- Double entry ledger with database enforced invariants
- RFC 9457 Problem Details for HTTP APIs

**Links** (web verified during the landscape check):
- Node.js release schedule: https://nodejs.org/en/about/previous-releases
- Drizzle ORM transactions: https://orm.drizzle.team/docs/transactions
- Prisma transactions (why Prisma was ruled out): https://www.prisma.io/docs/orm/prisma-client/queries/transactions
- pg-boss (Option 2 queue): https://github.com/timgit/pg-boss

## Landscape scan (2026-10-24)

Versions from the npm registry on the scan date. Full notes: `docs/.agent-cache/research/ts-backend-stack.md`.

| Layer | Options and versions |
|---|---|
| Runtime | Node 24 LTS (24.22.x) · Node 22 LTS · Node 26 Current (not LTS) |
| HTTP | Fastify 5.12 · Express 5.3 · Hono 4.13 · NestJS 12.2 |
| DB access | Drizzle 0.45 · Kysely 0.29 · pg 8.23 · Prisma 7.10 (8 in RC) |
| Migrations | drizzle-kit 0.31 · node-pg-migrate 9.0 · Kysely migrator |
| Queue | BullMQ 6.4 · pg-boss 12.38 · Graphile Worker 0.18 · amqplib 2.2 |
| Validation | Zod 4.6 · TypeBox 1.4 · Valibot 1.5 |
| Tests | Vitest 5.0 · node:test · Testcontainers 12.2 |
| Logging | Pino 10.4; OpenTelemetry JS SDK 2.x (for feature 16) |
