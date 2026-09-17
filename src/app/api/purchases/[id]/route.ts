import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getTenantScope } from "@/lib/auth";
import { uuidPattern } from "@/lib/registries";

type PurchaseAction = { action?: "CANCEL" };

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const pool = getPool();
  if (!pool)
    return NextResponse.json(
      { error: "Banco não configurado." },
      { status: 503 },
    );
  const scope = await getTenantScope();
  if (!scope)
    return NextResponse.json(
      { error: "Selecione uma empresa." },
      { status: 403 },
    );

  const { id } = await context.params;
  if (!uuidPattern.test(id))
    return NextResponse.json({ error: "Compra inválida." }, { status: 400 });

  let body: PurchaseAction;
  try {
    body = (await request.json()) as PurchaseAction;
  } catch {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }
  if (body.action !== "CANCEL")
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const purchase = await client.query(
      `SELECT id::text,supplier_name,total_amount,status,created_at
       FROM app_live.purchases
       WHERE id=$1::uuid AND company_id=$2::uuid
       FOR UPDATE`,
      [id, scope.companyId],
    );
    if (!purchase.rowCount) throw new Error("NOT_FOUND");
    if (purchase.rows[0].status === "CANCELADA")
      throw new Error("ALREADY_CANCELLED");
    if (purchase.rows[0].status !== "CONFIRMADA")
      throw new Error("INVALID_STATUS");

    const activePayments = await client.query(
      `SELECT 1
       FROM app_live.accounts_payable a
       JOIN app_live.payable_payments p ON p.payable_id=a.id
       WHERE a.purchase_id=$1::uuid AND a.company_id=$2::uuid
         AND p.reversed_at IS NULL
       LIMIT 1`,
      [id, scope.companyId],
    );
    if (activePayments.rowCount) throw new Error("PURCHASE_HAS_PAYMENTS");

    const items = await client.query(
      `SELECT i.product_id::text,p.name,i.quantity,
              h.previous_stock,h.previous_average_cost,
              m.created_at AS movement_created_at
       FROM app_live.purchase_items i
       JOIN app_live.products p ON p.id=i.product_id AND p.company_id=$2::uuid
       LEFT JOIN LATERAL (
         SELECT previous_stock,previous_average_cost
         FROM app_live.inventory_cost_history
         WHERE purchase_id=$1::uuid AND product_id=i.product_id
         ORDER BY created_at DESC LIMIT 1
       ) h ON true
       LEFT JOIN LATERAL (
         SELECT created_at
         FROM app_live.inventory_movements
         WHERE company_id=$2::uuid AND source_type='PURCHASE'
           AND source_id=$1::uuid AND product_id=i.product_id
           AND reversed_at IS NULL
         ORDER BY created_at DESC LIMIT 1
       ) m ON true
       WHERE i.purchase_id=$1::uuid
       ORDER BY i.product_id`,
      [id, scope.companyId],
    );
    if (!items.rowCount) throw new Error("PURCHASE_WITHOUT_ITEMS");
    if (items.rows.some((item) => item.previous_stock === null || item.movement_created_at === null))
      throw new Error("PURCHASE_HISTORY_INCOMPLETE");

    for (const item of items.rows) {
      await client.query(
        `SELECT 1 FROM app_live.products
         WHERE id=$1::uuid AND company_id=$2::uuid
         FOR UPDATE`,
        [item.product_id, scope.companyId],
      );
      const laterMovement = await client.query(
        `SELECT 1
         FROM app_live.inventory_movements
         WHERE company_id=$1::uuid AND product_id=$2::uuid
           AND reversed_at IS NULL
           AND NOT (source_type='PURCHASE' AND source_id=$3::uuid)
           AND created_at>$4::timestamptz
         LIMIT 1`,
        [scope.companyId, item.product_id, id, item.movement_created_at],
      );
      if (laterMovement.rowCount) throw new Error("PRODUCT_MOVED_AFTER_PURCHASE");
    }

    for (const item of items.rows) {
      await client.query(
        `UPDATE app_live.products
         SET current_stock=$2,
             cost_price=$3,
             profit_margin_percent=CASE WHEN $3>0 THEN ((COALESCE(sale_price,0)-$3)/$3)*100 ELSE 0 END
         WHERE id=$1::uuid AND company_id=$4::uuid`,
        [
          item.product_id,
          Number(item.previous_stock),
          Number(item.previous_average_cost),
          scope.companyId,
        ],
      );
    }

    await client.query(
      `UPDATE app_live.inventory_movements
       SET reversed_at=now()
       WHERE company_id=$1::uuid AND source_type='PURCHASE'
         AND source_id=$2::uuid AND reversed_at IS NULL`,
      [scope.companyId, id],
    );
    await client.query(
      `UPDATE app_live.accounts_payable
       SET status='CANCELADO',open_amount=0,updated_at=now()
       WHERE company_id=$1::uuid AND purchase_id=$2::uuid
         AND status<>'CANCELADO'`,
      [scope.companyId, id],
    );
    await client.query(
      `UPDATE app_live.financial_events
       SET reversed_at=now()
       WHERE company_id=$1::uuid AND source_type='PURCHASE'
         AND source_id=$2::uuid AND reversed_at IS NULL`,
      [scope.companyId, id],
    );
    await client.query(
      `UPDATE app_live.purchases
       SET status='CANCELADA',updated_at=now()
       WHERE id=$1::uuid AND company_id=$2::uuid`,
      [id, scope.companyId],
    );
    await client.query(
      `INSERT INTO app_live.audit_log(entity_type,entity_id,action,actor_id,details)
       VALUES('purchase',$1::uuid,'cancelled',$2::uuid,$3::jsonb)`,
      [
        id,
        scope.user?.id ?? null,
        JSON.stringify({
          companyId: scope.companyId,
          supplier: purchase.rows[0].supplier_name,
          total: Number(purchase.rows[0].total_amount),
          products: items.rows.map((item) => ({
            productId: item.product_id,
            name: item.name,
            quantity: Number(item.quantity),
            restoredStock: Number(item.previous_stock),
            restoredAverageCost: Number(item.previous_average_cost),
          })),
        }),
      ],
    );

    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Falha ao cancelar compra", error);
    const known: Record<string, { message: string; status: number }> = {
      NOT_FOUND: { message: "Compra não encontrada.", status: 404 },
      ALREADY_CANCELLED: { message: "Esta compra já foi cancelada.", status: 409 },
      INVALID_STATUS: { message: "Somente compras confirmadas podem ser canceladas.", status: 409 },
      PURCHASE_HAS_PAYMENTS: {
        message: "Esta compra possui pagamento registrado. Reabra a conta a pagar antes de cancelar.",
        status: 409,
      },
      PRODUCT_MOVED_AFTER_PURCHASE: {
        message: "Um dos produtos já teve movimentação após esta compra. Cancele ou reverta essas movimentações primeiro.",
        status: 409,
      },
      PURCHASE_WITHOUT_ITEMS: {
        message: "A compra não possui itens válidos para estorno.",
        status: 409,
      },
      PURCHASE_HISTORY_INCOMPLETE: {
        message: "Não há histórico de custo suficiente para estornar esta compra com segurança.",
        status: 409,
      },
    };
    const failure = error instanceof Error ? known[error.message] : undefined;
    return NextResponse.json(
      { error: failure?.message ?? "Não foi possível cancelar a compra." },
      { status: failure?.status ?? 500 },
    );
  } finally {
    client.release();
  }
}
