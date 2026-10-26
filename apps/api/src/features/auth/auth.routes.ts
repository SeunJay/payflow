import { Router } from 'express';
import { requireJson } from '../../http/middleware/require-json.ts';
import type { AuthController } from './auth.controller.ts';

/** Paths under `/v1/auth`; every `POST` must be JSON. */
export function authRoutes(controller: AuthController): Router {
  const router = Router();
  router.use(requireJson);
  router.post('/signup', controller.signUp);
  router.post('/login', controller.logIn);
  router.post('/refresh', controller.refresh);
  router.post('/logout', controller.logOut);
  return router;
}
