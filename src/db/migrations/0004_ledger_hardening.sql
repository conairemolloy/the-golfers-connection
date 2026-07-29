-- Direction carries the sign; a negative amount would let a credit
-- act as a debit without violating append-only.
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_amount_positive_check" CHECK ("amount" > 0);
--> statement-breakpoint
-- Row-level triggers do not fire on TRUNCATE, so ledger_entries_no_update_or_delete
-- leaves a hole. Same exception style as ledger_entries_immutable.
CREATE OR REPLACE FUNCTION ledger_entries_no_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only: TRUNCATE is not permitted, insert a correcting row instead';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_truncate
BEFORE TRUNCATE ON "ledger_entries"
FOR EACH STATEMENT
EXECUTE FUNCTION ledger_entries_no_truncate();
--> statement-breakpoint
-- Pin search_path so the function can't be hijacked by an object placed
-- earlier on a caller's search_path. STABLE, and still SECURITY INVOKER:
-- M2 must decide whether this becomes SECURITY DEFINER once RLS is on
-- ledger_entries, since under RLS an invoker-rights function only sums
-- rows the caller can see.
CREATE OR REPLACE FUNCTION member_balance(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END), 0)
       - COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END), 0)
  FROM "ledger_entries"
  WHERE user_id = p_user_id;
$$;
--> statement-breakpoint
-- A cancelled round is terminal — reversal is a compensating entry in the
-- opposite direction, and re-confirmation creates a new round rather than
-- a second entry in the same direction.
COMMENT ON CONSTRAINT "ledger_entries_round_user_direction_unique" ON "ledger_entries" IS 'A cancelled round is terminal: reversal is a compensating entry in the opposite direction, and re-confirmation creates a new round rather than a second entry in the same direction.';
