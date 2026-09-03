import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { OrderStatus } from "@/lib/types";

const validStatuses = new Set<OrderStatus>(["ORCAMENTO", "PEDIDO", "VENDA_REALIZADA", "CANCELADO"]);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });

  const { id } = await context.params;
  const body = (await request.json()) as { status?: OrderStatus };
  if (!body.status || !validStatuses.has(body.status)) {
    return NextResponse.json({ error: "Status inválido." }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE app_live.work_orders
       SET status = $2,
           generate_order = ($2 IN ('PEDIDO', 'VENDA_REALIZADA')),
           sale_date = CASE WHEN $2 = 'VENDA_REALIZADA' THEN CURRENT_DATE ELSE NULL END,
           cancelled_at = CASE WHEN $2 = 'CANCELADO' THEN now() ELSE NULL END,
           updated_at = now()
       WHERE id = $1::uuid
       RETURNING id::text, status`,
      [id, body.status],
    );

    if (!updated.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Ordem não encontrada." }, { status: 404 });
    }

    await client.query(
      `INSERT INTO app_live.audit_log (entity_type, entity_id, action, details)
       VALUES ('work_order', $1::uuid, 'status_changed', jsonb_build_object('status', $2::text))`,
      [id, body.status],
    );
    await client.query("COMMIT");
    return NextResponse.json(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    return NextResponse.json({ error: "Não foi possível atualizar a ordem." }, { status: 500 });
  } finally {
    client.release();
  }
}
