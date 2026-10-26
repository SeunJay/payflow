import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { post, withTx } from '@payflow/core';
import {
  accessCookie,
  claims,
  forgeJwt,
  getFrom,
  newSession,
  startTestApi,
  type Session,
  type TestApi,
} from './test-support.ts';

describe('wallet reads and access tokens', () => {
  let api: TestApi;
  let alice: Session;

  beforeAll(async () => {
    api = await startTestApi();
    alice = await newSession(api);
  });

  afterAll(async () => {
    await api.close();
  });

  describe('access token checks (AC-7)', () => {
    const routes = ['/v1/me', '/v1/wallet', '/v1/wallet/history'];

    it('accepts a hand built token with the real claims, so the forgeries below differ only where named', async () => {
      const token = forgeJwt(claims(alice.userId));

      expect((await getFrom(api, '/v1/wallet', accessCookie(token))).status).toBe(200);
    });

    const unauthenticated: [string, () => string | undefined][] = [
      ['a missing cookie', () => undefined],
      ['garbage', () => accessCookie('not.a.jwt')],
      ['an empty cookie', () => accessCookie('')],
      [
        'a token signed with another secret',
        () => accessCookie(forgeJwt(claims(alice.userId), { secret: 'x'.repeat(40) })),
      ],
      ['an alg none token', () => accessCookie(forgeJwt(claims(alice.userId), { alg: 'none' }))],
      ['an HS512 token with the right secret', () => accessCookie(forgeJwt(claims(alice.userId), { alg: 'HS512' }))],
      ['a wrong aud', () => accessCookie(forgeJwt(claims(alice.userId, undefined, { aud: 'someone-else' })))],
      ['a wrong iss', () => accessCookie(forgeJwt(claims(alice.userId, undefined, { iss: 'someone-else' })))],
      ['a non uuid sub', () => accessCookie(forgeJwt(claims('alice')))],
      ['a missing sid', () => accessCookie(forgeJwt(claims(alice.userId, undefined, { sid: undefined })))],
    ];

    for (const route of routes) {
      it.each(unauthenticated)(`answers ${route} with %s with 401 unauthenticated`, async (_name, cookie) => {
        const res = await getFrom(api, route, cookie());

        expect(res.status).toBe(401);
        expect(await res.json()).toMatchObject({ code: 'unauthenticated', title: 'Authentication required' });
      });
    }

    it('answers a correctly signed but expired token with 401 token_expired', async () => {
      const past = Math.floor(Date.now() / 1000) - 60;
      const token = forgeJwt(claims(alice.userId, undefined, { iat: past - 900, exp: past }));

      for (const route of routes) {
        const res = await getFrom(api, route, accessCookie(token));
        expect(res.status).toBe(401);
        expect(await res.json()).toMatchObject({ code: 'token_expired', detail: 'Refresh the session and retry' });
      }
    });

    it('answers an expired token signed with another secret with unauthenticated, not token_expired', async () => {
      const past = Math.floor(Date.now() / 1000) - 60;
      const token = forgeJwt(claims(alice.userId, undefined, { exp: past }), { secret: 'y'.repeat(40) });

      expect(await (await getFrom(api, '/v1/me', accessCookie(token))).json()).toMatchObject({
        code: 'unauthenticated',
      });
    });

    it('ignores an Authorization header, valid token or not', async () => {
      const res = await getFrom(api, '/v1/wallet', undefined, { authorization: `Bearer ${alice.access}` });

      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: 'unauthenticated' });
    });

    it('answers a valid token for a user that does not exist with 401 unauthenticated, not 500', async () => {
      const cookie = accessCookie(forgeJwt(claims(randomUUID())));

      for (const route of routes) {
        const res = await getFrom(api, route, cookie);
        expect(res.status).toBe(401);
        expect(await res.json()).toMatchObject({ code: 'unauthenticated' });
      }
    });
  });

  describe('isolation (AC-9)', () => {
    it('shows each user only their own wallet and history, whatever ids the request carries', async () => {
      const bob = await newSession(api);
      await deposit(alice.userId, 5_000n);

      const bobWallet = await getFrom(
        api,
        `/v1/wallet?userId=${alice.userId}&walletId=${alice.walletId}`,
        accessCookie(bob.access),
      );
      const bobHistory = await getFrom(api, `/v1/wallet/history?userId=${alice.userId}`, accessCookie(bob.access));
      const aliceWallet = await getFrom(api, '/v1/wallet', accessCookie(alice.access));

      expect(await bobWallet.json()).toEqual({ id: bob.walletId, balance: { amount: '1000000', currency: 'NGN' } });
      const items = ((await bobHistory.json()) as { items: { balanceAfter: string }[] }).items;
      expect(items.map((i) => i.balanceAfter)).toEqual(['1000000']);
      expect(await aliceWallet.json()).toEqual({ id: alice.walletId, balance: { amount: '1005000', currency: 'NGN' } });
      expect(await (await getFrom(api, '/v1/me', accessCookie(bob.access))).json()).toMatchObject({ id: bob.userId });
    });
  });

  describe('history pagination (AC-8)', () => {
    type Page = { items: { amount: string; balanceAfter: string }[]; nextCursor: string | null };

    it('pages 121 entries as 50, 50, 21 newest first with no empty trailing page', async () => {
      const carol = await newSession(api);
      for (let i = 1; i <= 120; i++) await deposit(carol.userId, BigInt(i));
      const cookie = accessCookie(carol.access);

      const pages: Page[] = [];
      let cursor: string | null = '';
      while (cursor !== null) {
        const res = await getFrom(api, `/v1/wallet/history${cursor ? `?cursor=${cursor}` : ''}`, cookie);
        expect(res.status).toBe(200);
        const page = (await res.json()) as Page;
        pages.push(page);
        cursor = page.nextCursor;
      }

      expect(pages.map((p) => p.items.length)).toEqual([50, 50, 21]);
      const amounts = pages.flatMap((p) => p.items.map((i) => i.amount));
      expect(amounts[0]).toBe('120');
      expect(amounts.at(-1)).toBe('1000000');
      const balances = pages.flatMap((p) => p.items.map((i) => BigInt(i.balanceAfter)));
      expect(balances.every((b, i) => i === 0 || b < balances[i - 1]!)).toBe(true);
    });

    it('honours limit', async () => {
      const res = await getFrom(api, '/v1/wallet/history?limit=1', accessCookie(alice.access));

      const page = (await res.json()) as Page;
      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).not.toBeNull();
    });

    it('accepts the largest Postgres bigint as a cursor', async () => {
      const res = await getFrom(api, '/v1/wallet/history?cursor=9223372036854775807', accessCookie(alice.access));

      expect(res.status).toBe(200);
    });

    it.each([
      'cursor=abc',
      'cursor=0',
      'cursor=-1',
      'cursor=9223372036854775808',
      'cursor=9999999999999999999',
      'cursor=1&cursor=2',
      'limit=0',
      'limit=101',
      'limit=abc',
      'limit=1.5',
    ])('answers ?%s with 422 validation_failed', async (query) => {
      const res = await getFrom(api, `/v1/wallet/history?${query}`, accessCookie(alice.access));

      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ code: 'validation_failed' });
    });
  });

  async function deposit(userId: string, amount: bigint): Promise<void> {
    const { rows } = await api.pool.query<{ account: string; funding: string }>(
      `select w.ledger_account_id as account, (select id from ledger_accounts where code = 'test_funding') as funding
         from wallets w where w.user_id = $1`,
      [userId],
    );
    const { account, funding } = rows[0]!;
    await withTx(api.db, (tx) =>
      post(tx, {
        postingKey: `extra:${randomUUID()}`,
        kind: 'test_deposit',
        description: 'Extra test deposit',
        entries: [
          { accountId: funding, amount },
          { accountId: account, amount: -amount },
        ],
      }),
    );
  }
});
