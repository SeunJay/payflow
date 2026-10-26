import type { Router } from 'express';
import type { FeatureDeps } from '../../deps.ts';
import { createAuthController } from './auth.controller.ts';
import { authRoutes } from './auth.routes.ts';
import { createAuthService } from './auth.service.ts';

/** `/v1/auth`: sign up, log in, refresh, log out (spec 0004). */
export function authFeature(deps: FeatureDeps): Router {
  const service = createAuthService(deps);
  return authRoutes(createAuthController({ service, cookieSecure: deps.cookieSecure }));
}
