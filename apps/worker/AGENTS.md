# @payflow/worker

## Overview

The background process: the outbox relay loop (outbox table to BullMQ) and, from feature 11, the BullMQ consumers. It serves only `/health` and `/ready` on port 3100.

## Stack

- Node `http` health server (no Express), BullMQ on Valkey from feature 11
- Imports `@payflow/core`, `@payflow/shared`, `@payflow/provider-contract`; never another app

## Commands

```bash
pnpm --filter @payflow/worker dev
pnpm --filter @payflow/worker start
pnpm --filter @payflow/worker typecheck
```

## Conventions

- `startRelayLoop` ticks never overlap and `stop` waits for the running tick; feature 11 fills `tick`
- Every consumer is idempotent on the event id (delivery is at least once)
- Each new consumer is added to the readiness checks in `src/main.ts`
- Shutdown order: relay, postgres, valkey, health

Root [AGENTS.md](../../AGENTS.md) rules apply here too.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
