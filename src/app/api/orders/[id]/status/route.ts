import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { OrderStatus } from "@/lib/types";
import { getTenantScope } from "@/lib/auth";

const validStatuses = new Set<OrderStatus>(["ORCAMENTO", "PEDIDO", "VENDA_REALIZADA", "CANCELADO"]);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const scope = await getTenantScope(); if (!scope) return NextResponse.json({ error: "Selecione uma empresa." }, { status: 403 });

  const { id } = await context.params;
  const body = (await request.json()) as { status?: OrderStatus };
  if (!body.status || !validStatuses.has(body.status)) {
    return NextResponse.json({ error: "Status inválido." }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT status,customer_id,customer_name,total_value,COALESCE(sale_date,CURRENT_DATE)::text AS sale_date
       FROM app_live.work_orders WHERE id=$1::uuid AND company_id=$2::uuid FOR UPDATE`,
      [id,scope.companyId],
    );
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Ordem não encontrada." }, { status: 404 });
    }

    const previousStatus = current.rows[0].status as OrderStatus;
    const enteringSale = previousStatus !== "VENDA_REALIZADA" && body.status === "VENDA_REALIZADA";
    const leavingSale = previousStatus === "VENDA_REALIZADA" && body.status !== "VENDA_REALIZADA";
    if (leavingSale) {
      const received = await client.query(
        `SELECT 1 FROM app_live.receivable_payments rp
         JOIN app_live.receivables r ON r.id=rp.receivable_id
         WHERE r.work_order_id=$1::uuid AND rp.reversed_at IS NULL
         UNION ALL
         SELECT 1 FROM app_live.receivables WHERE work_order_id=$1::uuid AND payment_date IS NOT NULL LIMIT 1`,
        [id],
      );
      if (received.rowCount) throw new Error("SALE_HAS_RECEIPTS");
    }
    let saleCost = 0;
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
          `SELECT COALESCE(current_stock,0) AS stock,COALESCE(cost_price,0) AS unit_cost
           FROM app_live.products WHERE id=$1::uuid AND company_id=$2::uuid FOR UPDATE`,
          [item.product_id,scope.companyId],
        );
        const oldStock = Number(product.rows[0].stock);
        const quantity = Number(item.quantity);
        const unitCost = Number(product.rows[0].unit_cost);
        saleCost += quantity * unitCost;
        const newStock = enteringSale ? oldStock - quantity : oldStock + quantity;
        if (newStock < 0) throw new Error(`INSUFFICIENT_STOCK:${item.name}`);
        await client.query(`UPDATE app_live.products SET current_stock = $2 WHERE id = $1::uuid`, [item.product_id, newStock]);
        await client.query(
          `INSERT INTO app_live.inventory_movements
           (company_id,product_id,movement_date,movement_type,quantity,party_name,balance_after,unit_cost,total_cost,movement_reason,affects_sales_metrics,source_type,source_id)
           VALUES ($1::uuid,$2::uuid,CURRENT_DATE,$3,$4,$5,$6,$7,$8,$9,$10,'WORK_ORDER',$11::uuid)`,
          [scope.companyId,item.product_id, enteringSale ? "VENDA" : "ESTORNO_VENDA", quantity, current.rows[0].customer_name, newStock,unitCost,Math.round(quantity*unitCost*100)/100,enteringSale?"VENDA_CONCLUIDA":"ESTORNO_VENDA",enteringSale,id],
        );
        if (enteringSale) {
          await client.query(
            `UPDATE app_live.work_order_items SET unit_cost_snapshot=$2, cost_value=$2
             WHERE work_order_id=$1::uuid AND product_id=$3::uuid`,
            [id,unitCost,item.product_id],
          );
        }
      }
    }

    if (enteringSale) {
      const reactivated = await client.query(
        `UPDATE app_live.receivables SET status='PENDENTE',cancelled_at=NULL,due_date=COALESCE(due_date,CURRENT_DATE),
           issue_date=COALESCE(issue_date,CURRENT_DATE),competence_date=CURRENT_DATE,
           original_amount=$2,amount=$2,open_amount=$2
         WHERE work_order_id=$1::uuid AND payment_date IS NULL AND upper(COALESCE(status,'')) LIKE '%CANC%'`,
        [id,current.rows[0].total_value],
      );
      if (!reactivated.rowCount) {
        await client.query(
          `INSERT INTO app_live.receivables (company_id,work_order_id,customer_id,customer_name,issue_date,competence_date,due_date,amount,original_amount,open_amount,status,notes)
           SELECT $5::uuid,$1::uuid,$2::uuid,$3,CURRENT_DATE,CURRENT_DATE,CURRENT_DATE,$4,$4,$4,'PENDENTE','Gerado automaticamente na conclusão da venda'
           WHERE NOT EXISTS (SELECT 1 FROM app_live.receivables WHERE work_order_id=$1::uuid)`,
          [id, current.rows[0].customer_id, current.rows[0].customer_name, current.rows[0].total_value,scope.companyId],
        );
      }
      const categories = await client.query(
        `SELECT system_code,id FROM app_live.financial_categories
         WHERE company_id=$1::uuid AND system_code IN ('SALES','COGS')`,
        [scope.companyId],
      );
      const categoryIds = Object.fromEntries(categories.rows.map((row) => [row.system_code,row.id]));
      const eventDate = current.rows[0].sale_date;
      await client.query(
        `INSERT INTO app_live.financial_events
         (company_id,event_key,event_type,source_type,source_id,category_id,competence_date,description,amount,affects_drg)
         VALUES ($1::uuid,$2,'RECEITA_VENDA','WORK_ORDER',$3::uuid,$4::uuid,$5::date,$6,$7,true)
         ON CONFLICT (company_id,event_key) DO UPDATE SET category_id=EXCLUDED.category_id,competence_date=EXCLUDED.competence_date,description=EXCLUDED.description,amount=EXCLUDED.amount,reversed_at=NULL`,
        [scope.companyId,`sale:${id}:revenue`,id,categoryIds.SALES??null,eventDate,`Venda ${current.rows[0].customer_name}`,current.rows[0].total_value],
      );
      await client.query(
        `INSERT INTO app_live.financial_events
         (company_id,event_key,event_type,source_type,source_id,category_id,competence_date,description,amount,affects_drg)
         VALUES ($1::uuid,$2,'CMV','WORK_ORDER',$3::uuid,$4::uuid,$5::date,$6,$7,true)
         ON CONFLICT (company_id,event_key) DO UPDATE SET category_id=EXCLUDED.category_id,competence_date=EXCLUDED.competence_date,description=EXCLUDED.description,amount=EXCLUDED.amount,reversed_at=NULL`,
        [scope.companyId,`sale:${id}:cogs`,id,categoryIds.COGS??null,eventDate,`CMV da venda ${current.rows[0].customer_name}`,Math.round(saleCost*100)/100],
      );
    } else if (leavingSale) {
      await client.query(
        `UPDATE app_live.receivables SET status='CANCELADO',cancelled_at=now(),open_amount=0
         WHERE work_order_id=$1::uuid AND payment_date IS NULL`,
        [id],
      );
      await client.query(
        `UPDATE app_live.financial_events SET reversed_at=now()
         WHERE company_id=$1::uuid AND source_type='WORK_ORDER' AND source_id=$2::uuid AND reversed_at IS NULL`,
        [scope.companyId,id],
      );
      await client.query(
        `UPDATE app_live.inventory_movements SET reversed_at=now()
         WHERE company_id=$1::uuid AND source_type='WORK_ORDER' AND source_id=$2::uuid AND movement_type='VENDA' AND reversed_at IS NULL`,
        [scope.companyId,id],
      );
    }

    const updated = await client.query(
      `UPDATE app_live.work_orders
       SET status = $2,
           generate_order = ($2 IN ('PEDIDO', 'VENDA_REALIZADA')),
           sale_date = CASE WHEN $2 = 'VENDA_REALIZADA' THEN CURRENT_DATE ELSE NULL END,
           approved_at = CASE WHEN $2 IN ('PEDIDO','VENDA_REALIZADA') THEN COALESCE(approved_at,now()) ELSE NULL END,
           completed_at = CASE WHEN $2 = 'VENDA_REALIZADA' THEN now() ELSE NULL END,
           financial_generated_at = CASE WHEN $2 = 'VENDA_REALIZADA' THEN now() ELSE NULL END,
           cancelled_at = CASE WHEN $2 = 'CANCELADO' THEN now() ELSE NULL END,
           updated_at = now()
       WHERE id=$1::uuid AND company_id=$3::uuid
       RETURNING id::text, status`,
      [id, body.status,scope.companyId],
    );

    if (!updated.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Ordem não encontrada." }, { status: 404 });
    }

    await client.query(
      `INSERT INTO app_live.audit_log (entity_type,entity_id,action,actor_id,details)
       VALUES ('work_order',$1::uuid,'status_changed',$2::uuid,jsonb_build_object('status',$3::text,'company_id',$4::text))`,
      [id,scope.user?.id??null,body.status,scope.companyId],
    );
    await client.query("COMMIT");
    return NextResponse.json(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    if (error instanceof Error && error.message.startsWith("INSUFFICIENT_STOCK:")) {
      return NextResponse.json({ error: `Estoque insuficiente para ${error.message.slice("INSUFFICIENT_STOCK:".length)}.` }, { status: 409 });
    }
    if (error instanceof Error && error.message === "SALE_HAS_RECEIPTS") {
      return NextResponse.json({ error: "A venda possui recebimentos e não pode ser reaberta ou cancelada antes do estorno financeiro." }, { status: 409 });
    }
    return NextResponse.json({ error: "Não foi possível atualizar a ordem." }, { status: 500 });
  } finally {
    client.release();
  }
}
