import { Router, type RequestHandler } from 'express';
import type { UsersController } from './users.controller.ts';

/** `GET /me` under `/v1`, behind the access token check. */
export function usersRoutes(controller: UsersController, requireAuth: RequestHandler): Router {
  const router = Router();
  router.get('/me', requireAuth, controller.getMe);
  return router;
}
