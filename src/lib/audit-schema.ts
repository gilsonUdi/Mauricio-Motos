import type { Pool } from "pg";

declare global {
  var mauricioAuditSchema: Promise<void> | undefined;
}

export const auditSchemaSql = `
ALTER TABLE app_live.audit_log
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES app_live.companies(id) ON DELETE CASCADE;

UPDATE app_live.audit_log a SET company_id=u.company_id
FROM app_live.app_users u
WHERE a.company_id IS NULL AND a.actor_id=u.id AND u.company_id IS NOT NULL;

UPDATE app_live.audit_log
SET company_id=CASE
  WHEN COALESCE(details->>'companyId',details->>'company_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN COALESCE(details->>'companyId',details->>'company_id')::uuid
  ELSE company_id
END
WHERE company_id IS NULL;

UPDATE app_live.audit_log SET company_id=entity_id
WHERE company_id IS NULL AND entity_type='company' AND entity_id IS NOT NULL;

UPDATE app_live.audit_log a SET company_id=e.company_id FROM app_live.work_orders e
WHERE a.company_id IS NULL AND a.entity_type='work_order' AND a.entity_id=e.id;
UPDATE app_live.audit_log a SET company_id=e.company_id FROM app_live.customers e
WHERE a.company_id IS NULL AND a.entity_type='customers' AND a.entity_id=e.id;
UPDATE app_live.audit_log a SET company_id=e.company_id FROM app_live.vehicles e
WHERE a.company_id IS NULL AND a.entity_type='vehicles' AND a.entity_id=e.id;
UPDATE app_live.audit_log a SET company_id=e.company_id FROM app_live.products e
WHERE a.company_id IS NULL AND a.entity_type='products' AND a.entity_id=e.id;
UPDATE app_live.audit_log a SET company_id=e.company_id FROM app_live.mechanics e
WHERE a.company_id IS NULL AND a.entity_type='mechanics' AND a.entity_id=e.id;
UPDATE app_live.audit_log a SET company_id=e.company_id FROM app_live.suppliers e
WHERE a.company_id IS NULL AND a.entity_type IN ('suppliers','supplier') AND a.entity_id=e.id;
UPDATE app_live.audit_log a SET company_id=e.company_id FROM app_live.receivables e
WHERE a.company_id IS NULL AND a.entity_type='receivable' AND a.entity_id=e.id;
UPDATE app_live.audit_log a SET company_id=e.company_id FROM app_live.financial_transactions e
WHERE a.company_id IS NULL AND a.entity_type='financial_transaction' AND a.entity_id=e.id;
UPDATE app_live.audit_log a SET company_id=e.company_id FROM app_live.inventory_movements e
WHERE a.company_id IS NULL AND a.entity_type='inventory_movement' AND a.entity_id=e.id;
UPDATE app_live.audit_log a SET company_id=e.company_id FROM app_live.purchases e
WHERE a.company_id IS NULL AND a.entity_type='purchase' AND a.entity_id=e.id;
UPDATE app_live.audit_log a SET company_id=e.company_id FROM app_live.accounts_payable e
WHERE a.company_id IS NULL AND a.entity_type='payable' AND a.entity_id=e.id;
UPDATE app_live.audit_log a SET company_id=e.company_id FROM app_live.app_users e
WHERE a.company_id IS NULL AND a.entity_type='app_user' AND a.entity_id=e.id;
UPDATE app_live.audit_log a SET company_id=e.company_id FROM app_live.financial_accounts e
WHERE a.company_id IS NULL AND a.entity_type='financial_account' AND a.entity_id=e.id;
UPDATE app_live.audit_log a SET company_id=e.company_id FROM app_live.payment_methods e
WHERE a.company_id IS NULL AND a.entity_type='payment_method' AND a.entity_id=e.id;
UPDATE app_live.audit_log a SET company_id=e.company_id FROM app_live.financial_category_groups e
WHERE a.company_id IS NULL AND a.entity_type='financial_category_group' AND a.entity_id=e.id;
UPDATE app_live.audit_log a SET company_id=e.company_id FROM app_live.financial_categories e
WHERE a.company_id IS NULL AND a.entity_type='financial_category' AND a.entity_id=e.id;

CREATE INDEX IF NOT EXISTS idx_audit_log_company_created
  ON app_live.audit_log(company_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_company_actor
  ON app_live.audit_log(company_id,actor_id,created_at DESC);

CREATE OR REPLACE FUNCTION app_live.assign_audit_company()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE detail_company text;
BEGIN
  IF NEW.company_id IS NULL AND NEW.actor_id IS NOT NULL THEN
    SELECT company_id INTO NEW.company_id FROM app_live.app_users WHERE id=NEW.actor_id;
  END IF;
  detail_company := COALESCE(NEW.details->>'companyId',NEW.details->>'company_id');
  IF NEW.company_id IS NULL AND detail_company ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    NEW.company_id := detail_company::uuid;
  END IF;
  IF NEW.company_id IS NULL AND NEW.entity_type='company' THEN NEW.company_id := NEW.entity_id; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS audit_log_assign_company ON app_live.audit_log;
CREATE TRIGGER audit_log_assign_company BEFORE INSERT ON app_live.audit_log
FOR EACH ROW EXECUTE FUNCTION app_live.assign_audit_company();
`;

export function ensureAuditSchema(pool: Pool) {
  if (!global.mauricioAuditSchema) {
    global.mauricioAuditSchema = pool.query(auditSchemaSql).then(() => undefined).catch((error) => {
      global.mauricioAuditSchema = undefined;
      throw error;
    });
  }
  return global.mauricioAuditSchema;
}
