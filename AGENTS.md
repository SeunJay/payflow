# PayFlow Lab

A simulated payment platform for learning how fintech backends keep money correct under retries, timeouts, crashes, and disagreement. Scope: [docs/scope/scope.md](docs/scope/scope.md).

## Stack

- **Language / Runtime**: TypeScript (strict, ESM), Node 24 LTS (`.nvmrc`), run with `tsx`; nothing compiles to `dist`
- **Framework**: Express 5 (api, simulator), BullMQ on Valkey 8 (worker), Zod 4, Pino
- **Key dependencies**: PostgreSQL 18 via Drizzle ORM over `pg`; Vitest + Testcontainers (Docker required)
- **Package manager**: pnpm 12 workspaces (`apps/*` api, worker, simulator; `packages/*` core, http, shared, provider-contract, test-utils)
- Decided in [spec 0001](docs/specs/0001-stack-architecture/index.md), including the package dependency rules table

## Build approach

**Tracer Bullet**: each slice runs end to end through database, API, worker, and tests, real but narrow, before the next slice thickens it.

## Commands

```bash
pnpm install                     # Node 24 first: nvm use
pnpm run up && pnpm db:migrate   # Postgres + Valkey containers, then both migrations
pnpm dev                         # api :3000, worker :3100, simulator :4000
pnpm typecheck                   # the passing build (tsc --noEmit per package)
pnpm test run                    # unit + integration; --project unit skips Docker
```

## Specs

Stored in `docs/specs/`. Format: `docs/specs/NNNN-title.md` (or `NNNN-title/index.md`).

## Rules

- Functional style: plain functions and `readonly` data, no classes where a function works (`AppError` is the one exception); no shared mutable module state
- Side effects stay at the edges and explicit: writing services take `tx: Tx` from `withTx` first; async reactions go through the outbox; money is `bigint` minor units
- Respect spec 0001's import rules: apps never import each other, the simulator never imports `@payflow/core`, core modules talk only through `index.ts`
- Expected client failures throw `AppError` (stable `code` + HTTP status), turned into Problem Details by `@payflow/http`; anything else is a bug and a plain 500
- Strict TypeScript, no `any`; env vars are validated by each app's Zod config schema at boot
- Named exports only. Every export from a module's `index.ts` or a package entry gets a short doc comment
- Files `kebab-case.ts`; values camelCase, types PascalCase; Postgres tables and columns snake_case (Drizzle `casing: 'snake_case'`); env vars UPPER_SNAKE
- Tests sit beside the source: `*.test.ts` (unit) and `*.int.test.ts` (real containers)

## Tooling

Chosen here, installed by `/develop tooling`: ESLint flat config + typescript-eslint `strictTypeChecked` and `stylisticTypeChecked`; Prettier (single quotes, semicolons, width 120, trailing commas); dependency-cruiser enforcing spec 0001's import rules and no cycles; hooks and CI per [spec 0002](docs/specs/0002-git-workflow.md). Rollout: one `chore: apply prettier formatting` commit, then a lint fix commit.

## Git

- integration: on
- commit: offer (each skill run ends by proposing one Conventional Commit; nothing commits without your yes)
- push: never (you push, open the PR, and merge)
- branch: `<type>/<NN>-<slug>`, one per scope feature; never commit on main
- diff scope on a feature branch: `/test` and `/check review` use `main...HEAD` plus the working tree
- merge: squash via PR when CI is green; tags `slice-NN` after Slice features. Full rules: spec 0002

## Agent skills

- [drizzle](.claude/skills/drizzle/): `bobmatnyc/claude-mpm-skills`, Drizzle schema and queries
- [drizzle-orm-patterns](.claude/skills/drizzle-orm-patterns/): `giuseppe-trisciuoglio/developer-kit`, Drizzle relations, transactions, migrations
- [postgresql-table-design](.claude/skills/postgresql-table-design/): `wshobson/agents`, Postgres types, constraints, indexes
- [bullmq-specialist](.claude/skills/bullmq-specialist/): `sickn33/agentic-awesome-skills`, BullMQ queues, retries, workers
- [valkey](.claude/skills/valkey/): `valkey-io/valkey-skills`, Valkey usage and persistence
- [redis-core](.claude/skills/redis-core/): `redis/agent-skills`, Redis data structures and key naming
- [node](.claude/skills/node/): `mcollina/skills`, Node errors, shutdown, streams, flaky tests
- [pnpm](.claude/skills/pnpm/): `antfu/skills`, workspaces, catalogs, CI installs
- [vitest](.claude/skills/vitest/): `antfu/skills`, Vitest projects, mocking, fixtures
- [zod](.claude/skills/zod/): `pproenca/dot-skills`, Zod 4 schemas and parsing

Declined: wshobson/agents@github-actions-templates, callstackincubator/agent-skills@github-actions, patricio0312rev/skills@eslint-prettier-config
MCP servers: redis/mcp-redis (recommended), a Postgres MCP with a SELECT only role (recommended), Docker MCP (recommended), github/github-mcp-server (recommended)

## Context files

- [apps/api/AGENTS.md](apps/api/AGENTS.md) (public HTTP API)
- [apps/worker/AGENTS.md](apps/worker/AGENTS.md) (outbox relay and job consumers)
- [apps/simulator/AGENTS.md](apps/simulator/AGENTS.md) (fake payment provider, own database)
- [packages/core/AGENTS.md](packages/core/AGENTS.md) (domain modules, db, transactions)
- [packages/http/AGENTS.md](packages/http/AGENTS.md) (shared Express shell, Problem Details)
- [packages/shared/AGENTS.md](packages/shared/AGENTS.md) (logger, config, errors, shutdown)
- [packages/provider-contract/AGENTS.md](packages/provider-contract/AGENTS.md) (provider API and webhook schemas)
- [packages/test-utils/AGENTS.md](packages/test-utils/AGENTS.md) (containers and test databases)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
