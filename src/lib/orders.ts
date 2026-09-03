import { fixtureOrders } from "./fixtures";
import { getPool } from "./db";
import type { DashboardData, OrderStatus, WorkOrder } from "./types";

type OrderRow = {
  id: string;
  number: string;
  customer: string;
  phone: string | null;
  plate: string | null;
  model: string | null;
  mileage: number | null;
  mechanic: string | null;
  budget_date: string | null;
  sale_date: string | null;
  total: string | number;
  status: OrderStatus;
  payment_method: string | null;
  notes: string | null;
  items: Array<{ id: string; name: string; type: string; quantity: number; unitPrice: number; total: number }> | null;
};

export async function getDashboardData(): Promise<DashboardData> {
  const pool = getPool();
  if (!pool) return { connected: false, orders: fixtureOrders };

  try {
    const result = await pool.query<OrderRow>(`
      SELECT
        o.id::text,
        o.order_number AS number,
        o.customer_name AS customer,
        c.phone,
        o.vehicle_plate AS plate,
        o.vehicle_model AS model,
        o.mileage,
        o.mechanic_name AS mechanic,
        o.budget_date::text,
        o.sale_date::text,
        o.total_value AS total,
        o.status,
        o.payment_method,
        o.notes,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', i.id::text,
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
      LEFT JOIN app_live.customers c ON c.id = o.customer_id
      LEFT JOIN app_live.work_order_items i ON i.work_order_id = o.id
      GROUP BY o.id, c.phone
      ORDER BY COALESCE(o.sale_date, o.budget_date) DESC NULLS LAST, o.created_at DESC
      LIMIT 150
    `);

    const orders: WorkOrder[] = result.rows.map((row) => ({
      id: row.id,
      number: row.number,
      customer: row.customer,
      phone: row.phone ?? undefined,
      plate: row.plate ?? undefined,
      model: row.model ?? undefined,
      mileage: row.mileage ?? undefined,
      mechanic: row.mechanic ?? undefined,
      budgetDate: row.budget_date ?? undefined,
      saleDate: row.sale_date ?? undefined,
      total: Number(row.total ?? 0),
      status: row.status,
      paymentMethod: row.payment_method ?? undefined,
      notes: row.notes ?? undefined,
      items: row.items ?? [],
    }));

    return { connected: true, orders };
  } catch (error) {
    console.error("Falha ao carregar ordens do PostgreSQL", error);
    return { connected: false, orders: fixtureOrders };
  }
}
