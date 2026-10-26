// The wallet use cases called directly, with no HTTP (spec 0005).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthService } from '../auth/auth.service.ts';
import { createTestDeps, PASSWORD, uniqueEmail, type TestDeps } from '../../test-support.ts';
import { createWalletsService, type WalletsService } from './wallets.service.ts';

describe('wallets service', () => {
  let deps: TestDeps;
  let service: WalletsService;

  beforeAll(async () => {
    deps = await createTestDeps();
    service = createWalletsService(deps);
  });

  afterAll(async () => {
    await deps.close();
  });

  const signUp = () => createAuthService(deps).signUp({ email: uniqueEmail('wallet'), password: PASSWORD });

  it('returns the caller’s ₦10,000 wallet (AC-8)', async () => {
    const { user, wallet } = await signUp();

    expect(await service.getMyWallet(user.id)).toEqual({
      id: wallet.id,
      balance: { amount: 1_000_000n, currency: 'NGN' },
    });
  });

  it('returns one test deposit in the caller’s history, honouring limit (AC-8)', async () => {
    const { user } = await signUp();

    const page = await service.getMyHistory(user.id, { limit: 1 });

    expect(page.currency).toBe('NGN');
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ kind: 'test_deposit', amount: 1_000_000n, balanceAfter: 1_000_000n });
    expect(page.nextCursor).toBeNull();
  });

  it('keeps two users apart: each id reads only its own wallet (AC-9)', async () => {
    const ada = await signUp();
    const bob = await signUp();

    expect((await service.getMyWallet(ada.user.id)).id).toBe(ada.wallet.id);
    expect((await service.getMyWallet(bob.user.id)).id).toBe(bob.wallet.id);
  });

  it('throws 401 unauthenticated, not a null, when the user has no wallet (AC-7)', async () => {
    const missing = randomUUID();

    await expect(service.getMyWallet(missing)).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });
    await expect(service.getMyHistory(missing, {})).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });
  });
});
