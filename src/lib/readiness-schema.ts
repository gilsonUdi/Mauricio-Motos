import type { Pool } from "pg";

declare global { var mauricioReadinessSchema:Promise<void>|undefined; }

export const readinessSchemaSql=`
CREATE TABLE IF NOT EXISTS app_live.go_live_checklist (
  company_id uuid NOT NULL REFERENCES app_live.companies(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  notes text,
  completed_by uuid REFERENCES app_live.app_users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,item_key)
);
CREATE INDEX IF NOT EXISTS idx_go_live_checklist_company ON app_live.go_live_checklist(company_id,updated_at DESC);
`;

export function ensureReadinessSchema(pool:Pool){
  if(!global.mauricioReadinessSchema)global.mauricioReadinessSchema=pool.query(readinessSchemaSql).then(()=>undefined).catch(error=>{global.mauricioReadinessSchema=undefined;throw error;});
  return global.mauricioReadinessSchema;
}
