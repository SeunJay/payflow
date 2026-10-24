import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export type ReadinessCheck = { name: string; check: () => Promise<void> };

/** /health is liveness; /ready is 200 only when every check passes, else 503. */
export function startHealthServer(port: number, checks: ReadinessCheck[], timeoutMs = 2_000): Server {
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    };

    if (req.method !== 'GET') {
      send(405, { status: 'method_not_allowed' });
      return;
    }
    if (req.url === '/health') {
      send(200, { status: 'ok' });
      return;
    }
    if (req.url !== '/ready') {
      send(404, { status: 'not_found' });
      return;
    }

    const results = await Promise.all(
      checks.map(async ({ name, check }) => {
        try {
          await Promise.race([
            check(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs).unref(),
            ),
          ]);
          return { name, ok: true };
        } catch (err) {
          return { name, ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    const ready = results.every((r) => r.ok);
    send(ready ? 200 : 503, { status: ready ? 'ready' : 'not_ready', checks: results });
  };
  // Every check's failure is caught above, so the handler never rejects
  return createServer((req, res) => void handle(req, res)).listen(port);
}
