import {
  createSession,
  endSession,
  openWallet,
  prepareSignUp,
  refreshSession,
  registerUser,
  verifyCredentials,
  withTx,
} from '@payflow/core';
import type { FeatureDeps } from '../../deps.ts';

/** The one core error the auth controller throws, handed over here so controllers never import core values. */
export { invalidRefresh } from '@payflow/core';

/** Auth use cases: each opens its own unit of work and composes core calls. */
export function createAuthService({ db, auth }: Pick<FeatureDeps, 'db' | 'auth'>) {
  return {
    signUp: async (body: unknown) => {
      // The hash is computed before the unit of work opens.
      const prepared = await prepareSignUp(auth, body);
      return withTx(db, async (tx) => {
        const user = await registerUser(tx, prepared);
        return { user, wallet: await openWallet(tx, user.id) };
      });
    },
    logIn: async (body: unknown) => {
      const user = await verifyCredentials(db, auth, body);
      return withTx(db, (tx) => createSession(tx, auth, user.id));
    },
    // Returns instead of throwing: a reuse revoke must commit even though the answer is 401.
    refresh: (refreshToken: string | undefined) => withTx(db, (tx) => refreshSession(tx, auth, refreshToken)),
    logOut: (refreshToken: string | undefined) => withTx(db, (tx) => endSession(tx, refreshToken)),
  } as const;
}

/** The auth use cases `createAuthService` builds. */
export type AuthService = ReturnType<typeof createAuthService>;
