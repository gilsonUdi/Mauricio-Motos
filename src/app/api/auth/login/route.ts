import { NextResponse } from "next/server";
import { authEnabled, createSessionToken, ensureAuthSchema, permissionIds, sessionCookie, type Permission } from "@/lib/auth";
import { getPool } from "@/lib/db";

export async function POST(request: Request) {
  if (!authEnabled()) return NextResponse.json({ error: "A autenticação ainda não foi configurada." }, { status: 503 });
  let body: { email?: string; password?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }
  const email = body.email?.trim().toLowerCase(); if (!email || !body.password) return NextResponse.json({ error: "Informe e-mail e senha." }, { status: 400 });
  try {
    await ensureAuthSchema(); const pool = getPool()!;
    const found = await pool.query(
      `SELECT u.id::text,u.name,u.email,u.role,u.permissions,u.company_id::text,c.name AS company_name FROM app_live.app_users u
       LEFT JOIN app_live.companies c ON c.id=u.company_id
       WHERE lower(u.email)=$1 AND u.active AND COALESCE(c.active,true) AND u.password_hash=crypt($2,u.password_hash) LIMIT 1`, [email, body.password],
    );
    if (!found.rowCount) return NextResponse.json({ error: "E-mail ou senha incorretos." }, { status: 401 });
    const row = found.rows[0]; const permissions = (row.permissions as string[]).filter((item): item is Permission => permissionIds.includes(item as Permission));
    const token = createSessionToken({ id: row.id, name: row.name, email: row.email, role: row.role, permissions, companyId: row.company_id, companyName: row.company_name });
    await pool.query(`UPDATE app_live.app_users SET last_login_at=now(),updated_at=now() WHERE id=$1::uuid`, [row.id]);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(sessionCookie, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 12 * 60 * 60 });
    return response;
  } catch (error) { console.error("Falha no login", error); return NextResponse.json({ error: "Não foi possível entrar agora." }, { status: 500 }); }
}
