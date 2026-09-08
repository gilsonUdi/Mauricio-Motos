import { NextResponse } from "next/server";
import { getTenantScope } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { uuidPattern } from "@/lib/registries";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const scope = await getTenantScope();
  if (!scope) return NextResponse.json({ error: "Selecione uma empresa." }, { status: 403 });
  const { id } = await context.params;
  if (!uuidPattern.test(id)) return NextResponse.json({ error: "Conta inválida." }, { status: 400 });
  let body: { action?: "PAY" | "REOPEN"; paymentDate?: string; paymentMethodId?: string; financialAccountId?: string; interestAmount?: number; fineAmount?: number; discountAmount?: number };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }
  if (body.action !== "PAY" && body.action !== "REOPEN") return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  const paymentDate = typeof body.paymentDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.paymentDate) ? body.paymentDate : null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const payable = await client.query(`SELECT p.description,p.original_amount,p.open_amount,p.status,p.category_id,c.name AS category_name FROM app_live.accounts_payable p LEFT JOIN app_live.financial_categories c ON c.id=p.category_id WHERE p.id=$1::uuid AND p.company_id=$2::uuid FOR UPDATE OF p`, [id, scope.companyId]);
    if (!payable.rowCount) throw new Error("NOT_FOUND");
    const row = payable.rows[0];
    if (body.action === "PAY") {
      if (row.status === "CANCELADO") throw new Error("CANCELLED");
      const openAmount = Number(row.open_amount);
      if (openAmount <= 0) throw new Error("ALREADY_PAID");
      const methodId = typeof body.paymentMethodId === "string" && uuidPattern.test(body.paymentMethodId) ? body.paymentMethodId : null;
      const requestedAccountId = typeof body.financialAccountId === "string" && uuidPattern.test(body.financialAccountId) ? body.financialAccountId : null;
      if (!methodId) throw new Error("METHOD_REQUIRED");
      const method = await client.query(`SELECT name,default_account_id::text FROM app_live.payment_methods WHERE id=$1::uuid AND company_id=$2::uuid AND active`, [methodId, scope.companyId]);
      if (!method.rowCount) throw new Error("METHOD_REQUIRED");
      const accountId = requestedAccountId ?? method.rows[0].default_account_id;
      if (!accountId || !(await client.query(`SELECT 1 FROM app_live.financial_accounts WHERE id=$1::uuid AND company_id=$2::uuid AND active`, [accountId, scope.companyId])).rowCount) throw new Error("ACCOUNT_REQUIRED");
      const interest = Math.round(Math.max(0, Number(body.interestAmount) || 0) * 100) / 100;
      const fine = Math.round(Math.max(0, Number(body.fineAmount) || 0) * 100) / 100;
      const discount = Math.round(Math.max(0, Number(body.discountAmount) || 0) * 100) / 100;
      const paidAmount = Math.round((openAmount + interest + fine - discount) * 100) / 100;
      if (paidAmount <= 0) throw new Error("INVALID_TOTAL");
      const payment = await client.query(`INSERT INTO app_live.payable_payments(company_id,payable_id,payment_date,amount,interest_amount,fine_amount,discount_amount,payment_method,financial_account_id,payment_method_id) VALUES($1::uuid,$2::uuid,COALESCE($3::date,CURRENT_DATE),$4,$5,$6,$7,$8,$9::uuid,$10::uuid) RETURNING id::text`, [scope.companyId, id, paymentDate, openAmount, interest, fine, discount, method.rows[0].name, accountId, methodId]);
      const paymentId = payment.rows[0].id;
      await client.query(`UPDATE app_live.accounts_payable SET open_amount=0,status='PAGO',updated_at=now() WHERE id=$1::uuid`, [id]);
      await client.query(`INSERT INTO app_live.financial_transactions(company_id,legacy_finance_key,transaction_date,competence_date,description,movement,account_type,account_group,amount,source_type,source_id,affects_drg,financial_account_id,payment_method_id,gross_amount) VALUES($1::uuid,$2,COALESCE($3::date,CURRENT_DATE),COALESCE($3::date,CURRENT_DATE),$4,'SAIDA','PAGAMENTO_FORNECEDOR',$5,$6,'PAYABLE_PAYMENT',$7::uuid,false,$8::uuid,$9::uuid,$6)`, [scope.companyId, `payable-payment:${paymentId}`, paymentDate, `Pagamento - ${row.description}`, row.category_name ?? "Não classificado", paidAmount, paymentId, accountId, methodId]);
      await client.query(`INSERT INTO app_live.financial_events(company_id,event_key,event_type,source_type,source_id,category_id,competence_date,cash_date,description,amount,affects_drg) VALUES($1::uuid,$2,'PAGAMENTO','PAYABLE_PAYMENT',$3::uuid,$4::uuid,COALESCE($5::date,CURRENT_DATE),COALESCE($5::date,CURRENT_DATE),$6,$7,false)`, [scope.companyId, `payable-payment:${paymentId}:cash`, paymentId, row.category_id, paymentDate, `Pagamento - ${row.description}`, paidAmount]);
    } else {
      const payments = await client.query(`UPDATE app_live.payable_payments SET reversed_at=now() WHERE payable_id=$1::uuid AND reversed_at IS NULL RETURNING id`, [id]);
      await client.query(`UPDATE app_live.accounts_payable SET open_amount=original_amount,status='PENDENTE',updated_at=now() WHERE id=$1::uuid`, [id]);
      if (payments.rowCount) {
        const ids = payments.rows.map(item => item.id);
        await client.query(`DELETE FROM app_live.financial_transactions WHERE company_id=$1::uuid AND source_type='PAYABLE_PAYMENT' AND source_id=ANY($2::uuid[])`, [scope.companyId, ids]);
        await client.query(`UPDATE app_live.financial_events SET reversed_at=now() WHERE company_id=$1::uuid AND source_type='PAYABLE_PAYMENT' AND source_id=ANY($2::uuid[])`, [scope.companyId, ids]);
      }
    }
    await client.query(`INSERT INTO app_live.audit_log(entity_type,entity_id,action,actor_id,details) VALUES('payable',$1::uuid,$2,$3::uuid,$4::jsonb)`, [id, body.action === "PAY" ? "paid" : "reopened", scope.user?.id ?? null, JSON.stringify({ paymentDate, methodId: body.paymentMethodId, accountId: body.financialAccountId })]);
    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Falha ao atualizar conta a pagar", error);
    const known: Record<string, [string, number]> = { NOT_FOUND: ["Conta não encontrada.", 404], CANCELLED: ["Uma conta cancelada não pode ser paga.", 409], ALREADY_PAID: ["Esta conta já está paga.", 409], METHOD_REQUIRED: ["Selecione uma forma de pagamento válida.", 400], ACCOUNT_REQUIRED: ["Selecione uma conta financeira válida.", 400], INVALID_TOTAL: ["O total do pagamento deve ser maior que zero.", 400] };
    const result = error instanceof Error ? known[error.message] : undefined;
    return NextResponse.json({ error: result?.[0] ?? "Não foi possível atualizar a conta a pagar." }, { status: result?.[1] ?? 500 });
  } finally { client.release(); }
}
