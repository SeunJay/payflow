import { describe, expect, it } from 'vitest';
import { ACCOUNT_TYPES, normalSign } from './types.ts';

describe('normalSign', () => {
  it.each([
    ['asset', 1n],
    ['expense', 1n],
    ['liability', -1n],
    ['equity', -1n],
    ['revenue', -1n],
  ] as const)('gives %s accounts a sign of %s', (type, sign) => {
    expect(normalSign(type)).toBe(sign);
  });

  it('has a case for every account type', () => {
    expect([...ACCOUNT_TYPES].sort()).toEqual(['asset', 'equity', 'expense', 'liability', 'revenue']);
  });
});
