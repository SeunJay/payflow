// The users use case called directly, with no HTTP (spec 0005).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthService } from '../auth/auth.service.ts';
import { createTestDeps, PASSWORD, uniqueEmail, type TestDeps } from '../../test-support.ts';
import { createUsersService, type UsersService } from './users.service.ts';

describe('users service', () => {
  let deps: TestDeps;
  let service: UsersService;

  beforeAll(async () => {
    deps = await createTestDeps();
    service = createUsersService(deps);
  });

  afterAll(async () => {
    await deps.close();
  });

  it('returns the caller from their user id (AC-8)', async () => {
    const email = uniqueEmail('me');
    const { user } = await createAuthService(deps).signUp({ email, password: PASSWORD });

    expect(await service.getMe(user.id)).toEqual(user);
  });

  it('throws 401 unauthenticated, not a null, when the user is gone (AC-7)', async () => {
    await expect(service.getMe(randomUUID())).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });
  });
});
