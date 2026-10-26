// Request body schemas for sign up and log in. A failure is the client's, so
// it becomes 422 `validation_failed`.
import { z } from 'zod';
import { validationFailed } from '@payflow/shared';

const utf8Bytes = (value: string) => Buffer.byteLength(value, 'utf8');

// Trim and lowercase first, then check the shape of what will be stored.
const email = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const signUpSchema = z.object({
  email,
  password: z
    .string()
    .refine((value) => utf8Bytes(value) >= 12 && utf8Bytes(value) <= 72, 'password must be 12 to 72 UTF-8 bytes'),
});

// Only a shape check, so a short wrong password is 401 like any other wrong password.
export const loginSchema = z.object({
  email,
  password: z
    .string()
    .refine((value) => utf8Bytes(value) >= 1 && utf8Bytes(value) <= 72, 'password must be 1 to 72 UTF-8 bytes'),
});

/** Parses a client body or throws 422 `validation_failed`. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw validationFailed(result.error);
  return result.data;
}
