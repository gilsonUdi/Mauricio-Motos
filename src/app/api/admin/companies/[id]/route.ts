import { NextResponse } from "next/server";
import { ensureAuthSchema, getSessionUser, permissionIds } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { uuidPattern } from "@/lib/registries";

type CompanyUpdate = {
  action?: string;
  name?: string;
  email?: string;
  password?: string;
  active?: boolean;
};

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getSessionUser();
  if (actor?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });

  const { id } = await context.params;
  if (!uuidPattern.test(id)) return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });

  let body: CompanyUpdate;
  try { body = await request.json() as CompanyUpdate; }
  catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }

  await ensureAuthSchema();
  const pool = getPool()!;
  try {
    if (body.action === "credentials") {
      const email = body.email?.trim().toLowerCase();
      const password = body.password || "";
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        return NextResponse.json({ error: "Informe um e-mail válido." }, { status: 400 });
      }
      if (password && password.length < 8) {
        return NextResponse.json({ error: "A nova senha deve ter pelo menos 8 caracteres." }, { status: 400 });
      }

      const connection = await pool.connect();
      try {
        await connection.query("BEGIN");
        const company = await connection.query(
          `SELECT name FROM app_live.companies WHERE id=$1::uuid FOR UPDATE`,
          [id],
        );
        if (!company.rowCount) throw new Error("COMPANY_NOT_FOUND");

        const admin = await connection.query(
          `SELECT id FROM app_live.app_users
           WHERE company_id=$1::uuid AND role='ADMIN' AND active
           ORDER BY created_at,id LIMIT 1 FOR UPDATE`,
          [id],
        );
        if (admin.rowCount) {
          if (password) {
            await connection.query(
              `UPDATE app_live.app_users
               SET email=$2,password_hash=crypt($3,gen_salt('bf',12)),updated_at=now()
               WHERE id=$1::uuid`,
              [admin.rows[0].id,email,password],
            );
          } else {
            await connection.query(
              `UPDATE app_live.app_users SET email=$2,updated_at=now() WHERE id=$1::uuid`,
              [admin.rows[0].id,email],
            );
          }
        } else {
          if (password.length < 8) throw new Error("PASSWORD_REQUIRED");
          await connection.query(
            `INSERT INTO app_live.app_users(name,email,password_hash,role,permissions,company_id)
             VALUES($1,$2,crypt($3,gen_salt('bf',12)),'ADMIN',$4::text[],$5::uuid)`,
            [`Administrador - ${company.rows[0].name}`,email,password,[...permissionIds],id],
          );
        }

        await connection.query(
          `INSERT INTO app_live.audit_log(entity_type,entity_id,action,actor_id,details)
           VALUES('company',$1::uuid,$2,$3::uuid,$4::jsonb)`,
          [id,admin.rowCount ? "credentials_updated" : "credentials_created",actor.id,JSON.stringify({ email,passwordChanged:Boolean(password) })],
        );
        await connection.query("COMMIT");
      } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
      } finally {
        connection.release();
      }
    } else {
      const name = body.name?.trim();
      if (!name) return NextResponse.json({ error: "Informe o nome." }, { status: 400 });
      const updated = await pool.query(
        `UPDATE app_live.companies SET name=$2,active=$3,updated_at=now() WHERE id=$1::uuid RETURNING id`,
        [id,name,body.active !== false],
      );
      if (!updated.rowCount) return NextResponse.json({ error: "Empresa não encontrada." }, { status: 404 });
      await pool.query(
        `INSERT INTO app_live.audit_log(entity_type,entity_id,action,actor_id,details)
         VALUES('company',$1::uuid,'updated',$2::uuid,$3::jsonb)`,
        [id,actor.id,JSON.stringify({ name,active:body.active !== false })],
      );
    }
    return NextResponse.json({ ok:true });
  } catch (error) {
    console.error(error);
    const duplicate = error instanceof Error && "code" in error && error.code === "23505";
    const passwordRequired = error instanceof Error && error.message === "PASSWORD_REQUIRED";
    const notFound = error instanceof Error && error.message === "COMPANY_NOT_FOUND";
    return NextResponse.json(
      { error: duplicate ? "Este e-mail já está em uso." : passwordRequired ? "Informe uma senha com pelo menos 8 caracteres." : notFound ? "Empresa não encontrada." : "Não foi possível atualizar a empresa." },
      { status: duplicate || passwordRequired ? 409 : notFound ? 404 : 500 },
    );
  }
}
