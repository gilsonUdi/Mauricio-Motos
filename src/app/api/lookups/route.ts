import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { OrderLookups } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });

  try {
    const [customers, vehicles, products, mechanics] = await Promise.all([
      pool.query(`SELECT id::text, name, phone, document FROM app_live.customers ORDER BY name`),
      pool.query(`SELECT id::text, customer_id::text, plate, description AS model, mileage FROM app_live.vehicles ORDER BY plate`),
      pool.query(`SELECT id::text, name, type, COALESCE(sale_price, 0) AS sale_price FROM app_live.products WHERE active ORDER BY name`),
      pool.query(`SELECT id::text, name FROM app_live.mechanics WHERE active ORDER BY name`),
    ]);

    const data: OrderLookups = {
      customers: customers.rows.map((row) => ({
        id: row.id,
        name: row.name,
        phone: row.phone ?? undefined,
        document: row.document ?? undefined,
      })),
      vehicles: vehicles.rows.map((row) => ({
        id: row.id,
        customerId: row.customer_id ?? undefined,
        plate: row.plate,
        model: row.model ?? undefined,
        mileage: row.mileage ?? undefined,
      })),
      products: products.rows.map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type ?? undefined,
        salePrice: Number(row.sale_price ?? 0),
      })),
      mechanics: mechanics.rows.map((row) => ({ id: row.id, name: row.name })),
    };

    return NextResponse.json(data);
  } catch (error) {
    console.error("Falha ao carregar cadastros", error);
    return NextResponse.json({ error: "Não foi possível carregar os cadastros." }, { status: 500 });
  }
}
