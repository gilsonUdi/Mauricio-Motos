import { NextResponse } from "next/server";
import { ensureAuthSchema, getSessionUser, permissionIds } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { seedCompanyCatalog } from "@/lib/catalog-schema";
import { seedOperationalFinance } from "@/lib/operational-finance-schema";

const slugify = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function GET() {
  const actor = await getSessionUser(); if (actor?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  try { await ensureAuthSchema(); const result = await getPool()!.query(`SELECT c.id::text,c.name,c.slug,c.active,c.created_at,COUNT(u.id)::integer AS user_count,COUNT(u.id) FILTER (WHERE u.role='ADMIN' AND u.active)::integer AS admin_count,principal.id::text AS admin_user_id,principal.email AS admin_email FROM app_live.companies c LEFT JOIN app_live.app_users u ON u.company_id=c.id LEFT JOIN LATERAL (SELECT au.id,au.email FROM app_live.app_users au WHERE au.company_id=c.id AND au.role='ADMIN' AND au.active ORDER BY au.created_at,au.id LIMIT 1) principal ON true GROUP BY c.id,principal.id,principal.email ORDER BY c.created_at DESC`); return NextResponse.json({ companies: result.rows }); }
  catch (error) { console.error(error); return NextResponse.json({ error: "Não foi possível carregar as empresas." }, { status: 500 }); }
}

export async function POST(request: Request) {
  const actor = await getSessionUser(); if (actor?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  let body: { name?: string; email?: string; password?: string }; try { body = await request.json(); } catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }
  const name = body.name?.trim(); const email = body.email?.trim().toLowerCase() || null; const password = body.password || null;
  if (!name) return NextResponse.json({ error: "Informe o nome da empresa." }, { status: 400 });
  if ((email && !password) || (!email && password)) return NextResponse.json({ error: "Para criar o acesso, informe e-mail e senha." }, { status: 400 });
  if (email && (!/^\S+@\S+\.\S+$/.test(email) || password!.length < 8)) return NextResponse.json({ error: "Informe um e-mail válido e senha com pelo menos 8 caracteres." }, { status: 400 });
  const client = getPool()!; await ensureAuthSchema();
  const connection = await client.connect(); try { await connection.query("BEGIN"); let slug = slugify(name) || "empresa"; const exists = await connection.query(`SELECT 1 FROM app_live.companies WHERE slug=$1`, [slug]); if (exists.rowCount) slug = `${slug}-${Date.now().toString(36)}`; const created = await connection.query(`INSERT INTO app_live.companies(name,slug) VALUES($1,$2) RETURNING id::text`, [name,slug]); const companyId = created.rows[0].id; await seedCompanyCatalog(connection,companyId); await seedOperationalFinance(connection,companyId); if (email && password) await connection.query(`INSERT INTO app_live.app_users(name,email,password_hash,role,permissions,company_id) VALUES($1,$2,crypt($3,gen_salt('bf',12)),'ADMIN',$4::text[],$5::uuid)`, [`Administrador - ${name}`,email,password,[...permissionIds],companyId]); await connection.query(`INSERT INTO app_live.audit_log(entity_type,entity_id,action,actor_id,details) VALUES('company',$1::uuid,'created',$2::uuid,$3::jsonb)`, [companyId,actor.id,JSON.stringify({name,slug,loginCreated:Boolean(email)})]); await connection.query("COMMIT"); return NextResponse.json({ id: companyId }, { status: 201 }); }
  catch (error) { await connection.query("ROLLBACK"); console.error(error); return NextResponse.json({ error: error instanceof Error && "code" in error && error.code === "23505" ? "Este e-mail já está em uso." : "Não foi possível criar a empresa." }, { status: 500 }); } finally { connection.release(); }
}
