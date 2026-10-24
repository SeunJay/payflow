# @payflow/provider-contract

## Overview

The provider HTTP API and webhook schemas plus HMAC helpers, shared by the core and the simulator. Empty until feature 8.

## Stack

- Zod 4

## Commands

```bash
pnpm --filter @payflow/provider-contract typecheck
```

## Conventions

- A bug here is invisible to reconciliation, because both sides import it; bad signature and out of order webhook tests use hand built payloads

Root [AGENTS.md](../../AGENTS.md) rules apply here too.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
