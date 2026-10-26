import { describe, expect, it } from 'vitest';
import { AppError } from '@payflow/shared';
import { loginSchema, parseBody, signUpSchema } from './input.ts';

const password = 'correct horse battery';
// 64 + 1 + 63 + 1 + 63 + 1 + 61 = 254 characters, a valid address at the limit.
const email254 = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`;

const rejects = (schema: typeof signUpSchema | typeof loginSchema, body: unknown) => {
  try {
    parseBody(schema, body);
  } catch (err) {
    return err instanceof AppError ? `${String(err.status)} ${err.code}` : 'not an AppError';
  }
  return 'accepted';
};

describe('sign up body (AC-1, AC-3)', () => {
  it('trims and lowercases the email and keeps the password as sent', () => {
    expect(parseBody(signUpSchema, { email: '  MiXeD@Ex.COM ', password })).toEqual({
      email: 'mixed@ex.com',
      password,
    });
  });

  it('accepts a 254 character email, even with spaces around it', () => {
    expect(email254).toHaveLength(254);
    expect(parseBody(signUpSchema, { email: `  ${email254}  `, password }).email).toBe(email254);
  });

  it.each([
    ['a missing email', { password }],
    ['a missing password', { email: 'a@b.co' }],
    ['a non string email', { email: 42, password }],
    ['a non string password', { email: 'a@b.co', password: 123_456_789_012 }],
    ['an email that is not an address', { email: 'not-an-email', password }],
    ['a 255 character email', { email: `${email254}d`, password }],
    ['an 11 byte password', { email: 'a@b.co', password: 'a'.repeat(11) }],
    ['a 73 byte password', { email: 'a@b.co', password: `${'é'.repeat(36)}a` }],
    ['37 × é (74 bytes, 37 characters)', { email: 'a@b.co', password: 'é'.repeat(37) }],
    ['a body that is not an object', 'a@b.co'],
    ['null', null],
  ])('rejects %s with 422 validation_failed', (_name, body) => {
    expect(rejects(signUpSchema, body)).toBe('422 validation_failed');
  });

  it.each([
    ['12 ASCII bytes', 'a'.repeat(12)],
    ['72 ASCII bytes', 'a'.repeat(72)],
    ['36 × é (72 bytes)', 'é'.repeat(36)],
    ['6 × é (12 bytes, 6 characters)', 'é'.repeat(6)],
  ])('accepts a password of %s, counted in UTF-8 bytes', (_name, value) => {
    expect(rejects(signUpSchema, { email: 'a@b.co', password: value })).toBe('accepted');
  });
});

describe('log in body (AC-6)', () => {
  it('accepts a 1 byte password, so a short wrong password is a 401 later, not a 422', () => {
    expect(parseBody(loginSchema, { email: ' A@B.CO', password: 'x' })).toEqual({ email: 'a@b.co', password: 'x' });
  });

  it.each([
    ['an empty password', { email: 'a@b.co', password: '' }],
    ['a 73 byte password', { email: 'a@b.co', password: 'a'.repeat(73) }],
    ['a missing email', { password }],
  ])('rejects %s with 422 validation_failed', (_name, body) => {
    expect(rejects(loginSchema, body)).toBe('422 validation_failed');
  });
});
