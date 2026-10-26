// Helpers shared by the API integration tests. Only *.int.test.ts files import this.
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { expect } from 'vitest';
import { createAuthContext, createDb, type AuthContext, type DbHandle } from '@payflow/core';
import { createLogger, type Logger } from '@payflow/shared';
import { createTestDatabase, startServer } from '@payflow/test-utils';
import { buildApp } from './app.ts';

export const TEST_JWT_SECRET = 'test-only-jwt-secret-0123456789abcdef';
export const PASSWORD = 'correct horse battery';

export type TestApi = {
  readonly url: string;
  /** The per file test database, for a second, independent connection. */
  readonly databaseUrl: string;
  readonly db: DbHandle['db'];
  readonly pool: DbHandle['pool'];
  readonly auth: AuthContext;
  readonly logger: Logger;
  /** Every line the app logged, as raw JSON text. */
  readonly logs: string[];
  readonly close: () => Promise<void>;
};

/** The real app on its own migrated database, served on a free port, with its logs captured. */
export async function startTestApi(): Promise<TestApi> {
  const database = await createTestDatabase();
  const logs: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs.push(chunk.toString());
      done();
    },
  });
  const logger = createLogger({ name: 'api-test', level: 'info', destination });
  const handle = createDb({ url: database.url, logger });
  const auth = await createAuthContext({
    jwtSecret: TEST_JWT_SECRET,
    accessTtlSeconds: 900,
    refreshTtlSeconds: 604_800,
    bcryptCost: 4,
  });
  const app = buildApp({ db: handle.db, logger, config: { COOKIE_SECURE: false }, auth, readiness: [] });
  const server = await startServer(app);
  return {
    url: server.url,
    databaseUrl: database.url,
    db: handle.db,
    pool: handle.pool,
    auth,
    logger,
    logs,
    close: async () => {
      await server.close();
      await handle.close();
      await database.drop();
    },
  };
}

// Asymmetric matchers are typed `any`; these keep the lint rules on `any` useful in the tests.
export const anyString = expect.any(String) as string;
export const anyDate = expect.any(Date) as Date;

export const uniqueEmail = (prefix = 'user') => `${prefix}-${randomUUID()}@example.com`;

type RequestOptions = { readonly cookie?: string; readonly contentType?: string | null; readonly raw?: string };

/** A POST with a JSON body (or `raw` text), `application/json` unless `contentType` says otherwise (null: none). */
export function postTo(api: TestApi, path: string, body?: unknown, options: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  const contentType = options.contentType === undefined ? 'application/json' : options.contentType;
  if (contentType !== null) headers['content-type'] = contentType;
  if (options.cookie) headers.cookie = options.cookie;
  const payload = options.raw ?? (body === undefined ? undefined : JSON.stringify(body));
  return fetch(`${api.url}${path}`, { method: 'POST', headers, ...(payload === undefined ? {} : { body: payload }) });
}

export function getFrom(api: TestApi, path: string, cookie?: string, headers: Record<string, string> = {}) {
  return fetch(`${api.url}${path}`, { headers: { ...headers, ...(cookie ? { cookie } : {}) } });
}

export type SetCookie = { readonly value: string; readonly attributes: string };

/** The response's Set-Cookie headers by cookie name. */
export function setCookies(res: Response): Record<string, SetCookie> {
  const out: Record<string, SetCookie> = {};
  for (const header of res.headers.getSetCookie()) {
    const [pair = '', ...rest] = header.split('; ');
    const eq = pair.indexOf('=');
    out[pair.slice(0, eq)] = { value: decodeURIComponent(pair.slice(eq + 1)), attributes: rest.join('; ') };
  }
  return out;
}

export type Session = {
  readonly userId: string;
  readonly email: string;
  readonly walletId: string;
  readonly access: string;
  readonly refresh: string;
};

export const accessCookie = (access: string) => `payflow_access=${access}`;
export const refreshCookie = (refresh: string) => `payflow_refresh=${refresh}`;

export async function signUp(api: TestApi, email = uniqueEmail()) {
  const res = await postTo(api, '/v1/auth/signup', { email, password: PASSWORD });
  if (res.status !== 201) throw new Error(`sign up failed: ${String(res.status)} ${await res.text()}`);
  return (await res.json()) as { user: { id: string; email: string }; wallet: { id: string } };
}

export async function logIn(api: TestApi, email: string) {
  const res = await postTo(api, '/v1/auth/login', { email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`log in failed: ${String(res.status)} ${await res.text()}`);
  const { payflow_access: access, payflow_refresh: refresh } = setCookies(res);
  if (!access || !refresh) throw new Error('log in set no session cookies');
  return { access: access.value, refresh: refresh.value };
}

/** A fresh user, signed up and logged in. */
export async function newSession(api: TestApi, email = uniqueEmail()): Promise<Session> {
  const signedUp = await signUp(api, email);
  const tokens = await logIn(api, email);
  return { userId: signedUp.user.id, email: signedUp.user.email, walletId: signedUp.wallet.id, ...tokens };
}

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Builds a JWT by hand, so tests can forge headers and claims the real signer never would. */
export function forgeJwt(
  payload: Record<string, unknown>,
  options: { secret?: string; alg?: 'HS256' | 'HS512' | 'none' } = {},
): string {
  const alg = options.alg ?? 'HS256';
  const head = `${b64url({ alg, typ: 'JWT' })}.${b64url(payload)}`;
  if (alg === 'none') return `${head}.`;
  const hmac = alg === 'HS256' ? 'sha256' : 'sha512';
  return `${head}.${createHmac(hmac, options.secret ?? TEST_JWT_SECRET)
    .update(head)
    .digest('base64url')}`;
}

/** The claims a real access token carries, valid for 15 minutes. */
export function claims(userId: string, sessionId: string = randomUUID(), overrides: Record<string, unknown> = {}) {
  const iat = Math.floor(Date.now() / 1000);
  return { sub: userId, sid: sessionId, iss: 'payflow-api', aud: 'payflow-api', iat, exp: iat + 900, ...overrides };
}

/** A refresh secret and its stored hash, for sessions inserted with raw SQL. */
export function refreshSecret() {
  const secret = randomBytes(32).toString('base64url');
  return { secret, hash: createHash('sha256').update(secret).digest('hex') };
}

/** Parsed JSON log lines. */
export const logLines = (api: TestApi) => api.logs.map((line) => JSON.parse(line) as Record<string, unknown>);
