// Testcontainers setup, per file template databases, and small test helpers.
import { randomUUID } from 'node:crypto';
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { inject } from 'vitest';
import { TEMPLATE_DB } from './context.ts';

/** Connection URLs for the containers global-setup.ts started. Integration tests only. */
export function testUrls() {
  return {
    postgresAdmin: inject('postgresAdminUrl'),
    payflow: inject('payflowUrl'),
    simulator: inject('simulatorUrl'),
    valkey: inject('valkeyUrl'),
  };
}

export type TestDatabase = { url: string; drop: () => Promise<void> };

/**
 * A fresh, migrated payflow database owned by the payflow role, cloned from
 * the template so each test file starts clean. Call `drop` in `afterAll`.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `test_${randomUUID().replaceAll('-', '')}`;
  await asAdmin((client) => client.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DB} OWNER payflow`));

  const url = new URL(inject('payflowUrl'));
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: async () => {
      await asAdmin((client) => client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
    },
  };
}

/** Runs one piece of work as the Postgres superuser, then disconnects. */
export async function asAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: inject('postgresAdminUrl') });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export type RunningServer = { url: string; close: () => Promise<void> };

/**
 * Gives tests a URL to talk real HTTP to. A handler (or Express app) is
 * listened on a free port; a server that called `listen` itself is awaited.
 */
export async function startServer(handlerOrServer: RequestListener | Server): Promise<RunningServer> {
  let server: Server;
  if (typeof handlerOrServer === 'function') {
    server = createServer(handlerOrServer);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  } else {
    server = handlerOrServer;
    if (!server.listening) await new Promise<void>((resolve) => server.once('listening', resolve));
  }
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
