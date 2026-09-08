import { NextResponse } from "next/server";
import { ensureAuthSchema, getSessionUser, permissionIds } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { uuidPattern } from "@/lib/registries";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getSessionUser(); if (actor?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  const { id } = await context.params; if (!uuidPattern.test(id)) return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });
  let body: { action?: string; name?: string; email?: string; password?: string; active?: boolean }; try { body = await request.json(); } catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }
  await ensureAuthSchema(); const pool = getPool()!;
  try {
    if (body.action === "credentials") { const email = body.email?.trim().toLowerCase(); const password = body.password || ""; if (!email || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return NextResponse.json({ error: "Informe e-mail válido e senha com pelo menos 8 caracteres." }, { status: 400 }); await pool.query(`INSERT INTO app_live.app_users(name,email,password_hash,role,permissions,company_id) SELECT 'Administrador - '||name,$2,crypt($3,gen_salt('bf',12)),'ADMIN',$4::text[],id FROM app_live.companies WHERE id=$1::uuid`, [id,email,password,[...permissionIds]]); }
    else { const name = body.name?.trim(); if (!name) return NextResponse.json({ error: "Informe o nome." }, { status: 400 }); await pool.query(`UPDATE app_live.companies SET name=$2,active=$3,updated_at=now() WHERE id=$1::uuid`, [id,name,body.active !== false]); }
    await pool.query(`INSERT INTO app_live.audit_log(entity_type,entity_id,action,actor_id,details) VALUES('company',$1::uuid,$2,$3::uuid,$4::jsonb)`, [id,body.action === "credentials" ? "credentials_created" : "updated",actor.id,JSON.stringify({name:body.name,email:body.email,active:body.active})]); return NextResponse.json({ ok:true });
  } catch (error) { console.error(error); return NextResponse.json({ error: error instanceof Error && "code" in error && error.code === "23505" ? "Este e-mail já está em uso." : "Não foi possível atualizar a empresa." }, { status: 500 }); }
}
