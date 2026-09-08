import type { Pool } from "pg";
declare global{var mauricioSaleFinanceSchema:Promise<void>|undefined;}
const saleFinanceSchemaSql=`
ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS entry_amount numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS installment_count integer NOT NULL DEFAULT 1;
ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS first_due_date date;
ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS payment_method_id uuid REFERENCES app_live.payment_methods(id) ON DELETE SET NULL;
ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS financial_account_id uuid REFERENCES app_live.financial_accounts(id) ON DELETE SET NULL;
ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS payment_fee_percent numeric(8,4) NOT NULL DEFAULT 0;
ALTER TABLE app_live.work_orders ADD COLUMN IF NOT EXISTS payment_fee_amount numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE app_live.receivables ADD COLUMN IF NOT EXISTS payment_method_id uuid REFERENCES app_live.payment_methods(id) ON DELETE SET NULL;
ALTER TABLE app_live.receivables ADD COLUMN IF NOT EXISTS financial_account_id uuid REFERENCES app_live.financial_accounts(id) ON DELETE SET NULL;
ALTER TABLE app_live.receivables ADD COLUMN IF NOT EXISTS fee_percent numeric(8,4) NOT NULL DEFAULT 0;
ALTER TABLE app_live.receivables ADD COLUMN IF NOT EXISTS fee_amount numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE app_live.receivables ADD COLUMN IF NOT EXISTS net_amount numeric(14,2);
UPDATE app_live.receivables SET net_amount=COALESCE(net_amount,COALESCE(original_amount,amount)-fee_amount);
`;
export function ensureSaleFinanceSchema(pool:Pool){if(!global.mauricioSaleFinanceSchema)global.mauricioSaleFinanceSchema=pool.query(saleFinanceSchemaSql).then(()=>undefined).catch(error=>{global.mauricioSaleFinanceSchema=undefined;throw error;});return global.mauricioSaleFinanceSchema;}
export{saleFinanceSchemaSql};
