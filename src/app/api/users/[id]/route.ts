import { NextResponse } from "next/server";
import { ensureAuthSchema, getSessionUser, permissionIds, type Permission } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { uuidPattern } from "@/lib/registries";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getSessionUser(); if (!actor || actor.role !== "ADMIN" || !actor.companyId) return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  const { id } = await context.params; if (!uuidPattern.test(id)) return NextResponse.json({ error: "Usuário inválido." }, { status: 400 });
  let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }
  const name = typeof body.name === "string" ? body.name.trim() : ""; const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""; const password = typeof body.password === "string" ? body.password : "";
  const role = ["ADMIN", "OPERADOR", "FINANCEIRO", "ESTOQUE"].includes(String(body.role)) ? String(body.role) : "OPERADOR"; const active = body.active !== false;
  const permissions = Array.isArray(body.permissions) ? body.permissions.filter((item): item is Permission => typeof item === "string" && permissionIds.includes(item as Permission)) : [];
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || password && password.length < 8) return NextResponse.json({ error: "Confira nome, e-mail e senha (mínimo de 8 caracteres)." }, { status: 400 });
  if (id === actor.id && (!active || role !== "ADMIN")) return NextResponse.json({ error: "Você não pode remover seu próprio acesso administrativo." }, { status: 400 });
  try { await ensureAuthSchema(); const pool = getPool()!; const result = await pool.query(`UPDATE app_live.app_users SET name=$2,email=$3,role=$4,permissions=$5::text[],active=$6,password_hash=CASE WHEN $7='' THEN password_hash ELSE crypt($7,gen_salt('bf',12)) END,updated_at=now() WHERE id=$1::uuid AND company_id=$8::uuid RETURNING id`, [id,name,email,role,role === "ADMIN" ? [...permissionIds] : permissions,active,password,actor.companyId]); if (!result.rowCount) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 }); await pool.query(`INSERT INTO app_live.audit_log(entity_type,entity_id,action,actor_id,details) VALUES('app_user',$1::uuid,'updated',$2::uuid,$3::jsonb)`, [id,actor.id,JSON.stringify({name,email,role,permissions,active,passwordChanged:Boolean(password),companyId:actor.companyId})]); return NextResponse.json({ ok: true }); }
  catch (error) { console.error(error); return NextResponse.json({ error: error instanceof Error && "code" in error && error.code === "23505" ? "Já existe um usuário com este e-mail." : "Não foi possível atualizar o usuário." }, { status: 500 }); }
}
