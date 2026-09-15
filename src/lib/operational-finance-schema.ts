import type { Pool, PoolClient } from "pg";

type Queryable = Pick<PoolClient, "query">;

declare global {
  var mauricioOperationalFinanceSchema: Promise<void> | undefined;
}

const operationalFinanceSchemaSql = `
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
  maximum_installments integer NOT NULL DEFAULT 1 CHECK (maximum_installments BETWEEN 1 AND 120),
  variable_fee boolean NOT NULL DEFAULT false,
  default_fee_percent numeric(8,4) NOT NULL DEFAULT 0 CHECK (default_fee_percent BETWEEN 0 AND 100),
  default_account_id uuid REFERENCES app_live.financial_accounts(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_live.payment_methods ADD COLUMN IF NOT EXISTS maximum_installments integer NOT NULL DEFAULT 1;
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

INSERT INTO app_live.payment_methods(company_id,code,name,supports_installments,maximum_installments)
SELECT c.id,v.code,v.name,v.installments,v.maximum_installments FROM app_live.companies c CROSS JOIN (VALUES
  ('DINHEIRO','Dinheiro',false,1),('PIX','PIX',false,1),('CREDITO','Cartão de crédito',true,12),
  ('DEBITO','Cartão de débito',false,1),('BOLETO','Boleto',true,12),('TRANSFERENCIA','Transferência',false,1),('OUTRO','Outro',false,1)
) AS v(code,name,installments,maximum_installments) ON CONFLICT DO NOTHING;

INSERT INTO app_live.financial_categories(company_id,group_id,name,nature,include_in_drg,system_code)
SELECT g.company_id,g.id,'Taxas de Máquina de Cartão','DESPESA',true,'PAYMENT_FEES'
FROM app_live.financial_category_groups g WHERE g.system_code='FINANCIAL_EXPENSES'
ON CONFLICT DO NOTHING;
`;

export function ensureOperationalFinanceSchema(pool: Pool) {
  if (!global.mauricioOperationalFinanceSchema) {
    global.mauricioOperationalFinanceSchema = pool.query(operationalFinanceSchemaSql).then(() => undefined).catch((error) => {
      global.mauricioOperationalFinanceSchema = undefined;
      throw error;
    });
  }
  return global.mauricioOperationalFinanceSchema;
}

export async function seedOperationalFinance(connection: Queryable, companyId: string) {
  await connection.query(`INSERT INTO app_live.financial_accounts(company_id,name,account_type) VALUES
    ($1::uuid,'Caixa','CAIXA'),($1::uuid,'Banco','BANCO'),($1::uuid,'Carteira','CARTEIRA') ON CONFLICT DO NOTHING`,[companyId]);
  await connection.query(`INSERT INTO app_live.payment_methods(company_id,code,name,supports_installments,maximum_installments) VALUES
    ($1::uuid,'DINHEIRO','Dinheiro',false,1),($1::uuid,'PIX','PIX',false,1),($1::uuid,'CREDITO','Cartão de crédito',true,12),
    ($1::uuid,'DEBITO','Cartão de débito',false,1),($1::uuid,'BOLETO','Boleto',true,12),($1::uuid,'TRANSFERENCIA','Transferência',false,1),($1::uuid,'OUTRO','Outro',false,1)
    ON CONFLICT DO NOTHING`,[companyId]);
  await connection.query(`INSERT INTO app_live.financial_categories(company_id,group_id,name,nature,include_in_drg,system_code)
    SELECT $1::uuid,g.id,'Taxas de Máquina de Cartão','DESPESA',true,'PAYMENT_FEES'
    FROM app_live.financial_category_groups g WHERE g.company_id=$1::uuid AND g.system_code='FINANCIAL_EXPENSES' ON CONFLICT DO NOTHING`,[companyId]);
}

export { operationalFinanceSchemaSql };
