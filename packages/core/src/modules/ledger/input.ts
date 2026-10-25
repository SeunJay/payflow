// Input schemas for the ledger writers and readers. A failure is a programming
// bug in the caller, so it throws a plain Error (a 500), never an AppError.
import { z } from 'zod';
import { TRANSACTION_KINDS, type JsonObject } from './types.ts';

// Postgres returns uuids lower case; normalising here keeps id comparisons exact.
const id = z.uuid().transform((value) => value.toLowerCase());

const metadata = z.record(z.string(), z.json()).transform((value) => value as JsonObject);

export const postInputSchema = z.object({
  postingKey: z.string().trim().min(1).max(200),
  kind: z.enum(TRANSACTION_KINDS),
  description: z.string().trim().min(1).max(500),
  metadata: metadata.optional(),
  entries: z
    .array(
      z.object({
        accountId: id,
        amount: z.bigint().refine((amount) => amount !== 0n, 'amount must not be zero'),
      }),
    )
    .min(2)
    .max(50),
});

export const reverseInputSchema = z.object({
  transactionId: id,
  postingKey: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(500),
});

export const accountIdSchema = id;

export const pageSchema = z.object({
  cursor: z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/, 'cursor must be a positive decimal seq')
    .transform((value) => BigInt(value))
    .optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

/** Parses or throws a plain Error carrying the Zod issues. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new Error(`ledger: invalid input\n${z.prettifyError(result.error)}`, { cause: result.error });
  }
  return result.data;
}
