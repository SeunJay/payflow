# @payflow/api

## Overview

The public HTTP API on port 3000. It maps HTTP to `@payflow/core` services and owns no business rules. `/v1` routes are mounted in `src/main.ts` as slices land.

## Stack

- Express 5 through `createHttpApp` from `@payflow/http`, Zod 4 for request and config schemas
- Imports `@payflow/core`, `@payflow/http`, `@payflow/shared`, `@payflow/provider-contract`; never another app

## Commands

```bash
pnpm --filter @payflow/api dev     # tsx watch, reads ../../.env
pnpm --filter @payflow/api start
pnpm --filter @payflow/api typecheck
```

## Conventions

- Config is parsed once in `src/config.ts` (`DATABASE_URL`, `VALKEY_URL`, `API_PORT`, `LOG_LEVEL`); add new env vars there and to `.env.example`
- A route opens the transaction with `withTx` and passes `tx` to core services; it never queues jobs directly (use the outbox)
- Expected client failures are `AppError`s, which `@payflow/http` turns into Problem Details
- Shutdown order: http, postgres, valkey (`onShutdown` in `src/main.ts`)

Root [AGENTS.md](../../AGENTS.md) rules apply here too.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
