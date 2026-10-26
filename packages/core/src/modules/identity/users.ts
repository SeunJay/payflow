import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { Db } from '../../infra/db.ts';
import type { Tx } from '../../infra/tx.ts';
import type { AuthContext } from './auth-context.ts';
import { emailTaken, invalidCredentials } from './errors.ts';
import { loginSchema, parseBody, signUpSchema } from './input.ts';
import { users } from './schema.ts';

export type User = { readonly id: string; readonly email: string; readonly createdAt: Date };

export type PreparedSignUp = { readonly email: string; readonly passwordHash: string };

const userColumns = { id: users.id, email: users.email, createdAt: users.createdAt };

// Hashing happens here, before the caller opens its unit of work, so no connection waits on bcrypt.
export async function prepareSignUp(auth: AuthContext, body: unknown): Promise<PreparedSignUp> {
  const { email, password } = parseBody(signUpSchema, body);
  return { email, passwordHash: await bcrypt.hash(password, auth.bcryptCost) };
}

export async function registerUser(tx: Tx, prepared: PreparedSignUp): Promise<User> {
  // A concurrent insert of the same email waits on the unique index, then returns no row.
  const [user] = await tx
    .insert(users)
    .values({ email: prepared.email, passwordHash: prepared.passwordHash })
    .onConflictDoNothing({ target: users.email })
    .returning(userColumns);
  if (!user) throw emailTaken();
  return user;
}

export async function verifyCredentials(db: Db | Tx, auth: AuthContext, body: unknown): Promise<User> {
  const { email, password } = parseBody(loginSchema, body);
  const [row] = await db
    .select({ ...userColumns, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email));
  // Always one compare, so an unknown email costs the same as a wrong password.
  const matches = await bcrypt.compare(password, row?.passwordHash ?? auth.dummyHash);
  if (!row || !matches) throw invalidCredentials();
  return { id: row.id, email: row.email, createdAt: row.createdAt };
}

export async function getUser(db: Db | Tx, userId: string): Promise<User | null> {
  const [user] = await db.select(userColumns).from(users).where(eq(users.id, userId));
  return user ?? null;
}
