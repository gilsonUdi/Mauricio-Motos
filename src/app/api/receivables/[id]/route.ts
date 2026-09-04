import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { uuidPattern } from "@/lib/registries";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const { id } = await context.params;
  if (!uuidPattern.test(id)) return NextResponse.json({ error: "Cobrança inválida." }, { status: 400 });
  let body: { action?: "PAY" | "REOPEN"; paymentDate?: string; paymentMethod?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }
  if (body.action !== "PAY" && body.action !== "REOPEN") return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  const paymentDate = /^\d{4}-\d{2}-\d{2}$/.test(body.paymentDate ?? "") ? body.paymentDate : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const receivable = await client.query(
      `SELECT r.customer_name, r.amount, r.payment_date, o.payment_method
       FROM app_live.receivables r LEFT JOIN app_live.work_orders o ON o.id=r.work_order_id
       WHERE r.id=$1::uuid FOR UPDATE OF r`, [id],
    );
    if (!receivable.rowCount) throw new Error("NOT_FOUND");
    const row = receivable.rows[0];
    if (body.action === "PAY") {
      const method = body.paymentMethod?.trim() || row.payment_method || "Não informado";
      await client.query(`UPDATE app_live.receivables SET payment_date=COALESCE($2::date,CURRENT_DATE), status='PAGO' WHERE id=$1::uuid`, [id, paymentDate]);
      await client.query(
        `INSERT INTO app_live.financial_transactions
         (legacy_finance_key, transaction_date, description, movement, account_type, account_group, amount)
         VALUES ($1, COALESCE($2::date,CURRENT_DATE), $3, 'ENTRADA', 'RECEBIMENTO_CLIENTE', $4, $5)
         ON CONFLICT (legacy_finance_key) DO UPDATE SET transaction_date=EXCLUDED.transaction_date, description=EXCLUDED.description, account_group=EXCLUDED.account_group, amount=EXCLUDED.amount`,
        [`receivable:${id}`, paymentDate, `Recebimento - ${row.customer_name}`, method, row.amount],
      );
    } else {
      await client.query(`UPDATE app_live.receivables SET payment_date=NULL, status='PENDENTE' WHERE id=$1::uuid`, [id]);
      await client.query(`DELETE FROM app_live.financial_transactions WHERE legacy_finance_key=$1`, [`receivable:${id}`]);
    }
    await client.query(
      `INSERT INTO app_live.audit_log (entity_type, entity_id, action, details) VALUES ('receivable', $1::uuid, $2, $3::jsonb)`,
      [id, body.action === "PAY" ? "paid" : "reopened", JSON.stringify({ previousPaymentDate: row.payment_date, paymentDate: body.action === "PAY" ? paymentDate : null })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Falha ao atualizar cobrança", error);
    return NextResponse.json({ error: error instanceof Error && error.message === "NOT_FOUND" ? "Cobrança não encontrada." : "Não foi possível atualizar a cobrança." }, { status: error instanceof Error && error.message === "NOT_FOUND" ? 404 : 500 });
  } finally { client.release(); }
}
