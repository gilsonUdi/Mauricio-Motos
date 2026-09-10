BEGIN;

ALTER TABLE app_live.audit_log
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES app_live.companies(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_audit_log_company_created
  ON app_live.audit_log(company_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_company_actor
  ON app_live.audit_log(company_id,actor_id,created_at DESC);

COMMIT;
