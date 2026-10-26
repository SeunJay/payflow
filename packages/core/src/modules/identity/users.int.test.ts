import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { createLogger } from '@payflow/shared';
import { createTestDatabase, type TestDatabase } from '@payflow/test-utils';
import { createDb, type DbHandle } from '../../infra/db.ts';
import { withTx } from '../../infra/tx.ts';
import { createAuthContext, type AuthContext } from './auth-context.ts';
import { prepareSignUp, registerUser, verifyCredentials } from './users.ts';

describe('verifyCredentials (AC-6)', () => {
  let database: TestDatabase;
  let handle: DbHandle;
  let auth: AuthContext;
  const email = `known-${randomUUID()}@example.com`;
  const password = 'correct horse battery';

  beforeAll(async () => {
    database = await createTestDatabase();
    handle = createDb({ url: database.url, logger: createLogger({ name: 'test', level: 'silent' }) });
    auth = await createAuthContext({
      jwtSecret: 's'.repeat(32),
      accessTtlSeconds: 900,
      refreshTtlSeconds: 3600,
      bcryptCost: 4,
    });
    const prepared = await prepareSignUp(auth, { email, password });
    await withTx(handle.db, (tx) => registerUser(tx, prepared));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await handle.close();
    await database.drop();
  });

  it('runs exactly one compare against the dummy hash for an unknown email', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');

    await expect(
      verifyCredentials(handle.db, auth, { email: `nobody-${randomUUID()}@example.com`, password }),
    ).rejects.toMatchObject({
      code: 'invalid_credentials',
    });

    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare).toHaveBeenCalledWith(password, auth.dummyHash);
  });

  it('runs exactly one compare for a wrong password, and returns the user for the right one', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');

    await expect(verifyCredentials(handle.db, auth, { email, password: 'wrong password!' })).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    await expect(verifyCredentials(handle.db, auth, { email, password })).resolves.toMatchObject({ email });

    expect(compare).toHaveBeenCalledTimes(2);
  });

  it('computes the dummy hash at the configured cost', () => {
    expect(bcrypt.getRounds(auth.dummyHash)).toBe(4);
  });
});
