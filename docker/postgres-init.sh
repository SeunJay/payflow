#!/usr/bin/env bash
# Runs once, on a fresh volume only. Reset with `pnpm run down -v`.
# Each role owns only its own database; neither can connect to the other's.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v payflow_pw="$PAYFLOW_DB_PASSWORD" \
  -v simulator_pw="$SIMULATOR_DB_PASSWORD" <<'SQL'
CREATE ROLE payflow LOGIN PASSWORD :'payflow_pw';
CREATE ROLE simulator LOGIN PASSWORD :'simulator_pw';

CREATE DATABASE payflow OWNER payflow;
CREATE DATABASE simulator OWNER simulator;

REVOKE CONNECT ON DATABASE payflow FROM PUBLIC;
REVOKE CONNECT ON DATABASE simulator FROM PUBLIC;
GRANT CONNECT ON DATABASE payflow TO payflow;
GRANT CONNECT ON DATABASE simulator TO simulator;
SQL
