BEGIN;

CREATE TABLE IF NOT EXISTS app_live.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_live.companies(id,name,slug)
VALUES ('0b1655eb-0bd6-8e64-e592-6d1ae009de41','Maurício Motos','mauricio-motos')
ON CONFLICT DO NOTHING;

ALTER TABLE app_live.app_users ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES app_live.companies(id) ON DELETE CASCADE;
ALTER TABLE app_live.app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE app_live.app_users ADD CONSTRAINT app_users_role_check CHECK (role IN ('SUPER_ADMIN','ADMIN','OPERADOR','FINANCEIRO','ESTOQUE'));
UPDATE app_live.app_users SET company_id='0b1655eb-0bd6-8e64-e592-6d1ae009de41' WHERE company_id IS NULL AND role<>'SUPER_ADMIN';

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['customers','vehicles','products','mechanics','work_orders','receivables','inventory_movements','financial_transactions'] LOOP
    EXECUTE format('ALTER TABLE app_live.%I ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES app_live.companies(id)', table_name);
    EXECUTE format('UPDATE app_live.%I SET company_id = %L::uuid WHERE company_id IS NULL', table_name, '0b1655eb-0bd6-8e64-e592-6d1ae009de41');
    EXECUTE format('ALTER TABLE app_live.%I ALTER COLUMN company_id SET NOT NULL', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON app_live.%I(company_id)', 'idx_' || table_name || '_company', table_name);
  END LOOP;
END $$;

COMMIT;
