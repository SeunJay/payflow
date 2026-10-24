# Verify: Stack & architecture · spec 0001 · updated 2026-10-24
_Steps derived from the feature's "Done when" (spec 0001 has no numbered acceptance criteria). `/check verify` runs these; `/test` locks the durable ones._

Run from the repo root on Node 24 (`nvm use`), with `.env` copied from `.env.example`.

## Commands
- [ ] `pnpm run up` → Postgres 18 and Valkey 8 containers report healthy (use `pnpm run up`; plain `pnpm up` is pnpm's update command) → DW-1
- [ ] `pnpm run db:migrate` → both core and simulator runs exit 0; `drizzle.__drizzle_migrations` exists in the `payflow` and `simulator` databases → DW-1
- [ ] `pnpm typecheck` → all 9 workspace packages pass `tsc --noEmit` → DW-2
- [ ] `pnpm dev`, then `curl localhost:3000/health`, `:3100/health`, `:4000/health` → each 200 → DW-1
- [ ] `curl localhost:3000/ready`, `:3100/ready`, `:4000/ready` → each 200, every check `ok: true` → DW-1
- [ ] `docker compose stop valkey postgres` → every `/ready` returns 503 naming the failed checks, no process crashes; `docker compose start valkey postgres` → back to 200 without restarting the apps → DW-3
- [ ] Send SIGTERM to the api, worker, or simulator → logs each shutdown step in order, then exits 0 → DW-3
- [ ] Start an app with `DATABASE_URL=nope` → prints every config problem and exits 1 → DW-3
- [ ] `psql` as `payflow` into the `simulator` DB, and as `simulator` into `payflow` → both refused ("User does not have CONNECT privilege") → DW-4
- [ ] `curl -i localhost:3000/v1/nope` → 404, `application/problem+json` with `code: "not_found"`, plus `x-request-id` and `x-correlation-id` headers → DW-1

## Done when coverage
- DW-1 (API, worker, and simulator each boot locally against a local database): steps 1, 2, 4, 5, 10
- DW-2 (a passing build): step 3
- DW-3 (local runtime contract: readiness, reconnects, graceful shutdown, fail fast config): steps 6, 7, 8
- DW-4 (two databases, two roles, isolated): step 9
