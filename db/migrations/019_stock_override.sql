BEGIN;

ALTER TABLE app_live.work_orders
  ADD COLUMN IF NOT EXISTS stock_override_used boolean NOT NULL DEFAULT false;
ALTER TABLE app_live.work_orders
  ADD COLUMN IF NOT EXISTS stock_override_at timestamptz;
ALTER TABLE app_live.work_orders
  ADD COLUMN IF NOT EXISTS stock_override_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
