BEGIN;

ALTER TABLE app_live.payment_methods
  ADD COLUMN IF NOT EXISTS maximum_installments integer NOT NULL DEFAULT 1;

UPDATE app_live.payment_methods
SET maximum_installments = CASE
  WHEN supports_installments THEN GREATEST(maximum_installments, 12)
  ELSE 1
END;

ALTER TABLE app_live.work_orders
  ADD COLUMN IF NOT EXISTS customer_assumes_payment_fee boolean NOT NULL DEFAULT false;
ALTER TABLE app_live.work_orders
  ADD COLUMN IF NOT EXISTS charged_total numeric(14,2);
ALTER TABLE app_live.receivables
  ADD COLUMN IF NOT EXISTS customer_assumes_fee boolean NOT NULL DEFAULT false;

INSERT INTO app_live.financial_categories(company_id,group_id,name,nature,include_in_drg,system_code)
SELECT g.company_id,g.id,'Taxas de Máquina de Cartão','DESPESA',true,'PAYMENT_FEES'
FROM app_live.financial_category_groups g
WHERE g.system_code='FINANCIAL_EXPENSES'
ON CONFLICT DO NOTHING;

UPDATE app_live.financial_categories
SET name='Taxas de Máquina de Cartão',include_in_drg=true
WHERE system_code='PAYMENT_FEES';

COMMIT;
