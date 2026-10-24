import { Router } from 'express';

export type ReadinessCheck = { name: string; check: () => Promise<void> };

/**
 * /health: liveness, 200 while the process runs.
 * /ready: readiness, 200 only when every check passes, else 503 naming the failures.
 */
export function healthRouter(checks: ReadinessCheck[], timeoutMs = 2_000): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/ready', async (_req, res) => {
    const results = await Promise.all(
      checks.map(async ({ name, check }) => {
        try {
          await withTimeout(check(), timeoutMs);
          return { name, ok: true };
        } catch (err) {
          return { name, ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    const ready = results.every((r) => r.ok);
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks: results });
  });

  return router;
}

function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
