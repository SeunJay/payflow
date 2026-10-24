import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { GenericContainer, Wait } from 'testcontainers';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { TEMPLATE_DB } from './context.ts';

const repoRoot = new URL('../../../', import.meta.url);
const repoPath = (path: string) => fileURLToPath(new URL(path, repoRoot));

// Test only passwords; the containers live for one run.
const PASSWORDS = { postgres: 'postgres_test', payflow: 'payflow_test', simulator: 'simulator_test' };

/**
 * Starts Postgres and Valkey once per run. Postgres is built the same way as
 * docker compose: the real init script makes both roles and databases, then
 * both migration folders run, then the migrated payflow database is copied to
 * a template that each test file clones.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [postgres, valkey] = await Promise.all([
    new PostgreSqlContainer('postgres:18')
      .withUsername('postgres')
      .withPassword(PASSWORDS.postgres)
      .withDatabase('postgres')
      .withEnvironment({ PAYFLOW_DB_PASSWORD: PASSWORDS.payflow, SIMULATOR_DB_PASSWORD: PASSWORDS.simulator })
      .withCopyFilesToContainer([
        { source: repoPath('docker/postgres-init.sh'), target: '/docker-entrypoint-initdb.d/01-init.sh', mode: 0o755 },
      ])
      .start(),
    new GenericContainer('valkey/valkey:8')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
  ]);

  const host = postgres.getHost();
  const port = postgres.getMappedPort(5432);
  const urlFor = (user: keyof typeof PASSWORDS, database: string) =>
    `postgres://${user}:${PASSWORDS[user]}@${host}:${port}/${database}`;

  const payflowUrl = urlFor('payflow', 'payflow');
  const simulatorUrl = urlFor('simulator', 'simulator');
  const adminUrl = urlFor('postgres', 'postgres');

  await runMigrations(payflowUrl, repoPath('packages/core/migrations'));
  await runMigrations(simulatorUrl, repoPath('apps/simulator/migrations'));

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${TEMPLATE_DB} TEMPLATE payflow OWNER payflow`);
  await admin.end();

  project.provide('postgresAdminUrl', adminUrl);
  project.provide('payflowUrl', payflowUrl);
  project.provide('simulatorUrl', simulatorUrl);
  project.provide('valkeyUrl', `redis://${valkey.getHost()}:${valkey.getMappedPort(6379)}`);

  return async () => {
    await Promise.all([postgres.stop(), valkey.stop()]);
  };
}

async function runMigrations(url: string, migrationsFolder: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
