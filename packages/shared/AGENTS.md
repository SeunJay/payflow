# @payflow/shared

## Overview

Domain free, framework free helpers used by every package: logger factory, config helpers, `AppError`, and graceful shutdown.

## Stack

- Pino, Zod 4; imports nothing else from the repo

## Commands

```bash
pnpm --filter @payflow/shared typecheck
```

## Conventions

- `loadConfig` prints every problem and exits 1 on bad config, so apps never start half configured
- `onShutdown` runs steps in registration order: stop accepting work first, close connections last
- Must stay importable by everything: no domain or framework imports

Root [AGENTS.md](../../AGENTS.md) rules apply here too.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
