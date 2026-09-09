import { NextResponse } from "next/server";
import { getTenantScope } from "@/lib/auth";
import { getPool } from "@/lib/db";
import type { OrderStatus, WorkOrder } from "@/lib/types";

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
    const source = await client.query(
      `SELECT o.*,c.phone AS customer_phone FROM app_live.work_orders o
       LEFT JOIN app_live.customers c ON c.id=o.customer_id
       WHERE o.id=$1::uuid AND o.company_id=$2::uuid FOR SHARE OF o`,
      [id, scope.companyId],
    );
    if (!source.rowCount) throw new Error("ORDER_NOT_FOUND");
    const row = source.rows[0];

    await client.query(`SELECT pg_advisory_xact_lock(hashtext('app_live.work_order_number:' || $1::text || ':' || to_char(CURRENT_DATE, 'YYYYMM')))`, [scope.companyId]);
    const sequence = await client.query(`
      SELECT to_char(CURRENT_DATE, 'YYYYMM') AS prefix, COALESCE(MAX(
        CASE WHEN substring(order_number FROM 7) ~ '^[0-9]+$' THEN substring(order_number FROM 7)::integer ELSE 0 END
      ),0)+1 AS next_number
      FROM app_live.work_orders
      WHERE company_id=$1::uuid AND order_number LIKE to_char(CURRENT_DATE,'YYYYMM') || '%'
    `, [scope.companyId]);
    const orderNumber = `${sequence.rows[0].prefix}${String(sequence.rows[0].next_number).padStart(3, "0")}`;

    const inserted = await client.query(
      `INSERT INTO app_live.work_orders (
        company_id,order_number,customer_id,customer_name,mechanic_id,mechanic_name,budget_date,valid_until,status,
        generate_order,discount_value,total_value,vehicle_plate,vehicle_model,mileage,notes,services_total,
        source_work_order_id,revision_number
      ) VALUES ($1::uuid,$2,$3::uuid,$4,$5::uuid,$6,CURRENT_DATE,CURRENT_DATE+7,'ORCAMENTO',false,$7,$8,$9,$10,$11,$12,$13,$14::uuid,$15)
      RETURNING id::text,budget_date::text,valid_until::text`,
      [scope.companyId,orderNumber,row.customer_id,row.customer_name,row.mechanic_id,row.mechanic_name,row.discount_value,row.total_value,
        row.vehicle_plate,row.vehicle_model,row.mileage,row.notes,row.services_total,id,Number(row.revision_number ?? 1)+1],
    );
    const orderId = inserted.rows[0].id as string;
    const copiedItems = await client.query(
      `INSERT INTO app_live.work_order_items (work_order_id,product_id,item_name,item_type,quantity,unit_price,cost_value,status)
       SELECT $1::uuid,product_id,item_name,item_type,quantity,unit_price,cost_value,status
       FROM app_live.work_order_items WHERE work_order_id=$2::uuid ORDER BY created_at
       RETURNING id::text,product_id::text,item_name,item_type,quantity,unit_price,total_value`,
      [orderId,id],
    );
    await client.query(
      `INSERT INTO app_live.audit_log(entity_type,entity_id,action,actor_id,details)
       VALUES('work_order',$1::uuid,'duplicated',$2::uuid,jsonb_build_object('source_order_id',$3::text,'source_order_number',$4::text,'order_number',$5::text,'revision',$6::integer,'company_id',$7::text))`,
      [orderId,scope.user?.id ?? null,id,row.order_number,orderNumber,Number(row.revision_number ?? 1)+1,scope.companyId],
    );
    await client.query("COMMIT");

    const order: WorkOrder = {
      id: orderId, number: orderNumber, sourceOrderId: id, revisionNumber: Number(row.revision_number ?? 1)+1,
      customerId: row.customer_id ?? undefined, customer: row.customer_name, phone: row.customer_phone ?? undefined, plate: row.vehicle_plate ?? undefined,
      model: row.vehicle_model ?? undefined, mileage: row.mileage ?? undefined, mechanicId: row.mechanic_id ?? undefined,
      mechanic: row.mechanic_name ?? undefined, budgetDate: inserted.rows[0].budget_date, validUntil: inserted.rows[0].valid_until,
      total: Number(row.total_value ?? 0), discount: Number(row.discount_value ?? 0), status: "ORCAMENTO" as OrderStatus,
      notes: row.notes ?? undefined,
      items: copiedItems.rows.map((item) => ({ id:item.id,productId:item.product_id ?? undefined,name:item.item_name,type:item.item_type,
        quantity:Number(item.quantity),unitPrice:Number(item.unit_price),total:Number(item.total_value) })),
    };
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Falha ao duplicar orçamento", error);
    return NextResponse.json({ error:error instanceof Error && error.message === "ORDER_NOT_FOUND" ? "Orçamento não encontrado." : "Não foi possível criar uma nova versão do orçamento." }, { status:error instanceof Error && error.message === "ORDER_NOT_FOUND" ? 404 : 500 });
  } finally {
    client.release();
  }
}
