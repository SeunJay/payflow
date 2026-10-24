import { createServer, type Server } from 'node:http';

export type ReadinessCheck = { name: string; check: () => Promise<void> };

/** /health is liveness; /ready is 200 only when every check passes, else 503. */
export function startHealthServer(port: number, checks: ReadinessCheck[], timeoutMs = 2_000): Server {
  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    };

    if (req.method !== 'GET') return send(405, { status: 'method_not_allowed' });
    if (req.url === '/health') return send(200, { status: 'ok' });
    if (req.url !== '/ready') return send(404, { status: 'not_found' });

    const results = await Promise.all(
      checks.map(async ({ name, check }) => {
        try {
          await Promise.race([
            check(),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs).unref()),
          ]);
          return { name, ok: true };
        } catch (err) {
          return { name, ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    const ready = results.every((r) => r.ok);
    send(ready ? 200 : 503, { status: ready ? 'ready' : 'not_ready', checks: results });
  });
  return server.listen(port);
}
