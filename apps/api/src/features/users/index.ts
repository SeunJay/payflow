import type { Router } from 'express';
import type { FeatureDeps } from '../../deps.ts';
import { requireAuth } from '../../http/middleware/require-auth.ts';
import { createUsersController } from './users.controller.ts';
import { usersRoutes } from './users.routes.ts';
import { createUsersService } from './users.service.ts';

/** `GET /v1/me`: the caller's own user (spec 0004). */
export function usersFeature(deps: FeatureDeps): Router {
  const service = createUsersService(deps);
  return usersRoutes(createUsersController({ service }), requireAuth(deps.auth));
}
