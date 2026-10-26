import type { AuthContext, Db } from '@payflow/core';

/** What the routers need, built once in `main.ts` (or by a test) and passed to `buildApp`. */
export type RouteDeps = {
  readonly db: Db;
  readonly auth: AuthContext;
  readonly cookieSecure: boolean;
};
