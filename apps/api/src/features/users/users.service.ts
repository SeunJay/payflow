import { getUser, unauthenticated } from '@payflow/core';
import type { FeatureDeps } from '../../deps.ts';

/** User use cases for the signed in caller. */
export function createUsersService({ db }: Pick<FeatureDeps, 'db'>) {
  return {
    // A valid token for a user that is gone (a local reset) is 401, not 500.
    getMe: async (userId: string) => {
      const user = await getUser(db, userId);
      if (!user) throw unauthenticated();
      return user;
    },
  } as const;
}

/** The user use cases `createUsersService` builds. */
export type UsersService = ReturnType<typeof createUsersService>;
