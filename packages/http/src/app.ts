import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import { serializeErr, type Logger } from '@payflow/shared';
import { correlationIdOf, genReqId } from './ids.ts';
import { healthRouter, type ReadinessCheck } from './health.ts';
import { notFound, problemHandler } from './problem.ts';

/**
 * The shared Express shell for the API and the simulator: ids, request logs,
 * JSON bodies and health routes before `mount`, 404 and Problem Details after.
 */
export function createHttpApp(options: {
  logger: Logger;
  readiness: ReadinessCheck[];
  mount?: (app: Express) => void;
}): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger: options.logger,
      // pino-http installs its own err serializer on the request logger; this keeps the shared, query safe one.
      serializers: { err: serializeErr },
      genReqId,
      customProps: (_req, res) => ({ correlation_id: correlationIdOf(res) }),
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(healthRouter(options.readiness));

  options.mount?.(app);

  app.use(notFound);
  app.use(problemHandler);
  return app;
}
