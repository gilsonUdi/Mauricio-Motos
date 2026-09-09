import type { Pool, PoolClient } from "pg";

type Queryable = Pick<PoolClient, "query">;

declare global {
  var mauricioCatalogSchema: Promise<void> | undefined;
}

const catalogSchemaSql = `
ALTER TABLE app_live.customers ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE app_live.customers ADD COLUMN IF NOT EXISTS zip_code text;
ALTER TABLE app_live.customers ADD COLUMN IF NOT EXISTS street text;
ALTER TABLE app_live.customers ADD COLUMN IF NOT EXISTS address_number text;
ALTER TABLE app_live.customers ADD COLUMN IF NOT EXISTS complement text;
ALTER TABLE app_live.customers ADD COLUMN IF NOT EXISTS district text;
ALTER TABLE app_live.customers ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE app_live.customers ADD COLUMN IF NOT EXISTS state text;

ALTER TABLE app_live.suppliers ADD COLUMN IF NOT EXISTS legal_name text;
ALTER TABLE app_live.suppliers ADD COLUMN IF NOT EXISTS state_registration text;
ALTER TABLE app_live.suppliers ADD COLUMN IF NOT EXISTS zip_code text;
ALTER TABLE app_live.suppliers ADD COLUMN IF NOT EXISTS street text;
ALTER TABLE app_live.suppliers ADD COLUMN IF NOT EXISTS address_number text;
ALTER TABLE app_live.suppliers ADD COLUMN IF NOT EXISTS complement text;
ALTER TABLE app_live.suppliers ADD COLUMN IF NOT EXISTS district text;
ALTER TABLE app_live.suppliers ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE app_live.suppliers ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE app_live.suppliers ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 0;
ALTER TABLE app_live.suppliers ADD COLUMN IF NOT EXISTS notes text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_company_document ON app_live.suppliers(company_id,document) WHERE document IS NOT NULL AND document<>'';

ALTER TABLE app_live.products ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE app_live.products ADD COLUMN IF NOT EXISTS barcode text;
ALTER TABLE app_live.products ADD COLUMN IF NOT EXISTS item_kind text;
ALTER TABLE app_live.products ADD COLUMN IF NOT EXISTS ncm text;
ALTER TABLE app_live.products ADD COLUMN IF NOT EXISTS cest text;
ALTER TABLE app_live.products ADD COLUMN IF NOT EXISTS fiscal_origin text;
ALTER TABLE app_live.products ADD COLUMN IF NOT EXISTS commercial_unit text NOT NULL DEFAULT 'UN';
ALTER TABLE app_live.products ADD COLUMN IF NOT EXISTS default_cfop text;
ALTER TABLE app_live.products ADD COLUMN IF NOT EXISTS tax_code text;
ALTER TABLE app_live.products ADD COLUMN IF NOT EXISTS tax_rate numeric(8,4) NOT NULL DEFAULT 0;
ALTER TABLE app_live.products ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE app_live.products ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES app_live.suppliers(id) ON DELETE SET NULL;
ALTER TABLE app_live.products ADD COLUMN IF NOT EXISTS minimum_stock numeric(14,3) NOT NULL DEFAULT 0;
ALTER TABLE app_live.products ADD COLUMN IF NOT EXISTS lead_time_days integer NOT NULL DEFAULT 0;
ALTER TABLE app_live.products ADD COLUMN IF NOT EXISTS stock_location text;
UPDATE app_live.products SET item_kind=CASE WHEN lower(COALESCE(type,'')) LIKE '%serv%' THEN 'SERVICO' ELSE 'PRODUTO' END WHERE item_kind IS NULL;
ALTER TABLE app_live.products ALTER COLUMN item_kind SET DEFAULT 'PRODUTO';
ALTER TABLE app_live.products ALTER COLUMN item_kind SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_company_sku ON app_live.products(company_id,sku) WHERE sku IS NOT NULL AND sku<>'';
CREATE INDEX IF NOT EXISTS idx_products_supplier ON app_live.products(company_id,supplier_id);

INSERT INTO app_live.financial_category_groups(company_id,name,nature,include_in_drg,system_code)
SELECT c.id,v.name,v.nature,v.include_in_drg,v.code FROM app_live.companies c CROSS JOIN (VALUES
  ('Pessoal','DESPESA',true,'PERSONNEL'),
  ('Ocupação e utilidades','DESPESA',true,'OCCUPANCY'),
  ('Vendas e marketing','DESPESA',true,'SALES_EXPENSES'),
  ('Manutenção e operação','DESPESA',true,'OPERATIONS'),
  ('Tributos','DESPESA',true,'TAXES'),
  ('Investimentos e imobilizado','DESPESA',false,'FIXED_ASSETS')
) AS v(name,nature,include_in_drg,code)
ON CONFLICT DO NOTHING;

INSERT INTO app_live.financial_categories(company_id,group_id,name,nature,include_in_drg,system_code)
SELECT g.company_id,g.id,v.name,'DESPESA',v.include_in_drg,v.code
FROM app_live.financial_category_groups g JOIN (VALUES
  ('PERSONNEL','Salários e pró-labore',true,'PAYROLL'),
  ('PERSONNEL','Encargos trabalhistas',true,'LABOR_CHARGES'),
  ('PERSONNEL','Benefícios',true,'BENEFITS'),
  ('OCCUPANCY','Aluguel',true,'RENT'),
  ('OCCUPANCY','Água, energia e internet',true,'UTILITIES'),
  ('SALES_EXPENSES','Marketing e publicidade',true,'MARKETING'),
  ('SALES_EXPENSES','Comissões de vendas',true,'SALES_COMMISSIONS'),
  ('OPERATIONS','Manutenção da oficina',true,'WORKSHOP_MAINTENANCE'),
  ('OPERATIONS','Materiais de consumo',true,'CONSUMABLES'),
  ('OPERATIONS','Serviços de terceiros',true,'THIRD_PARTY_SERVICES'),
  ('OPERATING_EXPENSES','Despesas administrativas',true,'ADMIN_EXPENSES'),
  ('FINANCIAL_EXPENSES','Tarifas bancárias e juros',true,'BANK_FEES'),
  ('TAXES','Impostos e taxas',true,'TAXES_AND_FEES'),
  ('FIXED_ASSETS','Aquisição de imobilizado',false,'ASSET_ACQUISITION')
) AS v(group_code,name,include_in_drg,code) ON g.system_code=v.group_code
ON CONFLICT DO NOTHING;
`;

export function ensureCatalogSchema(pool: Pool) {
  if (!global.mauricioCatalogSchema) {
    global.mauricioCatalogSchema = pool.query(catalogSchemaSql).then(() => undefined).catch((error) => {
      global.mauricioCatalogSchema = undefined;
      throw error;
    });
  }
  return global.mauricioCatalogSchema;
}

export async function seedCompanyCatalog(connection:Queryable,companyId:string){
  await connection.query(`INSERT INTO app_live.financial_category_groups(company_id,name,nature,include_in_drg,system_code)
    SELECT $1::uuid,v.name,v.nature,v.include_in_drg,v.code FROM (VALUES
      ('Receitas de vendas','RECEITA',true,'SALES_REVENUE'),('Custos das mercadorias','DESPESA',true,'COGS'),
      ('Fornecedores de mercadorias','DESPESA',false,'INVENTORY_SUPPLIERS'),('Despesas operacionais','DESPESA',true,'OPERATING_EXPENSES'),
      ('Despesas financeiras','DESPESA',true,'FINANCIAL_EXPENSES'),('Movimentos não operacionais','AMBOS',true,'NON_OPERATING'),
      ('Pessoal','DESPESA',true,'PERSONNEL'),('Ocupação e utilidades','DESPESA',true,'OCCUPANCY'),
      ('Vendas e marketing','DESPESA',true,'SALES_EXPENSES'),('Manutenção e operação','DESPESA',true,'OPERATIONS'),
      ('Tributos','DESPESA',true,'TAXES'),('Investimentos e imobilizado','DESPESA',false,'FIXED_ASSETS')
    ) AS v(name,nature,include_in_drg,code) ON CONFLICT DO NOTHING`,[companyId]);
  await connection.query(`INSERT INTO app_live.financial_categories(company_id,group_id,name,nature,include_in_drg,system_code)
    SELECT $1::uuid,g.id,v.name,v.nature,v.include_in_drg,v.code FROM app_live.financial_category_groups g JOIN (VALUES
      ('SALES_REVENUE','Venda de produtos e serviços','RECEITA',true,'SALES'),('COGS','CMV','DESPESA',true,'COGS'),
      ('INVENTORY_SUPPLIERS','Pagamento de fornecedores','DESPESA',false,'INVENTORY_PURCHASE'),('OPERATING_EXPENSES','Despesas gerais','DESPESA',true,'GENERAL_EXPENSE'),
      ('NON_OPERATING','Outras receitas','RECEITA',true,'OTHER_INCOME'),('PERSONNEL','Salários e pró-labore','DESPESA',true,'PAYROLL'),
      ('PERSONNEL','Encargos trabalhistas','DESPESA',true,'LABOR_CHARGES'),('PERSONNEL','Benefícios','DESPESA',true,'BENEFITS'),
      ('OCCUPANCY','Aluguel','DESPESA',true,'RENT'),('OCCUPANCY','Água, energia e internet','DESPESA',true,'UTILITIES'),
      ('SALES_EXPENSES','Marketing e publicidade','DESPESA',true,'MARKETING'),('SALES_EXPENSES','Comissões de vendas','DESPESA',true,'SALES_COMMISSIONS'),
      ('OPERATIONS','Manutenção da oficina','DESPESA',true,'WORKSHOP_MAINTENANCE'),('OPERATIONS','Materiais de consumo','DESPESA',true,'CONSUMABLES'),
      ('OPERATIONS','Serviços de terceiros','DESPESA',true,'THIRD_PARTY_SERVICES'),('OPERATING_EXPENSES','Despesas administrativas','DESPESA',true,'ADMIN_EXPENSES'),
      ('FINANCIAL_EXPENSES','Tarifas bancárias e juros','DESPESA',true,'BANK_FEES'),('TAXES','Impostos e taxas','DESPESA',true,'TAXES_AND_FEES'),
      ('FIXED_ASSETS','Aquisição de imobilizado','DESPESA',false,'ASSET_ACQUISITION')
    ) AS v(group_code,name,nature,include_in_drg,code) ON g.company_id=$1::uuid AND g.system_code=v.group_code ON CONFLICT DO NOTHING`,[companyId]);
}

export { catalogSchemaSql };
