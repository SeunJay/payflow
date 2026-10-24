# @payflow/core

## Overview

Every PayFlow domain module plus the database, transaction, and Valkey plumbing. The money rules live here and only here.

## Stack

- Drizzle ORM over node-postgres (`pg` Pool), ioredis for Valkey
- Exports TypeScript source from `src/index.ts`; nothing is compiled

## Commands

```bash
pnpm --filter @payflow/core db:generate   # SQL migrations from src/modules/*/schema.ts
pnpm --filter @payflow/core db:migrate
pnpm --filter @payflow/core typecheck
```

## Conventions

- Each module in `src/modules/<name>/` owns its tables in `schema.ts` and exposes only `index.ts`. Another module may import its `schema.ts` only to declare a foreign key
- Only `ledger` writes ledger tables. Money is `bigint` minor units, never `number`
- Writing service functions take `tx: Tx` (from `withTx`) as the first argument and never touch the global `db` inside a unit of work
- Row locks use Drizzle `.for('update')` (with `skipLocked` or `noWait` where needed)
- Async reactions go through the outbox (`record(tx, event)`), never a direct queue add

Root [AGENTS.md](../../AGENTS.md) rules apply here too.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
