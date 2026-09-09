import { NextResponse } from "next/server";
import { getTenantScope } from "@/lib/auth";
import { getPool } from "@/lib/db";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const scope = await getTenantScope();
  if (!scope) return NextResponse.json({ error: "Selecione uma empresa." }, { status: 403 });
  const { id } = await context.params;
  if (!uuidPattern.test(id)) return NextResponse.json({ error: "Orçamento inválido." }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE app_live.work_orders SET last_shared_at=now(),share_count=share_count+1,updated_at=now()
       WHERE id=$1::uuid AND company_id=$2::uuid
       RETURNING last_shared_at AS "lastSharedAt",share_count AS "shareCount",order_number`,
      [id,scope.companyId],
    );
    if (!updated.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Orçamento não encontrado." }, { status: 404 });
    }
    await client.query(
      `INSERT INTO app_live.audit_log(entity_type,entity_id,action,actor_id,details)
       VALUES('work_order',$1::uuid,'shared',$2::uuid,jsonb_build_object('order_number',$3::text,'share_count',$4::integer,'company_id',$5::text))`,
      [id,scope.user?.id ?? null,updated.rows[0].order_number,updated.rows[0].shareCount,scope.companyId],
    );
    await client.query("COMMIT");
    return NextResponse.json({ lastSharedAt:updated.rows[0].lastSharedAt,shareCount:Number(updated.rows[0].shareCount) });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Falha ao registrar compartilhamento", error);
    return NextResponse.json({ error: "O PDF foi preparado, mas não foi possível registrar o envio." }, { status: 500 });
  } finally {
    client.release();
  }
}
