import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { uuidPattern } from "@/lib/registries";
import { getTenantScope } from "@/lib/auth";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const scope=await getTenantScope(); if(!scope)return NextResponse.json({error:"Selecione uma empresa."},{status:403});
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
      `SELECT r.customer_name,COALESCE(r.original_amount,r.amount) AS original_amount,
              COALESCE(r.open_amount,CASE WHEN r.payment_date IS NULL THEN r.amount ELSE 0 END) AS open_amount,
              r.payment_date,r.status,o.payment_method
       FROM app_live.receivables r LEFT JOIN app_live.work_orders o ON o.id=r.work_order_id
       WHERE r.id=$1::uuid AND r.company_id=$2::uuid FOR UPDATE OF r`, [id,scope.companyId],
    );
    if (!receivable.rowCount) throw new Error("NOT_FOUND");
    const row = receivable.rows[0];
    if (body.action === "PAY") {
      if (row.status === "CANCELADO") throw new Error("CANCELLED");
      const receivedAmount = Number(row.open_amount);
      if (receivedAmount <= 0) throw new Error("ALREADY_PAID");
      const method = body.paymentMethod?.trim() || row.payment_method || "Não informado";
      await client.query(
        `INSERT INTO app_live.receivable_payments
         (company_id,receivable_id,receipt_date,amount,payment_method)
         VALUES ($1::uuid,$2::uuid,COALESCE($3::date,CURRENT_DATE),$4,$5)`,
        [scope.companyId,id,paymentDate,receivedAmount,method],
      );
      await client.query(`UPDATE app_live.receivables SET payment_date=COALESCE($2::date,CURRENT_DATE),open_amount=0,status='PAGO' WHERE id=$1::uuid`, [id, paymentDate]);
      await client.query(
        `INSERT INTO app_live.financial_transactions
         (company_id,legacy_finance_key,transaction_date,competence_date,description,movement,account_type,account_group,amount,source_type,source_id,affects_drg)
         VALUES ($1::uuid,$2,COALESCE($3::date,CURRENT_DATE),COALESCE($3::date,CURRENT_DATE),$4,'ENTRADA','RECEBIMENTO_CLIENTE',$5,$6,'RECEIVABLE',$7::uuid,false)
         ON CONFLICT (legacy_finance_key) DO UPDATE SET transaction_date=EXCLUDED.transaction_date,competence_date=EXCLUDED.competence_date,description=EXCLUDED.description,account_group=EXCLUDED.account_group,amount=EXCLUDED.amount,source_type=EXCLUDED.source_type,source_id=EXCLUDED.source_id,affects_drg=false`,
        [scope.companyId,`receivable:${id}`, paymentDate, `Recebimento - ${row.customer_name}`, method, receivedAmount,id],
      );
      await client.query(
        `INSERT INTO app_live.financial_events
         (company_id,event_key,event_type,source_type,source_id,competence_date,cash_date,description,amount,affects_drg)
         VALUES ($1::uuid,$2,'RECEBIMENTO','RECEIVABLE',$3::uuid,COALESCE($4::date,CURRENT_DATE),COALESCE($4::date,CURRENT_DATE),$5,$6,false)
         ON CONFLICT (company_id,event_key) DO UPDATE SET cash_date=EXCLUDED.cash_date,amount=EXCLUDED.amount,reversed_at=NULL`,
        [scope.companyId,`receivable:${id}:receipt`,id,paymentDate,`Recebimento - ${row.customer_name}`,receivedAmount],
      );
    } else {
      await client.query(`UPDATE app_live.receivable_payments SET reversed_at=now() WHERE receivable_id=$1::uuid AND reversed_at IS NULL`,[id]);
      await client.query(`UPDATE app_live.receivables SET payment_date=NULL,open_amount=COALESCE(original_amount,amount),status='PENDENTE' WHERE id=$1::uuid`, [id]);
      await client.query(`DELETE FROM app_live.financial_transactions WHERE legacy_finance_key=$1 AND company_id=$2::uuid`, [`receivable:${id}`,scope.companyId]);
      await client.query(`UPDATE app_live.financial_events SET reversed_at=now() WHERE company_id=$1::uuid AND event_key=$2`,[scope.companyId,`receivable:${id}:receipt`]);
    }
    await client.query(
      `INSERT INTO app_live.audit_log (entity_type, entity_id, action,actor_id,details) VALUES ('receivable', $1::uuid, $2,$3::uuid,$4::jsonb)`,
      [id, body.action === "PAY" ? "paid" : "reopened",scope.user?.id??null,JSON.stringify({ previousPaymentDate: row.payment_date, paymentDate: body.action === "PAY" ? paymentDate : null })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Falha ao atualizar cobrança", error);
    const messages: Record<string,{message:string;status:number}> = {
      NOT_FOUND:{message:"Cobrança não encontrada.",status:404},
      CANCELLED:{message:"Uma cobrança cancelada não pode ser recebida.",status:409},
      ALREADY_PAID:{message:"Esta cobrança já está quitada.",status:409},
    };
    const known=error instanceof Error?messages[error.message]:undefined;
    return NextResponse.json({ error: known?.message ?? "Não foi possível atualizar a cobrança." }, { status: known?.status ?? 500 });
  } finally { client.release(); }
}
