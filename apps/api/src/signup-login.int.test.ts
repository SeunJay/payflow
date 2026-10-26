import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openWallet, prepareSignUp, registerUser, verifyLedger, withTx, type Tx, type User } from '@payflow/core';
import { holdOpen, waitForLockWaiters } from '@payflow/test-utils';
import {
  accessCookie,
  getFrom,
  PASSWORD,
  postTo,
  setCookies,
  signUp,
  startTestApi,
  uniqueEmail,
  type TestApi,
  anyString,
} from './test-support.ts';

describe('sign up and log in', () => {
  let api: TestApi;

  beforeAll(async () => {
    api = await startTestApi();
  });

  afterAll(async () => {
    await api.close();
  });

  const count = async (sql: string, params: unknown[] = []) =>
    (await api.pool.query<{ n: number }>(`select count(*)::int as n from (${sql}) q`, params)).rows[0]!.n;

  it('signs up with a funded wallet, logs in, and reads ₦10,000 backed by two balanced entries (AC-1, AC-2, AC-5, AC-8)', async () => {
    const email = uniqueEmail('Happy');

    const signup = await postTo(api, '/v1/auth/signup', { email: `  ${email.toUpperCase()} `, password: PASSWORD });

    expect(signup.status).toBe(201);
    const created = (await signup.json()) as { user: { id: string; createdAt: string }; wallet: { id: string } };
    expect(created).toEqual({
      user: { id: anyString, email: email.toLowerCase(), createdAt: anyString },
      wallet: { id: anyString, balance: { amount: '1000000', currency: 'NGN' } },
    });
    const stored = await api.pool.query<{ email: string; password_hash: string }>(
      'select email, password_hash from users where id = $1',
      [created.user.id],
    );
    expect(stored.rows[0]!.email).toBe(email.toLowerCase());
    expect(stored.rows[0]!.password_hash).toMatch(/^\$2b\$04\$.{53}$/);
    expect(stored.rows[0]!.password_hash).not.toContain(PASSWORD);

    const login = await postTo(api, '/v1/auth/login', { email, password: PASSWORD });

    expect(login.status).toBe(200);
    expect(login.headers.get('cache-control')).toBe('no-store');
    const session = (await login.json()) as { accessExpiresAt: string; refreshExpiresAt: string };
    expect(session).toEqual({
      user: { id: created.user.id, email: email.toLowerCase() },
      accessExpiresAt: anyString,
      refreshExpiresAt: anyString,
    });
    const rows = await api.pool.query<{ id: string; expires_at: Date; ttl: number }>(
      `select id, expires_at, extract(epoch from expires_at - created_at)::int as ttl
         from auth_sessions where user_id = $1`,
      [created.user.id],
    );
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0]!;
    expect(row.ttl).toBe(604_800);
    expect(session.refreshExpiresAt).toBe(row.expires_at.toISOString());
    const access = Date.parse(session.accessExpiresAt) - Date.now();
    expect(access).toBeGreaterThan(890_000);
    expect(access).toBeLessThanOrEqual(900_000);

    const cookies = setCookies(login);
    const expires = `Expires=${row.expires_at.toUTCString()}`;
    expect(cookies.payflow_access!.attributes).toBe(`Path=/v1; ${expires}; HttpOnly; SameSite=Strict`);
    expect(cookies.payflow_refresh!.attributes).toBe(`Path=/v1/auth; ${expires}; HttpOnly; SameSite=Strict`);
    expect(cookies.payflow_refresh!.value).toMatch(new RegExp(`^${row.id}\\.[A-Za-z0-9_-]{43}$`));
    const cookie = accessCookie(cookies.payflow_access!.value);

    const wallet = await getFrom(api, '/v1/wallet', cookie);
    expect(wallet.status).toBe(200);
    expect(await wallet.json()).toEqual({ id: created.wallet.id, balance: { amount: '1000000', currency: 'NGN' } });

    const history = await getFrom(api, '/v1/wallet/history', cookie);
    expect(history.status).toBe(200);
    const page = (await history.json()) as { items: { transactionId: string }[] };
    expect(page).toEqual({
      currency: 'NGN',
      items: [
        {
          transactionId: anyString,
          kind: 'test_deposit',
          description: 'Sign up test deposit',
          amount: '1000000',
          balanceAfter: '1000000',
          createdAt: anyString,
        },
      ],
      nextCursor: null,
    });
    const entries = await api.pool.query<{ n: number; total: string }>(
      'select count(*)::int as n, sum(amount)::text as total from ledger_entries where transaction_id = $1',
      [page.items[0]!.transactionId],
    );
    expect(entries.rows[0]).toEqual({ n: 2, total: '0' });
    const posting = await api.pool.query<{ posting_key: string }>(
      'select posting_key from ledger_transactions where id = $1',
      [page.items[0]!.transactionId],
    );
    expect(posting.rows[0]!.posting_key).toBe(`test_deposit:${created.user.id}`);
    expect((await verifyLedger(api.db)).drift).toEqual([]);

    const me = await getFrom(api, '/v1/me', cookie);
    expect(await me.json()).toEqual({
      id: created.user.id,
      email: email.toLowerCase(),
      createdAt: created.user.createdAt,
    });
  });

  it('opens an independent session on every log in (AC-5)', async () => {
    const email = uniqueEmail();
    const { user } = await signUp(api, email);

    await postTo(api, '/v1/auth/login', { email, password: PASSWORD });
    await postTo(api, '/v1/auth/login', { email, password: PASSWORD });

    expect(await count('select 1 from auth_sessions where user_id = $1', [user.id])).toBe(2);
  });

  it('leaves no user, wallet, account, or ledger rows when the unit of work fails after the user insert (AC-2)', async () => {
    const email = uniqueEmail();
    const prepared = await prepareSignUp(api.auth, { email, password: PASSWORD });
    const funding = await api.pool.query<{ balance: string; last_seq: string }>(
      `select balance::text, last_seq::text from ledger_accounts where code = 'test_funding'`,
    );
    const before = {
      accounts: await count('select 1 from ledger_accounts'),
      transactions: await count('select 1 from ledger_transactions'),
      wallets: await count('select 1 from wallets'),
    };

    const failing = withTx(api.db, async (tx) => {
      const user = await registerUser(tx, prepared);
      await openWallet(tx, user.id);
      throw new Error('failed after the deposit');
    });

    await expect(failing).rejects.toThrow('failed after the deposit');
    expect(await count('select 1 from users where email = $1', [email])).toBe(0);
    expect(await count('select 1 from ledger_accounts')).toBe(before.accounts);
    expect(await count('select 1 from ledger_transactions')).toBe(before.transactions);
    expect(await count('select 1 from wallets')).toBe(before.wallets);
    const after = await api.pool.query(
      `select balance::text, last_seq::text from ledger_accounts where code = 'test_funding'`,
    );
    expect(after.rows[0]).toEqual(funding.rows[0]);
  });

  describe('input (AC-3)', () => {
    const multibyte72 = 'é'.repeat(36);

    const invalid: [string, unknown][] = [
      ['a missing email', { password: PASSWORD }],
      ['a missing password', { email: uniqueEmail() }],
      ['a non string email', { email: 42, password: PASSWORD }],
      ['a non string password', { email: uniqueEmail(), password: 123456789012 }],
      ['an invalid email', { email: 'not-an-email', password: PASSWORD }],
      ['an email over 254 characters after trimming', { email: `${'a'.repeat(250)}@x.com`, password: PASSWORD }],
      ['an 11 byte password', { email: uniqueEmail(), password: 'a'.repeat(11) }],
      ['a 73 byte multibyte password', { email: uniqueEmail(), password: `${multibyte72}a` }],
      ['an array body', [{ email: uniqueEmail(), password: PASSWORD }]],
    ];

    it.each(invalid)('rejects %s with 422 validation_failed and writes nothing', async (_name, body) => {
      const before = await count('select 1 from users');

      const res = await postTo(api, '/v1/auth/signup', body);

      expect(res.status).toBe(422);
      expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
      expect(await res.json()).toMatchObject({ code: 'validation_failed', status: 422, detail: anyString });
      expect(await count('select 1 from users')).toBe(before);
    });

    it('accepts a 12 byte password and a 72 byte multibyte one', async () => {
      expect((await postTo(api, '/v1/auth/signup', { email: uniqueEmail(), password: 'a'.repeat(12) })).status).toBe(
        201,
      );
      expect((await postTo(api, '/v1/auth/signup', { email: uniqueEmail(), password: multibyte72 })).status).toBe(201);
    });

    it('does not echo the submitted values in the 422 detail', async () => {
      const res = await postTo(api, '/v1/auth/signup', { email: 'secret-value-not-an-email', password: 'short' });

      expect(await res.text()).not.toContain('secret-value');
    });

    const wrongTypes: [string, string, RequestInit['body'] | undefined, string | null][] = [
      ['text/plain sign up', '/v1/auth/signup', 'hello', 'text/plain'],
      ['form encoded sign up', '/v1/auth/signup', 'email=a%40b.com&password=x', 'application/x-www-form-urlencoded'],
      ['sign up with no Content-Type', '/v1/auth/signup', undefined, null],
      ['an empty log out with no Content-Type', '/v1/auth/logout', undefined, null],
      ['an empty form typed log out', '/v1/auth/logout', undefined, 'application/x-www-form-urlencoded'],
      ['an empty text/plain refresh', '/v1/auth/refresh', undefined, 'text/plain'],
    ];

    it.each(wrongTypes)('answers %s with 415 unsupported_media_type', async (_name, path, body, contentType) => {
      const res = await fetch(`${api.url}${path}`, {
        method: 'POST',
        headers: contentType ? { 'content-type': contentType } : {},
        ...(body === undefined ? {} : { body }),
      });

      expect(res.status).toBe(415);
      expect(await res.json()).toMatchObject({
        code: 'unsupported_media_type',
        detail: 'Content-Type must be application/json',
      });
    });

    it('accepts application/json with a charset parameter and any letter case', async () => {
      const res = await postTo(
        api,
        '/v1/auth/signup',
        { email: uniqueEmail(), password: PASSWORD },
        {
          contentType: 'Application/JSON; charset=utf-8',
        },
      );

      expect(res.status).toBe(201);
    });

    it('leaves broken, oversized, and wrong charset bodies to the shell (400, 413, 415 invalid_body)', async () => {
      const broken = await postTo(api, '/v1/auth/signup', undefined, { raw: '{"email":' });
      const huge = await postTo(api, '/v1/auth/signup', undefined, {
        raw: JSON.stringify({ pad: 'x'.repeat(110_000) }),
      });
      const latin = await postTo(api, '/v1/auth/signup', undefined, {
        raw: '{}',
        contentType: 'application/json; charset=latin1',
      });

      expect([broken.status, huge.status, latin.status]).toEqual([400, 413, 415]);
      for (const res of [broken, huge, latin]) expect(await res.json()).toMatchObject({ code: 'invalid_body' });
    });

    it('still answers an unknown /v1 path with 404 not_found', async () => {
      const res = await postTo(api, '/v1/nope', {});

      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: 'not_found' });
    });
  });

  describe('duplicate email (AC-4)', () => {
    it('answers the same email in another case or with spaces with 409 email_taken', async () => {
      const email = uniqueEmail('alice');
      await signUp(api, email);

      const again = await postTo(api, '/v1/auth/signup', { email: ` ${email.toUpperCase()} `, password: PASSWORD });

      expect(again.status).toBe(409);
      expect(await again.json()).toMatchObject({
        code: 'email_taken',
        title: 'Email already registered',
        detail: 'An account with this email already exists',
      });
    });

    it('creates exactly one user, wallet, and deposit when two sign ups race on one email', async () => {
      const email = uniqueEmail('race');
      const prepared = await prepareSignUp(api.auth, { email, password: PASSWORD });
      const signUpTx = async (tx: Tx): Promise<User> => {
        const user = await registerUser(tx, prepared);
        await openWallet(tx, user.id);
        return user;
      };

      const first = holdOpen((fn: (tx: Tx) => Promise<User>) => withTx(api.db, fn), signUpTx);
      const winner = await first.worked;
      // The second insert blocks on the unique index until the first commits.
      const second = withTx(api.db, signUpTx);
      await waitForLockWaiters(api.pool, 1);
      await first.commit();

      await expect(second).rejects.toMatchObject({ code: 'email_taken', status: 409 });
      expect(await count('select 1 from users where email = $1', [email])).toBe(1);
      expect(await count('select 1 from wallets where user_id = $1', [winner.id])).toBe(1);
      expect(
        await count(`select 1 from ledger_transactions where posting_key = $1`, [`test_deposit:${winner.id}`]),
      ).toBe(1);
    });

    it('refuses a non lowercase email inserted with raw SQL (users_email_lowercase)', async () => {
      const insert = api.pool.query(`insert into users (email, password_hash) values ($1, repeat('x', 60))`, [
        'Upper@Example.com',
      ]);

      await expect(insert).rejects.toMatchObject({ code: '23514', constraint: 'users_email_lowercase' });
    });
  });

  describe('credentials (AC-6)', () => {
    it('answers a wrong password and an unknown email with byte identical 401 bodies', async () => {
      const email = uniqueEmail();
      await signUp(api, email);

      const wrong = await postTo(api, '/v1/auth/login', { email, password: 'not the right password' });
      const unknown = await postTo(api, '/v1/auth/login', { email: uniqueEmail(), password: PASSWORD });

      expect([wrong.status, unknown.status]).toEqual([401, 401]);
      const [wrongBody, unknownBody] = [await wrong.text(), await unknown.text()];
      expect(wrongBody).toBe(unknownBody);
      expect(JSON.parse(wrongBody)).toEqual({
        type: 'about:blank',
        title: 'Invalid email or password',
        status: 401,
        code: 'invalid_credentials',
        instance: '/v1/auth/login',
      });
      expect(wrong.headers.getSetCookie()).toEqual([]);
    });

    it('answers a short wrong password with 401, not 422', async () => {
      const email = uniqueEmail();
      await signUp(api, email);

      const res = await postTo(api, '/v1/auth/login', { email, password: 'x' });

      expect(res.status).toBe(401);
    });

    it('logs in with the email in another case', async () => {
      const email = uniqueEmail();
      await signUp(api, email);

      const res = await postTo(api, '/v1/auth/login', { email: ` ${email.toUpperCase()}`, password: PASSWORD });

      expect(res.status).toBe(200);
    });

    it('rejects a malformed log in body with 422', async () => {
      const res = await postTo(api, '/v1/auth/login', { email: 'nope' });

      expect(res.status).toBe(422);
    });
  });
});
