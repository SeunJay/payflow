-- Database guards for the ledger (spec 0003, "Database guards"). Drizzle Kit does
-- not model triggers, so any later change to the ledger tables must keep these in
-- mind. Every guard raises P0001 with a message starting `ledger:`.

-- 1. Balance at commit: at least two entries, and entries sum to zero per currency.
CREATE FUNCTION ledger_check_transaction_balanced(txn_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  entry_count bigint;
  unbalanced_currency text;
BEGIN
  SELECT count(*) INTO entry_count FROM ledger_entries WHERE transaction_id = txn_id;
  IF entry_count < 2 THEN
    RAISE EXCEPTION 'ledger: transaction % has % entries, needs at least 2', txn_id, entry_count
      USING ERRCODE = 'P0001';
  END IF;

  SELECT currency INTO unbalanced_currency
    FROM ledger_entries
   WHERE transaction_id = txn_id
   GROUP BY currency
  HAVING sum(amount) <> 0
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'ledger: transaction % does not balance in %', txn_id, unbalanced_currency
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION ledger_transactions_check_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger_check_transaction_balanced(NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION ledger_entries_check_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger_check_transaction_balanced(NEW.transaction_id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
-- On transactions: catches a transaction saved with zero or one entry.
CREATE CONSTRAINT TRIGGER ledger_transactions_balanced
  AFTER INSERT ON ledger_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_transactions_check_balanced();
--> statement-breakpoint
-- On entries: catches entries that do not sum to zero.
CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_check_balanced();
--> statement-breakpoint

-- 2. Immutability: transactions and entries are append only.
CREATE FUNCTION ledger_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger: % on % is not allowed, ledger rows are append only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_transactions_immutable
  BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();
--> statement-breakpoint
CREATE TRIGGER ledger_transactions_no_truncate
  BEFORE TRUNCATE ON ledger_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_change();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_truncate
  BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_change();
--> statement-breakpoint

-- 3. Account guard: only `balance` and `last_seq` may change; no delete or truncate.
CREATE FUNCTION ledger_accounts_guard_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.code IS DISTINCT FROM OLD.code
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.allow_negative IS DISTINCT FROM OLD.allow_negative
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'ledger: only balance and last_seq of account % may change', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_accounts_guard_update
  BEFORE UPDATE ON ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION ledger_accounts_guard_update();
--> statement-breakpoint
CREATE TRIGGER ledger_accounts_no_delete
  BEFORE DELETE ON ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();
--> statement-breakpoint
CREATE TRIGGER ledger_accounts_no_truncate
  BEFORE TRUNCATE ON ledger_accounts
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_change();
--> statement-breakpoint

-- 4. No reversal of a reversal.
CREATE FUNCTION ledger_transactions_no_reversal_of_reversal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reverses_transaction_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM ledger_transactions WHERE id = NEW.reverses_transaction_id AND kind = 'reversal'
  ) THEN
    RAISE EXCEPTION 'ledger: transaction % is a reversal and cannot be reversed', NEW.reverses_transaction_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_transactions_no_reversal_of_reversal
  BEFORE INSERT ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_transactions_no_reversal_of_reversal();
