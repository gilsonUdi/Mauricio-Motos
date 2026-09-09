import { fixtureOrders } from "./fixtures";
import { getPool } from "./db";
import type { DashboardData, OrderStatus, WorkOrder } from "./types";

type OrderRow = {
  id: string;
  number: string;
  source_work_order_id: string | null;
  revision_number: number | null;
  customer_id: string | null;
  customer: string;
  phone: string | null;
  plate: string | null;
  model: string | null;
  mileage: number | null;
  mechanic: string | null;
  mechanic_id: string | null;
  budget_date: string | null;
  valid_until: string | null;
  sale_date: string | null;
  total: string | number;
  discount: string | number;
  status: OrderStatus;
  payment_method: string | null;
  approved_at: string | null;
  approved_by_customer: string | null;
  approval_method: string | null;
  approval_notes: string | null;
  last_shared_at: string | null;
  share_count: number | null;
  last_follow_up_at: string | null;
  next_follow_up_at: string | null;
  follow_up_count: number | null;
  notes: string | null;
  items: Array<{ id: string; productId?: string; name: string; type: string; quantity: number; unitPrice: number; total: number }> | null;
};

export async function getDashboardData(companyId: string): Promise<DashboardData> {
  const pool = getPool();
  if (!pool) return { connected: false, orders: fixtureOrders };

  try {
    const result = await pool.query<OrderRow>(`
      SELECT
        o.id::text,
        o.order_number AS number,
        o.source_work_order_id::text,
        o.revision_number,
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
        o.approved_at,
        o.approved_by_customer,
        o.approval_method,
        o.approval_notes,
        o.last_shared_at,
        o.share_count,
        o.last_follow_up_at,
        o.next_follow_up_at,
        o.follow_up_count,
        o.notes,
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
      LEFT JOIN app_live.customers c ON c.id = o.customer_id
      LEFT JOIN app_live.work_order_items i ON i.work_order_id = o.id
      WHERE o.company_id = $1::uuid
      GROUP BY o.id, c.phone
      ORDER BY COALESCE(o.sale_date, o.budget_date) DESC NULLS LAST, o.created_at DESC
      LIMIT 150
    `, [companyId]);

    const orders: WorkOrder[] = result.rows.map((row) => ({
      id: row.id,
      number: row.number,
      sourceOrderId: row.source_work_order_id ?? undefined,
      revisionNumber: Number(row.revision_number ?? 1),
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
      total: Number(row.total ?? 0),
      discount: Number(row.discount ?? 0),
      status: row.status,
      paymentMethod: row.payment_method ?? undefined,
      approvedAt: row.approved_at ?? undefined,
      approvedByCustomer: row.approved_by_customer ?? undefined,
      approvalMethod: row.approval_method ?? undefined,
      approvalNotes: row.approval_notes ?? undefined,
      lastSharedAt: row.last_shared_at ?? undefined,
      shareCount: Number(row.share_count ?? 0),
      lastFollowUpAt: row.last_follow_up_at ?? undefined,
      nextFollowUpAt: row.next_follow_up_at ?? undefined,
      followUpCount: Number(row.follow_up_count ?? 0),
      notes: row.notes ?? undefined,
      items: row.items ?? [],
    }));

    return { connected: true, orders };
  } catch (error) {
    console.error("Falha ao carregar ordens do PostgreSQL", error);
    return { connected: false, orders: fixtureOrders };
  }
}
