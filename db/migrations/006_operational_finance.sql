BEGIN;

CREATE TABLE IF NOT EXISTS app_live.financial_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES app_live.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  account_type text NOT NULL DEFAULT 'BANCO' CHECK (account_type IN ('CAIXA','BANCO','CARTEIRA','OUTRA')),
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_accounts_company_name ON app_live.financial_accounts(company_id,lower(name));

CREATE TABLE IF NOT EXISTS app_live.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES app_live.companies(id) ON DELETE CASCADE,
  code text,
  name text NOT NULL,
  supports_installments boolean NOT NULL DEFAULT false,
  variable_fee boolean NOT NULL DEFAULT false,
  default_fee_percent numeric(8,4) NOT NULL DEFAULT 0 CHECK (default_fee_percent BETWEEN 0 AND 100),
  default_account_id uuid REFERENCES app_live.financial_accounts(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_methods_company_name ON app_live.payment_methods(company_id,lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_methods_company_code ON app_live.payment_methods(company_id,code) WHERE code IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_live.payment_fee_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_method_id uuid NOT NULL REFERENCES app_live.payment_methods(id) ON DELETE CASCADE,
  minimum_installments integer NOT NULL CHECK (minimum_installments > 0),
  maximum_installments integer CHECK (maximum_installments IS NULL OR maximum_installments >= minimum_installments),
  fee_percent numeric(8,4) NOT NULL DEFAULT 0 CHECK (fee_percent BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(payment_method_id,minimum_installments)
);

ALTER TABLE app_live.receivable_payments ADD COLUMN IF NOT EXISTS financial_account_id uuid REFERENCES app_live.financial_accounts(id) ON DELETE SET NULL;
ALTER TABLE app_live.receivable_payments ADD COLUMN IF NOT EXISTS payment_method_id uuid REFERENCES app_live.payment_methods(id) ON DELETE SET NULL;
ALTER TABLE app_live.receivable_payments ADD COLUMN IF NOT EXISTS gross_amount numeric(14,2);
ALTER TABLE app_live.receivable_payments ADD COLUMN IF NOT EXISTS fee_percent numeric(8,4) NOT NULL DEFAULT 0;
ALTER TABLE app_live.receivable_payments ADD COLUMN IF NOT EXISTS fee_amount numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE app_live.receivable_payments ADD COLUMN IF NOT EXISTS net_amount numeric(14,2);
UPDATE app_live.receivable_payments SET gross_amount=COALESCE(gross_amount,amount),net_amount=COALESCE(net_amount,amount-fee_amount);

ALTER TABLE app_live.payable_payments ADD COLUMN IF NOT EXISTS financial_account_id uuid REFERENCES app_live.financial_accounts(id) ON DELETE SET NULL;
ALTER TABLE app_live.payable_payments ADD COLUMN IF NOT EXISTS payment_method_id uuid REFERENCES app_live.payment_methods(id) ON DELETE SET NULL;
ALTER TABLE app_live.financial_transactions ADD COLUMN IF NOT EXISTS financial_account_id uuid REFERENCES app_live.financial_accounts(id) ON DELETE SET NULL;
ALTER TABLE app_live.financial_transactions ADD COLUMN IF NOT EXISTS payment_method_id uuid REFERENCES app_live.payment_methods(id) ON DELETE SET NULL;
ALTER TABLE app_live.financial_transactions ADD COLUMN IF NOT EXISTS gross_amount numeric(14,2);
ALTER TABLE app_live.financial_transactions ADD COLUMN IF NOT EXISTS fee_amount numeric(14,2) NOT NULL DEFAULT 0;

INSERT INTO app_live.financial_accounts(company_id,name,account_type)
SELECT c.id,v.name,v.account_type FROM app_live.companies c CROSS JOIN (VALUES
  ('Caixa','CAIXA'),('Banco','BANCO'),('Carteira','CARTEIRA')
) AS v(name,account_type) ON CONFLICT DO NOTHING;

INSERT INTO app_live.payment_methods(company_id,code,name,supports_installments)
SELECT c.id,v.code,v.name,v.installments FROM app_live.companies c CROSS JOIN (VALUES
  ('DINHEIRO','Dinheiro',false),('PIX','PIX',false),('CREDITO','Cartão de crédito',true),
  ('DEBITO','Cartão de débito',false),('BOLETO','Boleto',true),('TRANSFERENCIA','Transferência',false),('OUTRO','Outro',false)
) AS v(code,name,installments) ON CONFLICT DO NOTHING;

INSERT INTO app_live.financial_categories(company_id,group_id,name,nature,include_in_drg,system_code)
SELECT g.company_id,g.id,'Taxas das formas de pagamento','DESPESA',true,'PAYMENT_FEES'
FROM app_live.financial_category_groups g WHERE g.system_code='FINANCIAL_EXPENSES'
ON CONFLICT DO NOTHING;

COMMIT;

