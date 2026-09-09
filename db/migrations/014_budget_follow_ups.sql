BEGIN;

ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS last_follow_up_at timestamptz;
ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS next_follow_up_at timestamptz;
ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS follow_up_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS app_live.budget_follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES app_live.companies(id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL REFERENCES app_live.work_orders(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES app_live.app_users(id) ON DELETE SET NULL,
  contacted_at timestamptz NOT NULL DEFAULT now(),
  channel text NOT NULL,
  outcome text NOT NULL,
  notes text,
  next_follow_up_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_follow_ups_order ON app_live.budget_follow_ups(company_id,work_order_id,contacted_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_orders_next_follow_up ON app_live.work_orders(company_id,next_follow_up_at) WHERE status='ORCAMENTO';

COMMIT;
