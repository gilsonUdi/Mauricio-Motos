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
    const current = await client.query(
      `SELECT status, customer_id, customer_name, total_value FROM app_live.work_orders WHERE id = $1::uuid FOR UPDATE`,
      [id],
    );
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Ordem não encontrada." }, { status: 404 });
    }

    const previousStatus = current.rows[0].status as OrderStatus;
    const enteringSale = previousStatus !== "VENDA_REALIZADA" && body.status === "VENDA_REALIZADA";
    const leavingSale = previousStatus === "VENDA_REALIZADA" && body.status !== "VENDA_REALIZADA";
    if (enteringSale || leavingSale) {
      const items = await client.query(
        `SELECT i.product_id::text, p.name, SUM(i.quantity) AS quantity
         FROM app_live.work_order_items i
         JOIN app_live.products p ON p.id = i.product_id
         WHERE i.work_order_id = $1::uuid
           AND lower(concat_ws(' ', i.item_type, p.type)) NOT LIKE '%serv%'
         GROUP BY i.product_id, p.name
         ORDER BY i.product_id`,
        [id],
      );
      for (const item of items.rows) {
        const product = await client.query(
          `SELECT COALESCE(current_stock, 0) AS stock FROM app_live.products WHERE id = $1::uuid FOR UPDATE`,
          [item.product_id],
        );
        const oldStock = Number(product.rows[0].stock);
        const quantity = Number(item.quantity);
        const newStock = enteringSale ? oldStock - quantity : oldStock + quantity;
        if (newStock < 0) throw new Error(`INSUFFICIENT_STOCK:${item.name}`);
        await client.query(`UPDATE app_live.products SET current_stock = $2 WHERE id = $1::uuid`, [item.product_id, newStock]);
        await client.query(
          `INSERT INTO app_live.inventory_movements
           (product_id, movement_date, movement_type, quantity, party_name, balance_after)
           VALUES ($1::uuid, CURRENT_DATE, $2, $3, $4, $5)`,
          [item.product_id, enteringSale ? "VENDA" : "ESTORNO_VENDA", quantity, current.rows[0].customer_name, newStock],
        );
      }
    }

    if (enteringSale) {
      const reactivated = await client.query(
        `UPDATE app_live.receivables SET status='PENDENTE', due_date=COALESCE(due_date,CURRENT_DATE)
         WHERE work_order_id=$1::uuid AND payment_date IS NULL AND upper(COALESCE(status,'')) LIKE '%CANC%'`,
        [id],
      );
      if (!reactivated.rowCount) {
        await client.query(
          `INSERT INTO app_live.receivables (work_order_id, customer_id, customer_name, due_date, amount, status, notes)
           SELECT $1::uuid, $2::uuid, $3, CURRENT_DATE, $4, 'PENDENTE', 'Gerado automaticamente na conclusão da venda'
           WHERE NOT EXISTS (SELECT 1 FROM app_live.receivables WHERE work_order_id=$1::uuid)`,
          [id, current.rows[0].customer_id, current.rows[0].customer_name, current.rows[0].total_value],
        );
      }
    } else if (leavingSale) {
      await client.query(
        `UPDATE app_live.receivables SET status='CANCELADO'
         WHERE work_order_id=$1::uuid AND payment_date IS NULL`,
        [id],
      );
    }

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
    if (error instanceof Error && error.message.startsWith("INSUFFICIENT_STOCK:")) {
      return NextResponse.json({ error: `Estoque insuficiente para ${error.message.slice("INSUFFICIENT_STOCK:".length)}.` }, { status: 409 });
    }
    return NextResponse.json({ error: "Não foi possível atualizar a ordem." }, { status: 500 });
  } finally {
    client.release();
  }
}
