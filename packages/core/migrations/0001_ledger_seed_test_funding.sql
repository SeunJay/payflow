-- The system account that funds test deposits (spec 0003, AC-11). Equity, so it
-- goes negative as it hands out money; only system accounts may do that.
INSERT INTO "ledger_accounts" ("code", "type", "currency", "allow_negative")
VALUES ('test_funding', 'equity', 'NGN', true)
ON CONFLICT ("code") DO NOTHING;
