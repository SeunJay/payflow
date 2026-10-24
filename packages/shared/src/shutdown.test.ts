import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './logger.ts';
import { onShutdown, type ShutdownStep } from './shutdown.ts';

type Handler = (signal: NodeJS.Signals) => Promise<void>;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('onShutdown', () => {
  const handlers = new Map<string, Handler>();
  let exit: ReturnType<typeof vi.spyOn>;
  const logger = createLogger({ name: 'test', level: 'silent' });

  beforeEach(() => {
    handlers.clear();
    // Capture the signal handlers instead of attaching them to the real process.
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: Handler) => {
      handlers.set(event, handler);
      return process;
    }) as typeof process.on);
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as typeof process.exit);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const signal = (name: NodeJS.Signals) => handlers.get(name)!(name);

  it('listens for both SIGTERM and SIGINT', () => {
    onShutdown(logger, []);

    expect([...handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM']);
  });

  it('closes every step in registration order, then exits 0 (DW-3)', async () => {
    const order: string[] = [];
    const step = (name: string): ShutdownStep => ({
      name,
      close: () => {
        order.push(name);
        return Promise.resolve();
      },
    });
    onShutdown(logger, [step('http'), step('postgres'), step('valkey')]);

    await signal('SIGTERM');

    expect(order).toEqual(['http', 'postgres', 'valkey']);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('waits for each step before starting the next', async () => {
    const first = deferred();
    const secondStarted = vi.fn();
    onShutdown(logger, [
      { name: 'first', close: () => first.promise },
      {
        name: 'second',
        close: () => {
          secondStarted();
          return Promise.resolve();
        },
      },
    ]);

    const done = signal('SIGINT');
    await Promise.resolve();
    expect(secondStarted).not.toHaveBeenCalled();

    first.resolve();
    await done;
    expect(secondStarted).toHaveBeenCalledOnce();
  });

  it('keeps closing later steps when one fails, then exits 1', async () => {
    const valkeyClosed = vi.fn();
    onShutdown(logger, [
      { name: 'postgres', close: async () => Promise.reject(new Error('already closed')) },
      {
        name: 'valkey',
        close: () => {
          valkeyClosed();
          return Promise.resolve();
        },
      },
    ]);

    await signal('SIGTERM');

    expect(valkeyClosed).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('logs the failed step by name', async () => {
    const error = vi.spyOn(logger, 'error');
    onShutdown(logger, [{ name: 'postgres', close: async () => Promise.reject(new Error('boom')) }]);

    await signal('SIGTERM');

    expect(error).toHaveBeenCalledWith(expect.objectContaining({ step: 'postgres' }), 'shutdown step failed');
  });

  it('forces exit 1 on a second signal while still shutting down', async () => {
    const stuck = deferred();
    onShutdown(logger, [{ name: 'http', close: () => stuck.promise }]);

    const first = signal('SIGTERM');
    void signal('SIGINT');

    expect(exit).toHaveBeenCalledWith(1);

    stuck.resolve();
    await first;
  });

  it('forces exit 1 when the steps outlast the timeout', () => {
    vi.useFakeTimers();
    const stuck = deferred();
    onShutdown(logger, [{ name: 'http', close: () => stuck.promise }], 500);

    void signal('SIGTERM');
    vi.advanceTimersByTime(499);
    expect(exit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledWith(1);

    stuck.resolve();
  });
});
