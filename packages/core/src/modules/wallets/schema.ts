// Tables owned by the wallets module (spec 0004). The other modules' schemas
// are imported only to declare foreign keys.
import { sql } from 'drizzle-orm';
import { pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from '../identity/schema.ts';
import { ledgerAccounts } from '../ledger/schema.ts';

export const wallets = pgTable('wallets', {
  id: uuid()
    .primaryKey()
    .default(sql`uuidv7()`),
  userId: uuid()
    .notNull()
    .unique('wallets_user_id_unique')
    .references(() => users.id, { onDelete: 'restrict' }),
  ledgerAccountId: uuid()
    .notNull()
    .unique('wallets_ledger_account_id_unique')
    .references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
  createdAt: timestamp({ withTimezone: true })
    .notNull()
    .default(sql`clock_timestamp()`),
});
