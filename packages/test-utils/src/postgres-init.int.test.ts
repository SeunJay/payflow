import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { asAdmin, testUrls } from './index.ts';

// global-setup.ts builds the test Postgres with the real docker/postgres-init.sh
// and both migration folders, so these tests check that script and the
// migrate step, not a test only copy of them.

// Postgres 18 words this "permission denied for database"; the SQLSTATE is stable.
const INSUFFICIENT_PRIVILEGE = '42501';

function urlWithDatabase(url: string, database: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  return next.toString();
}

async function connectAs(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
  } finally {
    await client.end().catch(() => {});
  }
}

describe('docker/postgres-init.sh', () => {
  it('lets each role connect to its own database (DW-4)', async () => {
    const { payflow, simulator } = testUrls();

    await expect(connectAs(payflow)).resolves.toBeUndefined();
    await expect(connectAs(simulator)).resolves.toBeUndefined();
  });

  it('refuses the payflow role in the simulator database (DW-4)', async () => {
    const url = urlWithDatabase(testUrls().payflow, 'simulator');

    await expect(connectAs(url)).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
  });

  it('refuses the simulator role in the payflow database (DW-4)', async () => {
    const url = urlWithDatabase(testUrls().simulator, 'payflow');

    await expect(connectAs(url)).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
  });

  it('makes each role the owner of its database', async () => {
    const owners = await asAdmin(async (client) => {
      const result = await client.query<{ datname: string; owner: string }>(
        `select datname, pg_get_userbyid(datdba) as owner from pg_database where datname in ('payflow', 'simulator') order by datname`,
      );
      return result.rows;
    });

    expect(owners).toEqual([
      { datname: 'payflow', owner: 'payflow' },
      { datname: 'simulator', owner: 'simulator' },
    ]);
  });
});

describe('migrations', () => {
  it.each(['payflow', 'simulator'] as const)('leaves drizzle.__drizzle_migrations in the %s database (DW-1)', async (database) => {
    const client = new pg.Client({ connectionString: testUrls()[database] });
    await client.connect();
    try {
      const result = await client.query<{ table: string | null }>(`select to_regclass('drizzle.__drizzle_migrations')::text as table`);
      expect(result.rows[0]?.table).toBe('drizzle.__drizzle_migrations');
    } finally {
      await client.end();
    }
  });
});
