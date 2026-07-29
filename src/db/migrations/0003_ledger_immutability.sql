-- ledger_entries is append-only. Corrections are new rows, never edits.
COMMENT ON TABLE "ledger_entries" IS 'Append-only ledger. Never UPDATE or DELETE a row — corrections are new rows. Balance is derived via member_balance(uuid); no balance column is ever stored.';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ledger_entries_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only: % is not permitted, insert a correcting row instead', TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_update_or_delete
BEFORE UPDATE OR DELETE ON "ledger_entries"
FOR EACH ROW
EXECUTE FUNCTION ledger_entries_immutable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION member_balance(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END), 0)
       - COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END), 0)
  FROM "ledger_entries"
  WHERE user_id = p_user_id;
$$;
