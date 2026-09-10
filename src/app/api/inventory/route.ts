import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { uuidPattern } from "@/lib/registries";
import { getTenantScope } from "@/lib/auth";

type AdjustmentInput = { productId?: string; type?: "ENTRADA" | "SAIDA" | "AJUSTE"; quantity?: number; date?: string; partyName?: string };
const validTypes = new Set(["ENTRADA", "SAIDA", "AJUSTE"]);

export async function GET(request: Request) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const scope=await getTenantScope(); if(!scope)return NextResponse.json({error:"Selecione uma empresa."},{status:403});
  const requestedDays = Number(new URL(request.url).searchParams.get("days"));
  const days = Number.isInteger(requestedDays) && requestedDays >= 7 && requestedDays <= 365 ? requestedDays : 90;
  try {
    const [products, movements] = await Promise.all([
      pool.query(`WITH sales AS (
          SELECT i.product_id,SUM(i.quantity) AS sold_quantity,COUNT(DISTINCT o.id)::integer AS order_count
          FROM app_live.work_order_items i JOIN app_live.work_orders o ON o.id=i.work_order_id
          WHERE o.company_id=$1::uuid AND o.status='VENDA_REALIZADA' AND o.sale_date>=CURRENT_DATE-($2::integer-1)
            AND i.product_id IS NOT NULL GROUP BY i.product_id
        ), movements AS (
          SELECT product_id,SUM(CASE WHEN movement_type IN ('VENDA','SAIDA') THEN -ABS(quantity)
            WHEN movement_type IN ('COMPRA','ENTRADA','ESTORNO_VENDA') THEN ABS(quantity)
            WHEN movement_type='AJUSTE' THEN quantity ELSE 0 END) AS net_movement
          FROM app_live.inventory_movements WHERE company_id=$1::uuid AND movement_date>=CURRENT_DATE-($2::integer-1)
            AND reversed_at IS NULL GROUP BY product_id
        )
        SELECT p.id::text,p.name,p.type,p.cost_price,p.sale_price,p.current_stock,p.minimum_stock,p.lead_time_days,p.active,
          COALESCE(s.sold_quantity,0) AS sold_quantity,COALESCE(s.order_count,0) AS order_count,COALESCE(m.net_movement,0) AS net_movement
        FROM app_live.products p LEFT JOIN sales s ON s.product_id=p.id LEFT JOIN movements m ON m.product_id=p.id
        WHERE p.company_id=$1::uuid AND p.item_kind<>'SERVICO' ORDER BY p.active DESC,p.name`,[scope.companyId,days]),
      pool.query(`
        SELECT m.id::text, m.product_id::text, p.name AS product_name, m.movement_date::text AS date,
               m.movement_type AS type, m.quantity, m.party_name, m.balance_after
        FROM app_live.inventory_movements m
        LEFT JOIN app_live.products p ON p.id=m.product_id AND p.company_id=m.company_id
        WHERE m.company_id=$1::uuid
        ORDER BY m.movement_date DESC NULLS LAST, m.created_at DESC
        LIMIT 500`,[scope.companyId]),
    ]);
    const mappedProducts = products.rows.map((row) => {
      const stock=Number(row.current_stock??0);const soldQuantity=Number(row.sold_quantity??0);const dailySales=soldQuantity/days;
      const openingStock=stock-Number(row.net_movement??0);const averageStock=Math.max(0,(Math.max(0,openingStock)+Math.max(0,stock))/2);
      const turnover=averageStock>0?soldQuantity/averageStock:null;const coverageDays=dailySales>0?Math.max(0,stock)/dailySales:null;
      const minimumStock=Number(row.minimum_stock??0);const leadTimeDays=Number(row.lead_time_days??0);
      const health=stock<=0?"RUPTURA":stock<=minimumStock||(coverageDays!==null&&leadTimeDays>0&&coverageDays<=leadTimeDays)?"EMINENTE":soldQuantity<=0?"SEM_GIRO":"SAUDAVEL";
      return { id:row.id,name:row.name,type:row.type,costPrice:Number(row.cost_price??0),salePrice:Number(row.sale_price??0),stock,minimumStock,leadTimeDays,active:row.active,soldQuantity,orderCount:Number(row.order_count??0),turnover,coverageDays,health };
    });
    const active=mappedProducts.filter(product=>product.active);const inventoryCostValue=active.reduce((sum,product)=>sum+Math.max(0,product.stock)*product.costPrice,0);const inventorySaleValue=active.reduce((sum,product)=>sum+Math.max(0,product.stock)*product.salePrice,0);
    return NextResponse.json({
      periodDays:days,
      summary:{inventoryCostValue,inventorySaleValue,projectedMarginAmount:inventorySaleValue-inventoryCostValue,projectedMarginPercent:inventorySaleValue>0?(inventorySaleValue-inventoryCostValue)/inventorySaleValue*100:0,ruptures:active.filter(product=>product.health==="RUPTURA").length,imminent:active.filter(product=>product.health==="EMINENTE").length,noMovement:active.filter(product=>product.health==="SEM_GIRO").length},
      products: mappedProducts,
      movements: movements.rows.map((row) => ({ id: row.id, productId: row.product_id, productName: row.product_name, date: row.date, type: row.type, quantity: Number(row.quantity), partyName: row.party_name, balance: row.balance_after === null ? null : Number(row.balance_after) })),
    });
  } catch (error) {
    console.error("Falha ao carregar estoque", error);
    return NextResponse.json({ error: "Não foi possível carregar o estoque." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const scope=await getTenantScope(); if(!scope)return NextResponse.json({error:"Selecione uma empresa."},{status:403});
  let body: AdjustmentInput;
  try { body = await request.json() as AdjustmentInput; }
  catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }
  if (!body.productId || !uuidPattern.test(body.productId) || !body.type || !validTypes.has(body.type)) {
    return NextResponse.json({ error: "Informe o produto e o tipo de movimentação." }, { status: 400 });
  }
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity < 0 || (body.type !== "AJUSTE" && quantity === 0)) {
    return NextResponse.json({ error: "Informe uma quantidade válida." }, { status: 400 });
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date ?? "") ? body.date : null;
  const partyName = body.partyName?.trim() || "Ajuste manual";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const product = await client.query(`SELECT name,COALESCE(current_stock,0) AS stock FROM app_live.products WHERE id=$1::uuid AND company_id=$2::uuid FOR UPDATE`, [body.productId,scope.companyId]);
    if (!product.rowCount) throw new Error("PRODUCT_NOT_FOUND");
    const oldStock = Number(product.rows[0].stock);
    const newStock = body.type === "ENTRADA" ? oldStock + quantity : body.type === "SAIDA" ? oldStock - quantity : quantity;
    if (newStock < 0) throw new Error("INSUFFICIENT_STOCK");
    const movementQuantity = body.type === "AJUSTE" ? newStock - oldStock : quantity;
    await client.query(`UPDATE app_live.products SET current_stock=$2 WHERE id=$1::uuid`, [body.productId, newStock]);
    const movement = await client.query(
      `INSERT INTO app_live.inventory_movements (company_id,product_id,movement_date,movement_type,quantity,party_name,balance_after)
       VALUES ($1::uuid,$2::uuid,COALESCE($3::date,CURRENT_DATE),$4,$5,$6,$7)
       RETURNING id::text, movement_date::text`,
      [scope.companyId,body.productId, date, body.type, movementQuantity, partyName, newStock],
    );
    await client.query(
      `INSERT INTO app_live.audit_log (entity_type, entity_id, action, actor_id, details)
       VALUES ('inventory_movement', $1::uuid, 'created', $2::uuid, $3::jsonb)`,
      [movement.rows[0].id, scope.user?.id ?? null, JSON.stringify({ productId: body.productId, productName: product.rows[0].name, type: body.type, quantity: movementQuantity, previousBalance: oldStock, balance: newStock, companyId: scope.companyId })],
    );
    await client.query("COMMIT");
    return NextResponse.json({
      product: { id: body.productId, stock: newStock },
      movement: { id: movement.rows[0].id, productId: body.productId, productName: product.rows[0].name, date: movement.rows[0].movement_date, type: body.type, quantity: movementQuantity, partyName, balance: newStock },
    }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Falha ao movimentar estoque", error);
    const known: Record<string, { message: string; status: number }> = {
      PRODUCT_NOT_FOUND: { message: "Produto não encontrado.", status: 404 },
      INSUFFICIENT_STOCK: { message: "A saída é maior que o saldo disponível.", status: 409 },
    };
    const failure = error instanceof Error ? known[error.message] : undefined;
    return NextResponse.json({ error: failure?.message ?? "Não foi possível movimentar o estoque." }, { status: failure?.status ?? 500 });
  } finally {
    client.release();
  }
}
