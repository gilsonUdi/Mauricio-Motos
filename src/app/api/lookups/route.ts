import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { OrderLookups } from "@/lib/types";
import { getTenantScope } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const scope = await getTenantScope(); if (!scope) return NextResponse.json({ error: "Selecione uma empresa." }, { status: 403 });

  try {
    const [customers, vehicles, products, mechanics] = await Promise.all([
      pool.query(`SELECT id::text,name,phone,document FROM app_live.customers WHERE company_id=$1::uuid ORDER BY name`,[scope.companyId]),
      pool.query(`SELECT id::text,customer_id::text,plate,description AS model,mileage FROM app_live.vehicles WHERE company_id=$1::uuid ORDER BY plate`,[scope.companyId]),
      pool.query(`SELECT id::text,name,CASE WHEN item_kind='SERVICO' THEN 'Serviço' ELSE COALESCE(type,'Produto') END AS type,COALESCE(sale_price,0) AS sale_price FROM app_live.products WHERE active AND company_id=$1::uuid ORDER BY name`,[scope.companyId]),
      pool.query(`SELECT id::text,name FROM app_live.mechanics WHERE active AND company_id=$1::uuid ORDER BY name`,[scope.companyId]),
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
