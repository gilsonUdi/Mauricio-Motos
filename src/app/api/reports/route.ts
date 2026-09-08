import { NextResponse } from "next/server";
import { getTenantScope } from "@/lib/auth";
import { getPool } from "@/lib/db";

const reportTypes = new Set(["sales", "vehicles", "purchases"]);
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const scope = await getTenantScope();
  if (!scope) return NextResponse.json({ error: "Selecione uma empresa." }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const report = params.get("report") ?? "sales";
  if (!reportTypes.has(report)) return NextResponse.json({ error: "Relatório inválido." }, { status: 400 });
  const from = isoDate.test(params.get("from") ?? "") ? params.get("from") : null;
  const to = isoDate.test(params.get("to") ?? "") ? params.get("to") : null;
  if (from && to && from > to) return NextResponse.json({ error: "A data inicial deve ser anterior à data final." }, { status: 400 });
  const search = (params.get("search") ?? "").trim().slice(0, 100);

  try {
    if (report === "sales") {
      const result = await pool.query(`
        SELECT o.id::text,o.order_number,o.sale_date::text,o.customer_name,o.vehicle_plate,o.vehicle_model,
               o.mechanic_name,o.payment_method,o.total_value,o.discount_value,
               COUNT(i.id)::integer AS item_count,COALESCE(SUM(i.quantity),0) AS quantity,
               COALESCE(jsonb_agg(jsonb_build_object('name',i.item_name,'type',i.item_type,'quantity',i.quantity,'unitPrice',i.unit_price,'total',i.total_value) ORDER BY i.created_at) FILTER (WHERE i.id IS NOT NULL),'[]'::jsonb) AS items
        FROM app_live.work_orders o
        LEFT JOIN app_live.work_order_items i ON i.work_order_id=o.id
        WHERE o.company_id=$1::uuid AND o.status='VENDA_REALIZADA'
          AND ($2::date IS NULL OR o.sale_date >= $2::date)
          AND ($3::date IS NULL OR o.sale_date <= $3::date)
          AND ($4::text='' OR o.order_number ILIKE '%'||$4||'%' OR o.customer_name ILIKE '%'||$4||'%'
            OR COALESCE(o.vehicle_plate,'') ILIKE '%'||$4||'%' OR COALESCE(o.vehicle_model,'') ILIKE '%'||$4||'%')
        GROUP BY o.id ORDER BY o.sale_date DESC NULLS LAST,o.created_at DESC LIMIT 1000`, [scope.companyId, from, to, search]);
      const rows = result.rows.map(row => ({ id:row.id,number:row.order_number,date:row.sale_date,customer:row.customer_name,plate:row.vehicle_plate,model:row.vehicle_model,mechanic:row.mechanic_name,paymentMethod:row.payment_method,total:Number(row.total_value),discount:Number(row.discount_value),itemCount:Number(row.item_count),quantity:Number(row.quantity),items:row.items }));
      return NextResponse.json({ report, rows, summary:{ count:rows.length,total:rows.reduce((sum,row)=>sum+row.total,0),discount:rows.reduce((sum,row)=>sum+row.discount,0),quantity:rows.reduce((sum,row)=>sum+row.quantity,0) } });
    }

    if (report === "vehicles") {
      const result = await pool.query(`
        SELECT o.id::text,o.order_number,COALESCE(o.sale_date,o.budget_date)::text AS event_date,o.status,
               o.customer_name,o.vehicle_plate,o.vehicle_model,o.mileage,o.mechanic_name,o.notes,o.total_value,
               COUNT(i.id)::integer AS item_count,
               COALESCE(jsonb_agg(jsonb_build_object('name',i.item_name,'type',i.item_type,'quantity',i.quantity,'unitPrice',i.unit_price,'total',i.total_value) ORDER BY i.created_at) FILTER (WHERE i.id IS NOT NULL),'[]'::jsonb) AS items
        FROM app_live.work_orders o
        LEFT JOIN app_live.work_order_items i ON i.work_order_id=o.id
        WHERE o.company_id=$1::uuid AND o.status IN ('PEDIDO','VENDA_REALIZADA')
          AND NULLIF(TRIM(COALESCE(o.vehicle_plate,'')),'') IS NOT NULL
          AND ($2::date IS NULL OR COALESCE(o.sale_date,o.budget_date) >= $2::date)
          AND ($3::date IS NULL OR COALESCE(o.sale_date,o.budget_date) <= $3::date)
          AND ($4::text='' OR o.order_number ILIKE '%'||$4||'%' OR o.customer_name ILIKE '%'||$4||'%'
            OR COALESCE(o.vehicle_plate,'') ILIKE '%'||$4||'%' OR COALESCE(o.vehicle_model,'') ILIKE '%'||$4||'%')
        GROUP BY o.id ORDER BY event_date DESC NULLS LAST,o.created_at DESC LIMIT 1000`, [scope.companyId, from, to, search]);
      const rows = result.rows.map(row => ({ id:row.id,number:row.order_number,date:row.event_date,status:row.status,customer:row.customer_name,plate:row.vehicle_plate,model:row.vehicle_model,mileage:row.mileage == null ? null : Number(row.mileage),mechanic:row.mechanic_name,notes:row.notes,total:Number(row.total_value),itemCount:Number(row.item_count),items:row.items }));
      return NextResponse.json({ report, rows, summary:{ count:rows.length,vehicles:new Set(rows.map(row=>String(row.plate).replace(/[^A-Z0-9]/gi,""))).size,total:rows.reduce((sum,row)=>sum+row.total,0),items:rows.reduce((sum,row)=>sum+row.itemCount,0) } });
    }

    const result = await pool.query(`
      SELECT p.id::text,p.issue_date::text,p.competence_date::text,p.supplier_name,p.document_number,p.status,p.total_amount,
             COUNT(i.id)::integer AS item_count,COALESCE(SUM(i.quantity),0) AS quantity,
             COALESCE(jsonb_agg(jsonb_build_object('name',pr.name,'quantity',i.quantity,'unitCost',i.unit_cost,'total',i.total_amount) ORDER BY i.created_at) FILTER (WHERE i.id IS NOT NULL),'[]'::jsonb) AS items
      FROM app_live.purchases p
      LEFT JOIN app_live.purchase_items i ON i.purchase_id=p.id
      LEFT JOIN app_live.products pr ON pr.id=i.product_id
      WHERE p.company_id=$1::uuid AND p.status<>'CANCELADA'
        AND ($2::date IS NULL OR p.issue_date >= $2::date)
        AND ($3::date IS NULL OR p.issue_date <= $3::date)
        AND ($4::text='' OR p.supplier_name ILIKE '%'||$4||'%' OR COALESCE(p.document_number,'') ILIKE '%'||$4||'%'
          OR EXISTS (SELECT 1 FROM app_live.purchase_items matched_item JOIN app_live.products matched_product ON matched_product.id=matched_item.product_id WHERE matched_item.purchase_id=p.id AND matched_product.name ILIKE '%'||$4||'%'))
      GROUP BY p.id ORDER BY p.issue_date DESC,p.created_at DESC LIMIT 1000`, [scope.companyId, from, to, search]);
    const rows = result.rows.map(row => ({ id:row.id,date:row.issue_date,competenceDate:row.competence_date,supplier:row.supplier_name,documentNumber:row.document_number,status:row.status,total:Number(row.total_amount),itemCount:Number(row.item_count),quantity:Number(row.quantity),items:row.items }));
    return NextResponse.json({ report, rows, summary:{ count:rows.length,total:rows.reduce((sum,row)=>sum+row.total,0),items:rows.reduce((sum,row)=>sum+row.itemCount,0),quantity:rows.reduce((sum,row)=>sum+row.quantity,0) } });
  } catch (error) {
    console.error("Falha ao gerar relatório", error);
    return NextResponse.json({ error: "Não foi possível gerar o relatório solicitado." }, { status: 500 });
  }
}
