import type { Logger } from '@payflow/shared';

export type RelayLoop = { isRunning: () => boolean; stop: () => Promise<void> };

/**
 * The outbox relay loop: outbox table → BullMQ. Feature 11 fills `tick` with
 * the claim (FOR UPDATE SKIP LOCKED), publish, mark sent cycle. Ticks never
 * overlap, and `stop` waits for the current one to finish.
 */
export function startRelayLoop(options: {
  logger: Logger;
  intervalMs?: number;
  tick?: () => Promise<void>;
}): RelayLoop {
  const intervalMs = options.intervalMs ?? 1_000;
  const tick = options.tick ?? (() => Promise.resolve());
  let running = true;
  let current: Promise<void> = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;

  const schedule = () => {
    timer = setTimeout(() => {
      current = tick()
        .catch((err: unknown) => options.logger.error({ err }, 'relay tick failed'))
        .finally(() => {
          if (running) schedule();
        });
    }, intervalMs);
  };
  schedule();
  options.logger.info({ intervalMs }, 'relay loop started');

  return {
    isRunning: () => running,
    stop: async () => {
      running = false;
      clearTimeout(timer);
      await current;
      options.logger.info('relay loop stopped');
    },
  };
}
