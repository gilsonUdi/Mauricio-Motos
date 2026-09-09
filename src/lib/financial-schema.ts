import type { Pool } from "pg";

declare global {
  var mauricioFinancialSchema: Promise<void> | undefined;
}

const financialSchemaSql = `
CREATE TABLE IF NOT EXISTS app_live.financial_category_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES app_live.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  nature text NOT NULL DEFAULT 'DESPESA' CHECK (nature IN ('RECEITA','DESPESA','AMBOS')),
  include_in_drg boolean NOT NULL DEFAULT true,
  system_code text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_groups_company_name ON app_live.financial_category_groups(company_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_groups_system_code ON app_live.financial_category_groups(company_id, system_code) WHERE system_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_live.financial_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES app_live.companies(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES app_live.financial_category_groups(id) ON DELETE RESTRICT,
  name text NOT NULL,
  nature text NOT NULL DEFAULT 'DESPESA' CHECK (nature IN ('RECEITA','DESPESA','AMBOS')),
  include_in_drg boolean NOT NULL DEFAULT true,
  system_code text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_categories_group_name ON app_live.financial_categories(group_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_categories_system_code ON app_live.financial_categories(company_id, system_code) WHERE system_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_live.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES app_live.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  trade_name text,
  document text,
  phone text,
  email text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suppliers_company_name ON app_live.suppliers(company_id, name);

CREATE TABLE IF NOT EXISTS app_live.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES app_live.companies(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES app_live.suppliers(id) ON DELETE SET NULL,
  supplier_name text NOT NULL,
  document_number text,
  issue_date date NOT NULL,
  competence_date date NOT NULL,
  total_amount numeric(14,2) NOT NULL CHECK (total_amount >= 0),
  status text NOT NULL DEFAULT 'CONFIRMADA' CHECK (status IN ('RASCUNHO','CONFIRMADA','CANCELADA')),
  legacy_purchase_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, legacy_purchase_key)
);
CREATE INDEX IF NOT EXISTS idx_purchases_company_competence ON app_live.purchases(company_id, competence_date DESC);

CREATE TABLE IF NOT EXISTS app_live.purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES app_live.purchases(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES app_live.products(id) ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(14,4) NOT NULL CHECK (unit_cost >= 0),
  previous_average_cost numeric(14,4) NOT NULL DEFAULT 0,
  average_cost_after numeric(14,4) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL CHECK (total_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON app_live.purchase_items(purchase_id);

CREATE TABLE IF NOT EXISTS app_live.accounts_payable (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES app_live.companies(id) ON DELETE CASCADE,
  purchase_id uuid REFERENCES app_live.purchases(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES app_live.suppliers(id) ON DELETE SET NULL,
  category_id uuid REFERENCES app_live.financial_categories(id) ON DELETE SET NULL,
  description text NOT NULL,
  document_number text,
  issue_date date NOT NULL,
  competence_date date NOT NULL,
  due_date date NOT NULL,
  installment_number integer NOT NULL DEFAULT 1 CHECK (installment_number > 0),
  installment_count integer NOT NULL DEFAULT 1 CHECK (installment_count > 0),
  original_amount numeric(14,2) NOT NULL CHECK (original_amount >= 0),
  open_amount numeric(14,2) NOT NULL CHECK (open_amount >= 0),
  status text NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','PARCIAL','PAGO','CANCELADO')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payables_company_due ON app_live.accounts_payable(company_id, due_date, status);

CREATE TABLE IF NOT EXISTS app_live.payable_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES app_live.companies(id) ON DELETE CASCADE,
  payable_id uuid NOT NULL REFERENCES app_live.accounts_payable(id) ON DELETE CASCADE,
  payment_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  interest_amount numeric(14,2) NOT NULL DEFAULT 0,
  fine_amount numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  payment_method text,
  notes text,
  reversed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_live.receivables ADD COLUMN IF NOT EXISTS issue_date date;
ALTER TABLE app_live.receivables ADD COLUMN IF NOT EXISTS competence_date date;
ALTER TABLE app_live.receivables ADD COLUMN IF NOT EXISTS original_amount numeric(14,2);
ALTER TABLE app_live.receivables ADD COLUMN IF NOT EXISTS open_amount numeric(14,2);
ALTER TABLE app_live.receivables ADD COLUMN IF NOT EXISTS installment_number integer NOT NULL DEFAULT 1;
ALTER TABLE app_live.receivables ADD COLUMN IF NOT EXISTS installment_count integer NOT NULL DEFAULT 1;
ALTER TABLE app_live.receivables ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES app_live.financial_categories(id) ON DELETE SET NULL;
ALTER TABLE app_live.receivables ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
UPDATE app_live.receivables SET issue_date=COALESCE(issue_date,due_date,created_at::date), competence_date=COALESCE(competence_date,due_date,created_at::date), original_amount=COALESCE(original_amount,amount), open_amount=COALESCE(open_amount,CASE WHEN payment_date IS NULL THEN amount ELSE 0 END);

CREATE TABLE IF NOT EXISTS app_live.receivable_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES app_live.companies(id) ON DELETE CASCADE,
  receivable_id uuid NOT NULL REFERENCES app_live.receivables(id) ON DELETE CASCADE,
  receipt_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  interest_amount numeric(14,2) NOT NULL DEFAULT 0,
  fine_amount numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  payment_method text,
  notes text,
  reversed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_receivable_payments_receivable ON app_live.receivable_payments(receivable_id, receipt_date);

CREATE TABLE IF NOT EXISTS app_live.financial_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES app_live.companies(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('RECEITA_VENDA','CMV','DESPESA','RECEITA','PAGAMENTO','RECEBIMENTO','ESTORNO')),
  source_type text NOT NULL,
  source_id uuid,
  category_id uuid REFERENCES app_live.financial_categories(id) ON DELETE SET NULL,
  competence_date date NOT NULL,
  cash_date date,
  description text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  affects_drg boolean NOT NULL DEFAULT true,
  reversed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, event_key)
);
CREATE INDEX IF NOT EXISTS idx_financial_events_drg ON app_live.financial_events(company_id, competence_date, event_type) WHERE reversed_at IS NULL AND affects_drg;

ALTER TABLE app_live.inventory_movements ADD COLUMN IF NOT EXISTS unit_cost numeric(14,4);
ALTER TABLE app_live.inventory_movements ADD COLUMN IF NOT EXISTS total_cost numeric(14,2);
ALTER TABLE app_live.inventory_movements ADD COLUMN IF NOT EXISTS movement_reason text;
ALTER TABLE app_live.inventory_movements ADD COLUMN IF NOT EXISTS affects_sales_metrics boolean NOT NULL DEFAULT false;
ALTER TABLE app_live.inventory_movements ADD COLUMN IF NOT EXISTS source_type text;
ALTER TABLE app_live.inventory_movements ADD COLUMN IF NOT EXISTS source_id uuid;
ALTER TABLE app_live.inventory_movements ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_inventory_sales_metrics ON app_live.inventory_movements(company_id, movement_date, product_id) WHERE affects_sales_metrics AND reversed_at IS NULL;

CREATE TABLE IF NOT EXISTS app_live.inventory_cost_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES app_live.companies(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES app_live.products(id) ON DELETE CASCADE,
  purchase_id uuid REFERENCES app_live.purchases(id) ON DELETE SET NULL,
  effective_date date NOT NULL,
  previous_stock numeric(14,3) NOT NULL,
  incoming_quantity numeric(14,3) NOT NULL,
  previous_average_cost numeric(14,4) NOT NULL,
  incoming_unit_cost numeric(14,4) NOT NULL,
  new_average_cost numeric(14,4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS valid_until date;
UPDATE app_live.work_orders SET valid_until=COALESCE(budget_date,CURRENT_DATE)+7 WHERE valid_until IS NULL AND status='ORCAMENTO';
ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS source_work_order_id uuid REFERENCES app_live.work_orders(id) ON DELETE SET NULL;
ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS revision_number integer NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_work_orders_source ON app_live.work_orders(company_id,source_work_order_id);
ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS approved_by_customer text;
ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS approval_method text;
ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS approval_notes text;
ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS financial_generated_at timestamptz;
ALTER TABLE app_live.work_order_items ADD COLUMN IF NOT EXISTS unit_cost_snapshot numeric(14,4);

ALTER TABLE app_live.financial_transactions ADD COLUMN IF NOT EXISTS competence_date date;
ALTER TABLE app_live.financial_transactions ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES app_live.financial_categories(id) ON DELETE SET NULL;
ALTER TABLE app_live.financial_transactions ADD COLUMN IF NOT EXISTS source_type text;
ALTER TABLE app_live.financial_transactions ADD COLUMN IF NOT EXISTS source_id uuid;
ALTER TABLE app_live.financial_transactions ADD COLUMN IF NOT EXISTS affects_drg boolean NOT NULL DEFAULT true;
UPDATE app_live.financial_transactions SET competence_date=COALESCE(competence_date,transaction_date);

INSERT INTO app_live.financial_category_groups(company_id,name,nature,include_in_drg,system_code)
SELECT c.id,v.name,v.nature,v.include_in_drg,v.code FROM app_live.companies c CROSS JOIN (VALUES
  ('Receitas de vendas','RECEITA',true,'SALES_REVENUE'),
  ('Custos das mercadorias','DESPESA',true,'COGS'),
  ('Fornecedores de mercadorias','DESPESA',false,'INVENTORY_SUPPLIERS'),
  ('Despesas operacionais','DESPESA',true,'OPERATING_EXPENSES'),
  ('Despesas financeiras','DESPESA',true,'FINANCIAL_EXPENSES'),
  ('Movimentos não operacionais','AMBOS',true,'NON_OPERATING')
) AS v(name,nature,include_in_drg,code)
ON CONFLICT DO NOTHING;

INSERT INTO app_live.financial_categories(company_id,group_id,name,nature,include_in_drg,system_code)
SELECT g.company_id,g.id,v.name,v.nature,v.include_in_drg,v.code
FROM app_live.financial_category_groups g JOIN (VALUES
  ('SALES_REVENUE','Venda de produtos e serviços','RECEITA',true,'SALES'),
  ('COGS','CMV','DESPESA',true,'COGS'),
  ('INVENTORY_SUPPLIERS','Pagamento de fornecedores','DESPESA',false,'INVENTORY_PURCHASE'),
  ('OPERATING_EXPENSES','Despesas gerais','DESPESA',true,'GENERAL_EXPENSE'),
  ('NON_OPERATING','Outras receitas','RECEITA',true,'OTHER_INCOME')
) AS v(group_code,name,nature,include_in_drg,code) ON g.system_code=v.group_code
ON CONFLICT DO NOTHING;
`;

export function ensureFinancialSchema(pool: Pool) {
  if (!global.mauricioFinancialSchema) {
    global.mauricioFinancialSchema = pool.query(financialSchemaSql).then(() => undefined).catch((error) => {
      global.mauricioFinancialSchema = undefined;
      throw error;
    });
  }
  return global.mauricioFinancialSchema;
}

export { financialSchemaSql };
