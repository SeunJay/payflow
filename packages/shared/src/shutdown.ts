import type { Logger } from "./logger.ts";

export type ShutdownStep = { name: string; close: () => Promise<void> };

/**
 * Runs the steps in order on SIGTERM or SIGINT, then exits. Register steps
 * in shutdown order: stop accepting work first, close connections last.
 * A second signal, or the timeout, forces exit.
 */
export function onShutdown(
  logger: Logger,
  steps: ShutdownStep[],
  timeoutMs = 10_000,
): void {
  let shuttingDown = false;

  const run = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      logger.warn({ signal }, "second signal, forcing exit");
      process.exit(1);
    }
    shuttingDown = true;
    logger.info({ signal }, "shutting down");

    const timer = setTimeout(() => {
      logger.error({ timeoutMs }, "shutdown timed out, forcing exit");
      process.exit(1);
    }, timeoutMs);
    timer.unref();

    let failed = false;
    for (const step of steps) {
      try {
        await step.close();
        logger.debug({ step: step.name }, "closed");
      } catch (err) {
        failed = true;
        logger.error({ err, step: step.name }, "shutdown step failed");
      }
    }
    logger.info("shutdown complete");
    process.exit(failed ? 1 : 0);
  };

  process.on("SIGTERM", run);
  process.on("SIGINT", run);
}
