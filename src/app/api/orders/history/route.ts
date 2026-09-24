import { NextResponse } from "next/server";
import { getTenantScope } from "@/lib/auth";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const scope = await getTenantScope();
  if (!scope) return NextResponse.json({ error: "Selecione uma empresa." }, { status: 403 });
  const customerId = new URL(request.url).searchParams.get("customerId") ?? "";
  if (!uuid.test(customerId)) return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  try {
    const result = await pool.query(`
      SELECT o.id::text,o.order_number AS number,o.status,o.budget_date::text AS budget_date,
        o.sale_date::text AS sale_date,o.vehicle_plate AS plate,o.vehicle_model AS model,
        o.notes,o.total_value AS total,
        COALESCE(jsonb_agg(jsonb_build_object('name',i.item_name,'type',i.item_type,'quantity',i.quantity)
          ORDER BY i.created_at) FILTER (WHERE i.id IS NOT NULL),'[]'::jsonb) AS items
      FROM app_live.work_orders o
      LEFT JOIN app_live.work_order_items i ON i.work_order_id=o.id
      WHERE o.company_id=$1::uuid AND o.customer_id=$2::uuid AND o.status<>'CANCELADO'
      GROUP BY o.id
      ORDER BY COALESCE(o.sale_date,o.budget_date) DESC NULLS LAST,o.created_at DESC
    `, [scope.companyId,customerId]);
    return NextResponse.json({ orders: result.rows.map((row) => ({
      id: row.id, number: row.number, status: row.status, budgetDate: row.budget_date,
      saleDate: row.sale_date, plate: row.plate, model: row.model, notes: row.notes,
      total: Number(row.total), items: row.items,
    })) });
  } catch (error) {
    console.error("Falha ao carregar histórico do cliente", error);
    return NextResponse.json({ error: "Não foi possível carregar o histórico." }, { status: 500 });
  }
}
