CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text,
	"type" text NOT NULL,
	"currency" text NOT NULL,
	"allow_negative" boolean DEFAULT false NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "ledger_accounts_code_unique" UNIQUE("code"),
	CONSTRAINT "ledger_accounts_id_currency_unique" UNIQUE("id","currency"),
	CONSTRAINT "ledger_accounts_type_check" CHECK (type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
	CONSTRAINT "ledger_accounts_currency_check" CHECK (currency = 'NGN'),
	CONSTRAINT "ledger_accounts_balance_check" CHECK (allow_negative or balance >= 0),
	CONSTRAINT "ledger_accounts_allow_negative_check" CHECK (not allow_negative or code is not null)
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"seq" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	CONSTRAINT "ledger_entries_account_seq_unique" UNIQUE("account_id","seq"),
	CONSTRAINT "ledger_entries_transaction_account_unique" UNIQUE("transaction_id","account_id"),
	CONSTRAINT "ledger_entries_amount_check" CHECK (amount <> 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"posting_key" text NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reverses_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "ledger_transactions_posting_key_unique" UNIQUE("posting_key"),
	CONSTRAINT "ledger_transactions_reverses_transaction_id_unique" UNIQUE("reverses_transaction_id"),
	CONSTRAINT "ledger_transactions_posting_key_check" CHECK (length(posting_key) between 1 and 200),
	CONSTRAINT "ledger_transactions_kind_check" CHECK (kind in ('test_deposit', 'reversal')),
	CONSTRAINT "ledger_transactions_description_check" CHECK (length(description) between 1 and 500),
	CONSTRAINT "ledger_transactions_reversal_check" CHECK ((kind = 'reversal') = (reverses_transaction_id is not null))
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_currency_fk" FOREIGN KEY ("account_id","currency") REFERENCES "public"."ledger_accounts"("id","currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_reverses_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("reverses_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE restrict ON UPDATE no action;