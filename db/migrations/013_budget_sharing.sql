BEGIN;

ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS last_shared_at timestamptz;
ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS share_count integer NOT NULL DEFAULT 0;

COMMIT;
