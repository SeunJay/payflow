import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AppError } from '@payflow/shared';
import { accountIdSchema, pageSchema, parse, postInputSchema, reverseInputSchema } from './input.ts';

const validPost = () => ({
  postingKey: 'test_deposit:1',
  kind: 'test_deposit',
  description: 'Test deposit',
  entries: [
    { accountId: randomUUID(), amount: 10n },
    { accountId: randomUUID(), amount: -10n },
  ],
});

describe('parse', () => {
  it('returns the parsed output when the input is valid', () => {
    const id = randomUUID();

    expect(parse(accountIdSchema, id)).toBe(id);
  });

  it('throws a plain Error prefixed "ledger: invalid input" that names the failing path (AC-2)', () => {
    const err: unknown = (() => {
      try {
        parse(postInputSchema, { ...validPost(), postingKey: '' });
        return undefined;
      } catch (e) {
        return e;
      }
    })();

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AppError);
    expect((err as Error).message).toMatch(/^ledger: invalid input\n/);
    expect((err as Error).message).toContain('postingKey');
    expect((err as Error).cause).toBeDefined();
  });
});

describe('postInputSchema', () => {
  it('trims the posting key and description', () => {
    const parsed = parse(postInputSchema, { ...validPost(), postingKey: '  key:1  ', description: '\tDeposit \n' });

    expect(parsed.postingKey).toBe('key:1');
    expect(parsed.description).toBe('Deposit');
  });

  it('lower cases account ids so they compare equal to what Postgres returns', () => {
    const id = randomUUID();
    const input = validPost();

    const parsed = parse(postInputSchema, {
      ...input,
      entries: [{ accountId: id.toUpperCase(), amount: 10n }, input.entries[1]],
    });

    expect(parsed.entries[0]?.accountId).toBe(id);
  });

  it('accepts the boundary sizes: a 200 character key, a 500 character description, 2 and 50 entries', () => {
    const entries = Array.from({ length: 50 }, (_, i) => ({ accountId: randomUUID(), amount: i === 0 ? -49n : 1n }));

    expect(() =>
      parse(postInputSchema, { ...validPost(), postingKey: 'k'.repeat(200), description: 'd'.repeat(500) }),
    ).not.toThrow();
    expect(() => parse(postInputSchema, { ...validPost(), entries })).not.toThrow();
  });

  it('counts the trimmed length, so a key that is only whitespace is rejected', () => {
    expect(() => parse(postInputSchema, { ...validPost(), postingKey: ' '.repeat(5) })).toThrow(/postingKey/);
  });

  it('keeps JSON safe metadata as given, including nested arrays and null', () => {
    const metadata = { source: 'test', nested: { flags: [true, null, 3] } };

    expect(parse(postInputSchema, { ...validPost(), metadata }).metadata).toEqual(metadata);
  });

  it('leaves metadata undefined when it is omitted', () => {
    expect(parse(postInputSchema, validPost()).metadata).toBeUndefined();
  });

  it.each([
    ['NaN in metadata', { rate: Number.NaN }],
    ['undefined in metadata', { note: undefined }],
    ['a Date in metadata', { at: new Date() }],
  ])('rejects %s (AC-2)', (_name, metadata) => {
    expect(() => parse(postInputSchema, { ...validPost(), metadata })).toThrow(/^ledger: invalid input/);
  });

  it('rejects a negative zero bigint the same as zero', () => {
    const input = validPost();

    expect(() =>
      parse(postInputSchema, {
        ...input,
        entries: [{ accountId: input.entries[0]?.accountId, amount: -0n }, input.entries[1]],
      }),
    ).toThrow(/amount must not be zero/);
  });

  it('drops a currency an input entry tries to carry', () => {
    // Entry currency always comes from the locked account row (spec 0003, value sourcing).
    const input = validPost();

    const parsed = parse(postInputSchema, {
      ...input,
      entries: input.entries.map((entry) => ({ ...entry, currency: 'USD' })),
    });

    expect(parsed.entries[0]).not.toHaveProperty('currency');
  });
});

describe('reverseInputSchema', () => {
  it('trims the key and description and lower cases the transaction id', () => {
    const id = randomUUID();

    expect(
      parse(reverseInputSchema, { transactionId: id.toUpperCase(), postingKey: ' r:1 ', description: ' Undo ' }),
    ).toEqual({ transactionId: id, postingKey: 'r:1', description: 'Undo' });
  });

  it.each([
    ['a non uuid transaction id', { transactionId: 'nope', postingKey: 'r', description: 'd' }],
    ['a blank posting key', { transactionId: randomUUID(), postingKey: ' ', description: 'd' }],
    ['a blank description', { transactionId: randomUUID(), postingKey: 'r', description: '' }],
  ])('rejects %s (AC-2)', (_name, input) => {
    expect(() => parse(reverseInputSchema, input)).toThrow(/^ledger: invalid input/);
  });
});

describe('pageSchema', () => {
  it('defaults the limit to 50 and leaves the cursor undefined', () => {
    expect(parse(pageSchema, {})).toEqual({ limit: 50 });
  });

  it('turns a decimal cursor into a bigint seq', () => {
    expect(parse(pageSchema, { cursor: '51', limit: 10 })).toEqual({ cursor: 51n, limit: 10 });
  });

  it('accepts the largest 19 digit cursor and limits 1 and 100', () => {
    expect(parse(pageSchema, { cursor: '9223372036854775807' }).cursor).toBe(9_223_372_036_854_775_807n);
    expect(parse(pageSchema, { limit: 1 }).limit).toBe(1);
    expect(parse(pageSchema, { limit: 100 }).limit).toBe(100);
  });

  it.each([
    ['a zero cursor', { cursor: '0' }],
    ['a leading zero cursor', { cursor: '051' }],
    ['a negative cursor', { cursor: '-1' }],
    ['a 20 digit cursor', { cursor: '1'.repeat(20) }],
    ['a non numeric cursor', { cursor: 'abc' }],
    ['limit 0', { limit: 0 }],
    ['limit 101', { limit: 101 }],
    ['a fractional limit', { limit: 1.5 }],
  ])('rejects %s (AC-9)', (_name, page) => {
    expect(() => parse(pageSchema, page)).toThrow(/^ledger: invalid input/);
  });
});
