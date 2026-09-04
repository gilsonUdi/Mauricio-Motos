import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { uuidPattern } from "@/lib/registries";

type AdjustmentInput = { productId?: string; type?: "ENTRADA" | "SAIDA" | "AJUSTE"; quantity?: number; date?: string; partyName?: string };
const validTypes = new Set(["ENTRADA", "SAIDA", "AJUSTE"]);

export async function GET() {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  try {
    const [products, movements] = await Promise.all([
      pool.query(`SELECT id::text, name, type, cost_price, sale_price, current_stock, active FROM app_live.products WHERE lower(COALESCE(type, '')) NOT LIKE '%serv%' ORDER BY active DESC, name`),
      pool.query(`
        SELECT m.id::text, m.product_id::text, p.name AS product_name, m.movement_date::text AS date,
               m.movement_type AS type, m.quantity, m.party_name, m.balance_after
        FROM app_live.inventory_movements m
        LEFT JOIN app_live.products p ON p.id = m.product_id
        ORDER BY m.movement_date DESC NULLS LAST, m.created_at DESC
        LIMIT 500`),
    ]);
    return NextResponse.json({
      products: products.rows.map((row) => ({ id: row.id, name: row.name, type: row.type, costPrice: Number(row.cost_price ?? 0), salePrice: Number(row.sale_price ?? 0), stock: Number(row.current_stock ?? 0), active: row.active })),
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
    const product = await client.query(`SELECT name, COALESCE(current_stock, 0) AS stock FROM app_live.products WHERE id=$1::uuid FOR UPDATE`, [body.productId]);
    if (!product.rowCount) throw new Error("PRODUCT_NOT_FOUND");
    const oldStock = Number(product.rows[0].stock);
    const newStock = body.type === "ENTRADA" ? oldStock + quantity : body.type === "SAIDA" ? oldStock - quantity : quantity;
    if (newStock < 0) throw new Error("INSUFFICIENT_STOCK");
    const movementQuantity = body.type === "AJUSTE" ? newStock - oldStock : quantity;
    await client.query(`UPDATE app_live.products SET current_stock=$2 WHERE id=$1::uuid`, [body.productId, newStock]);
    const movement = await client.query(
      `INSERT INTO app_live.inventory_movements (product_id, movement_date, movement_type, quantity, party_name, balance_after)
       VALUES ($1::uuid, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6)
       RETURNING id::text, movement_date::text`,
      [body.productId, date, body.type, movementQuantity, partyName, newStock],
    );
    await client.query(
      `INSERT INTO app_live.audit_log (entity_type, entity_id, action, details)
       VALUES ('inventory_movement', $1::uuid, 'created', $2::jsonb)`,
      [movement.rows[0].id, JSON.stringify({ productId: body.productId, productName: product.rows[0].name, type: body.type, quantity: movementQuantity, previousBalance: oldStock, balance: newStock })],
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
