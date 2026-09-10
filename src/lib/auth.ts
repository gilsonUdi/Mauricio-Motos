import { cookies } from "next/headers";
import { getPool } from "@/lib/db";
import { sessionCookie, permissionIds } from "@/lib/auth-shared";
import { verifySessionToken } from "@/lib/auth-token";
import { ensureFinancialSchema } from "@/lib/financial-schema";
import { ensureCatalogSchema } from "@/lib/catalog-schema";
import { ensureOperationalFinanceSchema } from "@/lib/operational-finance-schema";
import { ensureSaleFinanceSchema } from "@/lib/sale-finance-schema";
import { ensureAuditSchema } from "@/lib/audit-schema";
import { ensureReadinessSchema } from "@/lib/readiness-schema";
export { permissionIds, sessionCookie, hasPermission } from "@/lib/auth-shared";
export type { Permission, SessionUser } from "@/lib/auth-shared";
export { createSessionToken, verifySessionToken } from "@/lib/auth-token";
export const authEnabled = () => Boolean(process.env.AUTH_SECRET && process.env.DATABASE_URL);
export const defaultCompanyId = "0b1655eb-0bd6-8e64-e592-6d1ae009de41";

declare global { var mauricioAuthSchema: Promise<void> | undefined; }

export async function ensureAuthSchema() {
  if (!global.mauricioAuthSchema) global.mauricioAuthSchema = (async () => {
    const pool = getPool(); if (!pool) throw new Error("Banco não configurado.");
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE TABLE IF NOT EXISTS app_live.companies (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL UNIQUE,
        active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO app_live.companies(id,name,slug) VALUES ('${defaultCompanyId}','Maurício Motos','mauricio-motos') ON CONFLICT DO NOTHING;
      CREATE TABLE IF NOT EXISTS app_live.app_users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, email text NOT NULL,
        password_hash text NOT NULL, role text NOT NULL DEFAULT 'OPERADOR',
        permissions text[] NOT NULL DEFAULT ARRAY['atendimento']::text[], active boolean NOT NULL DEFAULT true,
        company_id uuid REFERENCES app_live.companies(id) ON DELETE CASCADE,
        last_login_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE app_live.app_users ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES app_live.companies(id) ON DELETE CASCADE;
      ALTER TABLE app_live.app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
      ALTER TABLE app_live.app_users ADD CONSTRAINT app_users_role_check CHECK (role IN ('SUPER_ADMIN','ADMIN','OPERADOR','FINANCEIRO','ESTOQUE'));
      CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email ON app_live.app_users(lower(email));
      DO $$ DECLARE table_name text; BEGIN
        FOREACH table_name IN ARRAY ARRAY['customers','vehicles','products','mechanics','work_orders','receivables','inventory_movements','financial_transactions'] LOOP
          EXECUTE format('ALTER TABLE app_live.%I ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES app_live.companies(id)', table_name);
          EXECUTE format('UPDATE app_live.%I SET company_id = %L::uuid WHERE company_id IS NULL', table_name, '${defaultCompanyId}');
          EXECUTE format('ALTER TABLE app_live.%I ALTER COLUMN company_id SET NOT NULL', table_name);
          EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON app_live.%I(company_id)', 'idx_' || table_name || '_company', table_name);
        END LOOP;
      END $$;`);
    await ensureFinancialSchema(pool);
    await ensureCatalogSchema(pool);
    await ensureOperationalFinanceSchema(pool);
    await ensureSaleFinanceSchema(pool);
    await ensureAuditSchema(pool);
    await ensureReadinessSchema(pool);
    const email = process.env.AUTH_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.AUTH_ADMIN_PASSWORD;
    if (email && password) await pool.query(
      `INSERT INTO app_live.app_users (name,email,password_hash,role,permissions,company_id)
       VALUES ($1,$2,crypt($3,gen_salt('bf',12)),'SUPER_ADMIN',$4::text[],NULL)
       ON CONFLICT ((lower(email))) DO UPDATE SET role='SUPER_ADMIN',company_id=NULL,permissions=EXCLUDED.permissions,active=true`,
      [process.env.AUTH_ADMIN_NAME?.trim() || "Administrador", email, password, [...permissionIds]],
    );
    await pool.query(`UPDATE app_live.app_users SET company_id=$1::uuid WHERE company_id IS NULL AND role<>'SUPER_ADMIN'`,[defaultCompanyId]);
  })().catch((error) => { global.mauricioAuthSchema = undefined; throw error; });
  return global.mauricioAuthSchema;
}

export async function getSessionUser() { return verifySessionToken((await cookies()).get(sessionCookie)?.value); }
export async function getTenantScope() {
  await ensureAuthSchema();
  if (!authEnabled()) return { companyId: defaultCompanyId, user: null };
  const user = await getSessionUser();
  if (!user?.companyId || user.role === "SUPER_ADMIN") return null;
  return { companyId: user.companyId, user };
}
