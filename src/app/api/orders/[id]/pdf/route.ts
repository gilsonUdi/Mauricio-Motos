import { NextResponse } from "next/server";
import { getTenantScope } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { fixtureOrders } from "@/lib/fixtures";
import { createOrderPdf } from "@/lib/order-pdf";
import type { OrderStatus, WorkOrder } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fileName(number: string) {
  const safeNumber = String(number || "orcamento").replace(/[^a-zA-Z0-9_-]/g, "-");
  return `orcamento-${safeNumber}.pdf`;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const pool = getPool();

  try {
    let order: WorkOrder | undefined;
    let companyName = "Maurício Motos";

    if (!pool) {
      order = fixtureOrders.find((item) => item.id === id);
    } else {
      const scope = await getTenantScope();
      if (!scope) return NextResponse.json({ error: "Selecione uma empresa." }, { status: 403 });
      if (!uuidPattern.test(id)) return NextResponse.json({ error: "Orçamento inválido." }, { status: 400 });

      const result = await pool.query(`
        SELECT
          o.id::text,
          o.order_number AS number,
          o.customer_id::text,
          o.customer_name AS customer,
          c.phone,
          o.vehicle_plate AS plate,
          o.vehicle_model AS model,
          o.mileage,
          o.mechanic_name AS mechanic,
          o.mechanic_id::text,
          o.budget_date::text,
          o.valid_until::text,
          o.sale_date::text,
          o.total_value AS total,
          o.discount_value AS discount,
          o.status,
          o.payment_method,
          o.notes,
          co.name AS company_name,
          COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'id', i.id::text,
                'productId', i.product_id::text,
                'name', i.item_name,
                'type', i.item_type,
                'quantity', i.quantity,
                'unitPrice', i.unit_price,
                'total', i.total_value
              ) ORDER BY i.created_at
            ) FILTER (WHERE i.id IS NOT NULL),
            '[]'::jsonb
          ) AS items
        FROM app_live.work_orders o
        JOIN app_live.companies co ON co.id = o.company_id
        LEFT JOIN app_live.customers c ON c.id = o.customer_id
        LEFT JOIN app_live.work_order_items i ON i.work_order_id = o.id
        WHERE o.id = $1::uuid AND o.company_id = $2::uuid
        GROUP BY o.id, c.phone, co.name
      `, [id, scope.companyId]);

      if (result.rowCount) {
        const row = result.rows[0];
        companyName = row.company_name || scope.user?.companyName || companyName;
        order = {
          id: row.id,
          number: row.number,
          customerId: row.customer_id ?? undefined,
          customer: row.customer,
          phone: row.phone ?? undefined,
          plate: row.plate ?? undefined,
          model: row.model ?? undefined,
          mileage: row.mileage ?? undefined,
          mechanic: row.mechanic ?? undefined,
          mechanicId: row.mechanic_id ?? undefined,
          budgetDate: row.budget_date ?? undefined,
          validUntil: row.valid_until ?? undefined,
          saleDate: row.sale_date ?? undefined,
          total: Number(row.total || 0),
          discount: Number(row.discount || 0),
          status: row.status as OrderStatus,
          paymentMethod: row.payment_method ?? undefined,
          notes: row.notes ?? undefined,
          items: (row.items || []).map((item: Record<string, unknown>) => ({
            id: String(item.id || ""),
            productId: item.productId ? String(item.productId) : undefined,
            name: String(item.name || "Item"),
            type: String(item.type || "Item"),
            quantity: Number(item.quantity || 0),
            unitPrice: Number(item.unitPrice || 0),
            total: Number(item.total || 0),
          })),
        };
      }
    }

    if (!order) return NextResponse.json({ error: "Orçamento não encontrado." }, { status: 404 });

    const pdf = await createOrderPdf({ order, companyName });
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName(order.number)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Falha ao gerar PDF do orçamento", error);
    return NextResponse.json({ error: "Não foi possível gerar o PDF do orçamento." }, { status: 500 });
  }
}
