import { NextResponse } from "next/server";
import { ensureAuthSchema, getSessionUser, permissionIds, type Permission } from "@/lib/auth";
import { getPool } from "@/lib/db";

export async function GET() {
  const actor = await getSessionUser(); if (!actor || actor.role !== "ADMIN") return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  try { await ensureAuthSchema(); const rows = await getPool()!.query(`SELECT id::text,name,email,role,permissions,active,last_login_at,created_at FROM app_live.app_users ORDER BY active DESC,name`); return NextResponse.json({ users: rows.rows }); }
  catch (error) { console.error(error); return NextResponse.json({ error: "Não foi possível carregar os usuários." }, { status: 500 }); }
}

export async function POST(request: Request) {
  const actor = await getSessionUser(); if (!actor || actor.role !== "ADMIN") return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }
  const name = typeof body.name === "string" ? body.name.trim() : ""; const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""; const password = typeof body.password === "string" ? body.password : "";
  const role = ["ADMIN", "OPERADOR", "FINANCEIRO", "ESTOQUE"].includes(String(body.role)) ? String(body.role) : "OPERADOR";
  const permissions = Array.isArray(body.permissions) ? body.permissions.filter((item): item is Permission => typeof item === "string" && permissionIds.includes(item as Permission)) : [];
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return NextResponse.json({ error: "Informe nome, e-mail válido e senha com pelo menos 8 caracteres." }, { status: 400 });
  try { await ensureAuthSchema(); const pool = getPool()!; const inserted = await pool.query(`INSERT INTO app_live.app_users (name,email,password_hash,role,permissions) VALUES ($1,$2,crypt($3,gen_salt('bf',12)),$4,$5::text[]) RETURNING id::text`, [name,email,password,role,role === "ADMIN" ? [...permissionIds] : permissions]); await pool.query(`INSERT INTO app_live.audit_log(entity_type,entity_id,action,actor_id,details) VALUES('app_user',$1::uuid,'created',$2::uuid,$3::jsonb)`, [inserted.rows[0].id,actor.id,JSON.stringify({name,email,role,permissions})]); return NextResponse.json({ id: inserted.rows[0].id }, { status: 201 }); }
  catch (error) { console.error(error); return NextResponse.json({ error: error instanceof Error && "code" in error && error.code === "23505" ? "Já existe um usuário com este e-mail." : "Não foi possível criar o usuário." }, { status: 500 }); }
}
