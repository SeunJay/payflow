import type { RequestHandler } from 'express';
import { authOf } from '../../http/middleware/require-auth.ts';
import { userBody } from './users.schemas.ts';
import type { UsersService } from './users.service.ts';

/** The HTTP side of the caller's own user, from the access token's `sub`. */
export function createUsersController({ service }: { service: UsersService }) {
  const getMe: RequestHandler = async (_req, res) => {
    res.json(userBody(await service.getMe(authOf(res).userId)));
  };

  return { getMe } as const;
}

/** The user handlers `createUsersController` builds. */
export type UsersController = ReturnType<typeof createUsersController>;
