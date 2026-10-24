# @payflow/test-utils

## Overview

Test only helpers: the Vitest global setup that starts Postgres 18 and Valkey 8 containers (Testcontainers), per file template databases, and a real HTTP server helper.

## Stack

- Testcontainers, `pg`, Drizzle migrator, Vitest `provide`/`inject`

## Commands

```bash
pnpm test run --project integration   # needs Docker
```

## Conventions

- `global-setup.ts` runs the real `docker/postgres-init.sh` and both migration folders, then copies the migrated `payflow` DB to `payflow_template`
- `createTestDatabase()` gives each test file its own clone; drop it in `afterAll`
- Only test files may import this package

Root [AGENTS.md](../../AGENTS.md) rules apply here too.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
