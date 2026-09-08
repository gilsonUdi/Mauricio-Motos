import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { uuidPattern } from "@/lib/registries";
import { getTenantScope } from "@/lib/auth";

type PurchaseItem = { productId?: string; quantity?: number; unitCost?: number };
type PurchaseInput = { supplier?: string; date?: string; items?: PurchaseItem[] };

const money = (value: unknown) => Math.round(Math.max(0, Number(value) || 0) * 100) / 100;
const validDate = (value?: string) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value : null;

export async function GET() {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const scope=await getTenantScope(); if(!scope)return NextResponse.json({error:"Selecione uma empresa."},{status:403});
  try {
    const [purchases, products] = await Promise.all([
      pool.query(`
        SELECT f.id::text, f.transaction_date::text AS date, f.description AS supplier,
               f.amount AS total, COUNT(m.id)::integer AS item_count,
               COALESCE(SUM(m.quantity), 0) AS total_quantity, f.created_at
        FROM app_live.financial_transactions f
        LEFT JOIN app_live.inventory_movements m
          ON m.legacy_movement_key LIKE f.legacy_finance_key || ':%'
        WHERE f.account_type='COMPRA_ESTOQUE' AND f.company_id=$1::uuid
        GROUP BY f.id
        ORDER BY f.transaction_date DESC NULLS LAST, f.created_at DESC
        LIMIT 500`,[scope.companyId]),
      pool.query(`SELECT id::text,name,type,cost_price,current_stock FROM app_live.products WHERE active AND company_id=$1::uuid AND lower(COALESCE(type,'')) NOT LIKE '%serv%' ORDER BY name`,[scope.companyId]),
    ]);
    return NextResponse.json({
      purchases: purchases.rows.map((row) => ({
        id: row.id, date: row.date, supplier: row.supplier, total: Number(row.total),
        itemCount: Number(row.item_count), totalQuantity: Number(row.total_quantity),
      })),
      products: products.rows.map((row) => ({
        id: row.id, name: row.name, type: row.type, costPrice: Number(row.cost_price ?? 0), stock: Number(row.current_stock ?? 0),
      })),
    });
  } catch (error) {
    console.error("Falha ao carregar compras", error);
    return NextResponse.json({ error: "Não foi possível carregar as compras." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const scope=await getTenantScope(); if(!scope)return NextResponse.json({error:"Selecione uma empresa."},{status:403});
  let body: PurchaseInput;
  try { body = await request.json() as PurchaseInput; }
  catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }

  const supplier = body.supplier?.trim();
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!supplier) return NextResponse.json({ error: "Informe o fornecedor." }, { status: 400 });
  if (!rawItems.length) return NextResponse.json({ error: "Inclua ao menos um produto." }, { status: 400 });
  if (rawItems.some((item) => !item.productId || !uuidPattern.test(item.productId) || Number(item.quantity) <= 0)) {
    return NextResponse.json({ error: "Revise os produtos e as quantidades informadas." }, { status: 400 });
  }

  const grouped = new Map<string, { quantity: number; totalCost: number }>();
  for (const item of rawItems) {
    const productId = item.productId!;
    const previous = grouped.get(productId);
    const quantity = Number(item.quantity);
    const unitCost = money(item.unitCost);
    grouped.set(productId, previous
      ? { quantity: previous.quantity + quantity, totalCost: previous.totalCost + quantity * unitCost }
      : { quantity, totalCost: quantity * unitCost });
  }
  const items = [...grouped.entries()]
    .map(([productId, item]) => [productId, { quantity: item.quantity, unitCost: money(item.totalCost / item.quantity) }] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  const purchaseKey = `purchase:${randomUUID()}`;
  const date = validDate(body.date);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prepared: Array<{ productId: string; name: string; quantity: number; unitCost: number; balance: number }> = [];
    for (const [productId, item] of items) {
      const product = await client.query(
        `SELECT name, COALESCE(cost_price, 0) AS cost_price, COALESCE(sale_price, 0) AS sale_price,
                COALESCE(current_stock, 0) AS current_stock
         FROM app_live.products WHERE id=$1::uuid AND active AND company_id=$2::uuid FOR UPDATE`,
        [productId,scope.companyId],
      );
      if (!product.rowCount) throw new Error("PRODUCT_NOT_FOUND");
      const currentStock = Number(product.rows[0].current_stock);
      const currentCost = Number(product.rows[0].cost_price);
      const positiveStock = Math.max(0, currentStock);
      const balance = currentStock + item.quantity;
      const averageCost = money((positiveStock * currentCost + item.quantity * item.unitCost) / (positiveStock + item.quantity));
      await client.query(
        `UPDATE app_live.products
         SET current_stock = $2, cost_price = $3,
             profit_margin_percent = CASE WHEN $3 > 0 THEN ((COALESCE(sale_price, 0) - $3) / $3) * 100 ELSE 0 END
         WHERE id = $1::uuid`,
        [productId, balance, averageCost],
      );
      prepared.push({ productId, name: product.rows[0].name, quantity: item.quantity, unitCost: item.unitCost, balance });
    }

    const total = money(prepared.reduce((sum, item) => sum + item.quantity * item.unitCost, 0));
    const finance = await client.query(
      `INSERT INTO app_live.financial_transactions
       (company_id,legacy_finance_key,transaction_date,description,movement,account_type,account_group,amount)
       VALUES ($1::uuid,$2,COALESCE($3::date,CURRENT_DATE),$4,'SAIDA','COMPRA_ESTOQUE','ESTOQUE',$5)
       RETURNING id::text, transaction_date::text`,
      [scope.companyId,purchaseKey,date,supplier,total],
    );
    for (let index = 0; index < prepared.length; index += 1) {
      const item = prepared[index];
      await client.query(
        `INSERT INTO app_live.inventory_movements
         (company_id,legacy_movement_key,product_id,movement_date,movement_type,quantity,party_name,balance_after)
         VALUES ($1::uuid,$2,$3::uuid,COALESCE($4::date,CURRENT_DATE),'COMPRA',$5,$6,$7)`,
        [scope.companyId,`${purchaseKey}:${index + 1}`, item.productId, date, item.quantity, supplier, item.balance],
      );
    }
    await client.query(
      `INSERT INTO app_live.audit_log (entity_type, entity_id, action, details)
       VALUES ('purchase', $1::uuid, 'created', $2::jsonb)`,
      [finance.rows[0].id, JSON.stringify({ supplier, total, items: prepared.map(({ productId, name, quantity, unitCost }) => ({ productId, name, quantity, unitCost })) })],
    );
    await client.query("COMMIT");
    return NextResponse.json({
      id: finance.rows[0].id, date: finance.rows[0].transaction_date, supplier, total,
      itemCount: prepared.length, totalQuantity: prepared.reduce((sum, item) => sum + item.quantity, 0),
    }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Falha ao registrar compra", error);
    const message = error instanceof Error && error.message === "PRODUCT_NOT_FOUND" ? "Um dos produtos não foi encontrado ou está inativo." : "Não foi possível registrar a compra.";
    return NextResponse.json({ error: message }, { status: error instanceof Error && error.message === "PRODUCT_NOT_FOUND" ? 400 : 500 });
  } finally {
    client.release();
  }
}
