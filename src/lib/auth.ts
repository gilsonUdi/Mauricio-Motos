import { cookies } from "next/headers";
import { getPool } from "@/lib/db";
import { sessionCookie, permissionIds } from "@/lib/auth-shared";
import { verifySessionToken } from "@/lib/auth-token";
export { permissionIds, sessionCookie, hasPermission } from "@/lib/auth-shared";
export type { Permission, SessionUser } from "@/lib/auth-shared";
export { createSessionToken, verifySessionToken } from "@/lib/auth-token";
export const authEnabled = () => Boolean(process.env.AUTH_SECRET && process.env.DATABASE_URL);

declare global { var mauricioAuthSchema: Promise<void> | undefined; }

export async function ensureAuthSchema() {
  if (!global.mauricioAuthSchema) global.mauricioAuthSchema = (async () => {
    const pool = getPool(); if (!pool) throw new Error("Banco não configurado.");
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE TABLE IF NOT EXISTS app_live.app_users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, email text NOT NULL,
        password_hash text NOT NULL, role text NOT NULL DEFAULT 'OPERADOR',
        permissions text[] NOT NULL DEFAULT ARRAY['atendimento']::text[], active boolean NOT NULL DEFAULT true,
        last_login_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email ON app_live.app_users(lower(email));`);
    const email = process.env.AUTH_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.AUTH_ADMIN_PASSWORD;
    if (email && password) await pool.query(
      `INSERT INTO app_live.app_users (name,email,password_hash,role,permissions)
       SELECT $1,$2,crypt($3,gen_salt('bf',12)),'ADMIN',$4::text[]
       WHERE NOT EXISTS (SELECT 1 FROM app_live.app_users)
       ON CONFLICT DO NOTHING`,
      [process.env.AUTH_ADMIN_NAME?.trim() || "Administrador", email, password, [...permissionIds]],
    );
  })().catch((error) => { global.mauricioAuthSchema = undefined; throw error; });
  return global.mauricioAuthSchema;
}

export async function getSessionUser() { return verifySessionToken((await cookies()).get(sessionCookie)?.value); }
