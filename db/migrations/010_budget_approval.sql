BEGIN;

ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS approved_by_customer text;
ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS approval_method text;
ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS approval_notes text;

COMMIT;
