import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@payflow/shared';
import { startRelayLoop } from './relay.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('startRelayLoop', () => {
  const logger = createLogger({ name: 'test', level: 'silent' });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ticks once per interval while running', async () => {
    const tick = vi.fn(async () => {});
    const relay = startRelayLoop({ logger, intervalMs: 100, tick });

    await vi.advanceTimersByTimeAsync(99);
    expect(tick).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200);
    expect(tick).toHaveBeenCalledTimes(3);

    await relay.stop();
  });

  it('defaults to a one second interval', async () => {
    const tick = vi.fn(async () => {});
    const relay = startRelayLoop({ logger, tick });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(tick).toHaveBeenCalledTimes(1);
    await relay.stop();
  });

  it('never starts a tick while the previous one is still running', async () => {
    const slow = deferred();
    const tick = vi.fn(() => slow.promise);
    const relay = startRelayLoop({ logger, intervalMs: 100, tick });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(tick).toHaveBeenCalledTimes(1);

    slow.resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(tick).toHaveBeenCalledTimes(2);

    await relay.stop();
  });

  it('logs a failed tick and keeps looping', async () => {
    const error = vi.spyOn(logger, 'error');
    const tick = vi.fn().mockRejectedValueOnce(new Error('outbox claim failed')).mockResolvedValue(undefined);
    const relay = startRelayLoop({ logger, intervalMs: 100, tick });

    await vi.advanceTimersByTimeAsync(200);

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.objectContaining({ message: 'outbox claim failed' }) as unknown }),
      'relay tick failed',
    );
    expect(tick).toHaveBeenCalledTimes(2);
    expect(relay.isRunning()).toBe(true);

    await relay.stop();
  });

  it('reports running until stopped', async () => {
    const relay = startRelayLoop({ logger, intervalMs: 100 });

    expect(relay.isRunning()).toBe(true);
    await relay.stop();

    expect(relay.isRunning()).toBe(false);
  });

  it('stop waits for the in flight tick to finish (DW-3)', async () => {
    const slow = deferred();
    const relay = startRelayLoop({ logger, intervalMs: 100, tick: () => slow.promise });
    await vi.advanceTimersByTimeAsync(100);

    let stopped = false;
    const stopping = relay.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    slow.resolve();
    await stopping;
    expect(stopped).toBe(true);
  });

  it('runs no more ticks after stop, whether stopped mid tick or between ticks', async () => {
    const slow = deferred();
    const tick = vi.fn(() => slow.promise);
    const relay = startRelayLoop({ logger, intervalMs: 100, tick });
    await vi.advanceTimersByTimeAsync(100);

    const stopping = relay.stop();
    slow.resolve();
    await stopping;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('stopping before the first tick means no tick ever runs', async () => {
    const tick = vi.fn(async () => {});
    const relay = startRelayLoop({ logger, intervalMs: 100, tick });

    await relay.stop();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(tick).not.toHaveBeenCalled();
  });
});
