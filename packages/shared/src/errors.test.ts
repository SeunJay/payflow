import { describe, expect, it } from 'vitest';
import { AppError } from './errors.ts';

describe('AppError', () => {
  it('carries the code, status, title, and detail clients rely on', () => {
    const err = new AppError({ code: 'wallet_not_found', status: 404, title: 'Not Found', detail: 'No wallet w_1' });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.name).toBe('AppError');
    expect(err.code).toBe('wallet_not_found');
    expect(err.status).toBe(404);
    expect(err.message).toBe('Not Found');
    expect(err.detail).toBe('No wallet w_1');
  });

  it('leaves detail undefined when none is given', () => {
    const err = new AppError({ code: 'conflict', status: 409, title: 'Conflict' });

    expect(err.detail).toBeUndefined();
  });

  it('keeps the underlying cause for logs', () => {
    const cause = new Error('connection reset');

    const err = new AppError({ code: 'upstream_failed', status: 502, title: 'Bad Gateway', cause });

    expect(err.cause).toBe(cause);
  });
});
