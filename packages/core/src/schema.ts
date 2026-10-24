// Every module's tables, combined for the typed Drizzle client.
import * as identity from './modules/identity/schema.ts';
import * as wallets from './modules/wallets/schema.ts';
import * as ledger from './modules/ledger/schema.ts';
import * as payments from './modules/payments/schema.ts';
import * as idempotency from './modules/idempotency/schema.ts';
import * as provider from './modules/provider/schema.ts';
import * as outbox from './modules/outbox/schema.ts';
import * as reconciliation from './modules/reconciliation/schema.ts';

export const schema = {
  ...identity,
  ...wallets,
  ...ledger,
  ...payments,
  ...idempotency,
  ...provider,
  ...outbox,
  ...reconciliation,
};
