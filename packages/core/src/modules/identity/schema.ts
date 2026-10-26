// Tables owned by the identity module (spec 0004).
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const REVOKED_REASONS = ['logout', 'reuse_detected'] as const;
export type RevokedReason = (typeof REVOKED_REASONS)[number];

export const users = pgTable(
  'users',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    email: text().notNull().unique('users_email_unique'),
    passwordHash: text().notNull(),
    createdAt: timestamp({ withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  () => [
    // The Zod normalisation is the friendly path; this is the guarantee.
    check('users_email_lowercase', sql`email = lower(email)`),
    check('users_email_length', sql`length(email) between 3 and 254`),
    check('users_password_hash_length', sql`length(password_hash) = 60`),
  ],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    currentTokenHash: text().notNull(),
    createdAt: timestamp({ withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    // Set once at insert; refresh never moves it (absolute expiry).
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    rotatedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    revokedReason: text({ enum: REVOKED_REASONS }),
  },
  (t) => [
    index('auth_sessions_user_id_idx').on(t.userId),
    check('auth_sessions_current_token_hash_check', sql`current_token_hash ~ '^[0-9a-f]{64}$'`),
    check('auth_sessions_revoked_reason_check', sql`revoked_reason in ('logout', 'reuse_detected')`),
    check('auth_sessions_revoked_pair', sql`(revoked_at is null) = (revoked_reason is null)`),
    check('auth_sessions_expiry_check', sql`expires_at > created_at`),
  ],
);
