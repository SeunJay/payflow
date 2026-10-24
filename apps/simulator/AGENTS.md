# @payflow/simulator

## Overview

A fake payment provider on port 4000, treated as an outside company. It keeps its own `simulator` database, role, Drizzle schema, and migrations.

## Stack

- Express 5 through `@payflow/http`, Drizzle over `pg` with its own small pool (`src/db/client.ts`)
- Imports `@payflow/provider-contract`, `@payflow/http`, `@payflow/shared`; **never `@payflow/core`**

## Commands

```bash
pnpm --filter @payflow/simulator dev
pnpm --filter @payflow/simulator db:generate   # SQL migrations from src/db/schema.ts
pnpm --filter @payflow/simulator db:migrate
pnpm --filter @payflow/simulator typecheck
```

## Conventions

- Connects as the `simulator` role to the `simulator` database only (`SIMULATOR_DATABASE_URL`); it has no access to `payflow`
- Generated migrations are committed and may be hand edited; `drizzle-kit push` is banned
- Provider API routes and webhooks arrive with feature 8

Root [AGENTS.md](../../AGENTS.md) rules apply here too.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
