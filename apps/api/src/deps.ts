import type { AuthContext, Db } from '@payflow/core';

/** What the features need, built once in `main.ts` (or by a test) and passed to `buildApp`. */
export type FeatureDeps = {
  readonly db: Db;
  readonly auth: AuthContext;
  readonly cookieSecure: boolean;
};
