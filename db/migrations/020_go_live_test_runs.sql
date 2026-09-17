BEGIN;

CREATE TABLE IF NOT EXISTS app_live.go_live_test_runs (
  company_id uuid NOT NULL REFERENCES app_live.companies(id) ON DELETE CASCADE,
  scenario_key text NOT NULL,
  status text NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','APROVADO','REPROVADO','BLOQUEADO')),
  notes text,
  tested_by uuid REFERENCES app_live.app_users(id) ON DELETE SET NULL,
  tested_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,scenario_key)
);

CREATE INDEX IF NOT EXISTS idx_go_live_test_runs_company
  ON app_live.go_live_test_runs(company_id,updated_at DESC);

COMMIT;
