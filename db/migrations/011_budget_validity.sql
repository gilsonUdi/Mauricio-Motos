BEGIN;

ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS valid_until date;
UPDATE app_live.work_orders
SET valid_until=COALESCE(budget_date,CURRENT_DATE)+7
WHERE valid_until IS NULL AND status='ORCAMENTO';

COMMIT;
