# @payflow/http

## Overview

The shared Express shell for the API and the simulator: request and correlation ids, pino-http logs, JSON bodies, `/health` and `/ready`, then the 404 and Problem Details error handlers.

## Stack

- Express 5, pino-http; depends only on `@payflow/shared`

## Commands

```bash
pnpm --filter @payflow/http typecheck
pnpm test run --project unit packages/http
```

## Conventions

- Errors leave as RFC 9457 Problem Details (`application/problem+json`) with a stable `code`; unexpected errors are a plain 500 with nothing leaked
- Caller supplied ids are reused only if they match `^[A-Za-z0-9._-]{1,128}$`
- No domain imports, ever

Root [AGENTS.md](../../AGENTS.md) rules apply here too.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
