BEGIN;

ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS source_work_order_id uuid REFERENCES app_live.work_orders(id) ON DELETE SET NULL;
ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS revision_number integer NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_work_orders_source ON app_live.work_orders(company_id,source_work_order_id);

COMMIT;
