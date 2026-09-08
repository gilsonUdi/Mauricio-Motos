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
        SELECT * FROM (
          SELECT p.id::text, p.issue_date::text AS date, p.supplier_name AS supplier,
                 p.total_amount AS total, COUNT(i.id)::integer AS item_count,
                 COALESCE(SUM(i.quantity),0) AS total_quantity, p.created_at
          FROM app_live.purchases p
          LEFT JOIN app_live.purchase_items i ON i.purchase_id=p.id
          WHERE p.company_id=$1::uuid AND p.status<>'CANCELADA'
          GROUP BY p.id
          UNION ALL
          SELECT f.id::text, f.transaction_date::text, f.description, f.amount,
                 COUNT(m.id)::integer, COALESCE(SUM(m.quantity),0), f.created_at
          FROM app_live.financial_transactions f
          LEFT JOIN app_live.inventory_movements m ON m.legacy_movement_key LIKE f.legacy_finance_key || ':%'
          WHERE f.account_type='COMPRA_ESTOQUE' AND f.company_id=$1::uuid
            AND NOT EXISTS (SELECT 1 FROM app_live.purchases p WHERE p.company_id=f.company_id AND p.legacy_purchase_key=f.legacy_finance_key)
          GROUP BY f.id
        ) history ORDER BY date DESC NULLS LAST, created_at DESC LIMIT 500`,[scope.companyId]),
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
    const total = money(items.reduce((sum, [, item]) => sum + item.quantity * item.unitCost, 0));
    const purchase = await client.query(
      `INSERT INTO app_live.purchases
       (company_id,supplier_name,issue_date,competence_date,total_amount,status,legacy_purchase_key)
       VALUES ($1::uuid,$2,COALESCE($3::date,CURRENT_DATE),COALESCE($3::date,CURRENT_DATE),$4,'CONFIRMADA',$5)
       RETURNING id::text,issue_date::text`,
      [scope.companyId,supplier,date,total,purchaseKey],
    );
    const purchaseId = purchase.rows[0].id as string;
    const prepared: Array<{ productId: string; name: string; quantity: number; unitCost: number; balance: number; previousStock: number; previousCost: number; averageCost: number }> = [];
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
      prepared.push({ productId, name: product.rows[0].name, quantity: item.quantity, unitCost: item.unitCost, balance, previousStock: currentStock, previousCost: currentCost, averageCost });
    }

    for (let index = 0; index < prepared.length; index += 1) {
      const item = prepared[index];
      await client.query(
        `INSERT INTO app_live.purchase_items
         (purchase_id,product_id,quantity,unit_cost,previous_average_cost,average_cost_after,total_amount)
         VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7)`,
        [purchaseId,item.productId,item.quantity,item.unitCost,item.previousCost,item.averageCost,money(item.quantity*item.unitCost)],
      );
      await client.query(
        `INSERT INTO app_live.inventory_movements
         (company_id,legacy_movement_key,product_id,movement_date,movement_type,quantity,party_name,balance_after,unit_cost,total_cost,movement_reason,affects_sales_metrics,source_type,source_id)
         VALUES ($1::uuid,$2,$3::uuid,COALESCE($4::date,CURRENT_DATE),'COMPRA',$5,$6,$7,$8,$9,'ENTRADA_COMPRA',false,'PURCHASE',$10::uuid)`,
        [scope.companyId,`${purchaseKey}:${index + 1}`, item.productId, date, item.quantity, supplier, item.balance,item.unitCost,money(item.quantity*item.unitCost),purchaseId],
      );
      await client.query(
        `INSERT INTO app_live.inventory_cost_history
         (company_id,product_id,purchase_id,effective_date,previous_stock,incoming_quantity,previous_average_cost,incoming_unit_cost,new_average_cost)
         VALUES ($1::uuid,$2::uuid,$3::uuid,COALESCE($4::date,CURRENT_DATE),$5,$6,$7,$8,$9)`,
        [scope.companyId,item.productId,purchaseId,date,item.previousStock,item.quantity,item.previousCost,item.unitCost,item.averageCost],
      );
    }
    const category = await client.query(
      `SELECT id FROM app_live.financial_categories WHERE company_id=$1::uuid AND system_code='INVENTORY_PURCHASE' LIMIT 1`,
      [scope.companyId],
    );
    await client.query(
      `INSERT INTO app_live.accounts_payable
       (company_id,purchase_id,category_id,description,issue_date,competence_date,due_date,original_amount,open_amount,status,notes)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,COALESCE($5::date,CURRENT_DATE),COALESCE($5::date,CURRENT_DATE),COALESCE($5::date,CURRENT_DATE),$6,$6,'PENDENTE','Gerado automaticamente pela compra de estoque')`,
      [scope.companyId,purchaseId,category.rows[0]?.id??null,`Compra de estoque - ${supplier}`,date,total],
    );
    await client.query(
      `INSERT INTO app_live.financial_events
       (company_id,event_key,event_type,source_type,source_id,category_id,competence_date,description,amount,affects_drg)
       VALUES ($1::uuid,$2,'DESPESA','PURCHASE',$3::uuid,$4::uuid,COALESCE($5::date,CURRENT_DATE),$6,$7,false)`,
      [scope.companyId,`${purchaseKey}:obligation`,purchaseId,category.rows[0]?.id??null,date,`Compra de estoque - ${supplier}`,total],
    );
    await client.query(
      `INSERT INTO app_live.audit_log (entity_type, entity_id, action,actor_id,details)
       VALUES ('purchase', $1::uuid, 'created',$2::uuid,$3::jsonb)`,
      [purchaseId,scope.user?.id??null,JSON.stringify({ supplier, total, payableGenerated: true, items: prepared.map(({ productId, name, quantity, unitCost, previousCost, averageCost }) => ({ productId, name, quantity, unitCost, previousCost, averageCost })) })],
    );
    await client.query("COMMIT");
    return NextResponse.json({
      id: purchaseId, date: purchase.rows[0].issue_date, supplier, total,
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
