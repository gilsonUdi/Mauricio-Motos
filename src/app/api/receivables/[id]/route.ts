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
  let body: { action?: "PAY" | "REOPEN"; paymentDate?: string; paymentMethod?: string; paymentMethodId?:string; financialAccountId?:string };
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
              r.payment_date,r.status,r.installment_count,o.payment_method
       FROM app_live.receivables r LEFT JOIN app_live.work_orders o ON o.id=r.work_order_id
       WHERE r.id=$1::uuid AND r.company_id=$2::uuid FOR UPDATE OF r`, [id,scope.companyId],
    );
    if (!receivable.rowCount) throw new Error("NOT_FOUND");
    const row = receivable.rows[0];
    if (body.action === "PAY") {
      if (row.status === "CANCELADO") throw new Error("CANCELLED");
      const receivedAmount = Number(row.open_amount);
      if (receivedAmount <= 0) throw new Error("ALREADY_PAID");
      const methodId=body.paymentMethodId&&uuidPattern.test(body.paymentMethodId)?body.paymentMethodId:null;
      const accountId=body.financialAccountId&&uuidPattern.test(body.financialAccountId)?body.financialAccountId:null;
      if(!methodId)throw new Error("METHOD_REQUIRED");
      const methodResult=await client.query(`SELECT id::text,name,variable_fee,default_fee_percent,default_account_id::text FROM app_live.payment_methods WHERE id=$1::uuid AND company_id=$2::uuid AND active`,[methodId,scope.companyId]);
      if(!methodResult.rowCount)throw new Error("METHOD_REQUIRED");
      const methodRow=methodResult.rows[0];const selectedAccountId=accountId??methodRow.default_account_id;
      if(!selectedAccountId||!(await client.query(`SELECT 1 FROM app_live.financial_accounts WHERE id=$1::uuid AND company_id=$2::uuid AND active`,[selectedAccountId,scope.companyId])).rowCount)throw new Error("ACCOUNT_REQUIRED");
      let feePercent=Number(methodRow.default_fee_percent??0);
      if(methodRow.variable_fee){const feeRule=await client.query(`SELECT fee_percent FROM app_live.payment_fee_rules WHERE payment_method_id=$1::uuid AND minimum_installments<=$2 AND (maximum_installments IS NULL OR maximum_installments>=$2) ORDER BY minimum_installments DESC LIMIT 1`,[methodId,Number(row.installment_count??1)]);feePercent=Number(feeRule.rows[0]?.fee_percent??feePercent);}
      const method = methodRow.name;const feeAmount=Math.round(receivedAmount*feePercent)/100;const netAmount=Math.round((receivedAmount-feeAmount)*100)/100;
      const payment=await client.query(
        `INSERT INTO app_live.receivable_payments
         (company_id,receivable_id,receipt_date,amount,payment_method,financial_account_id,payment_method_id,gross_amount,fee_percent,fee_amount,net_amount)
         VALUES ($1::uuid,$2::uuid,COALESCE($3::date,CURRENT_DATE),$4,$5,$6::uuid,$7::uuid,$4,$8,$9,$10) RETURNING id::text`,
        [scope.companyId,id,paymentDate,receivedAmount,method,selectedAccountId,methodId,feePercent,feeAmount,netAmount],
      );
      const paymentId=payment.rows[0].id;
      await client.query(`UPDATE app_live.receivables SET payment_date=COALESCE($2::date,CURRENT_DATE),open_amount=0,status='PAGO' WHERE id=$1::uuid`, [id, paymentDate]);
      await client.query(
        `INSERT INTO app_live.financial_transactions
         (company_id,legacy_finance_key,transaction_date,competence_date,description,movement,account_type,account_group,amount,source_type,source_id,affects_drg,financial_account_id,payment_method_id,gross_amount,fee_amount)
         VALUES ($1::uuid,$2,COALESCE($3::date,CURRENT_DATE),COALESCE($3::date,CURRENT_DATE),$4,'ENTRADA','RECEBIMENTO_CLIENTE',$5,$6,'RECEIVABLE_PAYMENT',$7::uuid,false,$8::uuid,$9::uuid,$10,$11)`,
        [scope.companyId,`receivable-payment:${paymentId}`, paymentDate, `Recebimento - ${row.customer_name}`, method, netAmount,paymentId,selectedAccountId,methodId,receivedAmount,feeAmount],
      );
      await client.query(
        `INSERT INTO app_live.financial_events
         (company_id,event_key,event_type,source_type,source_id,competence_date,cash_date,description,amount,affects_drg)
         VALUES ($1::uuid,$2,'RECEBIMENTO','RECEIVABLE_PAYMENT',$3::uuid,COALESCE($4::date,CURRENT_DATE),COALESCE($4::date,CURRENT_DATE),$5,$6,false)`,
        [scope.companyId,`receivable-payment:${paymentId}:receipt`,paymentId,paymentDate,`Recebimento - ${row.customer_name}`,receivedAmount],
      );
      if(feeAmount>0){const category=await client.query(`SELECT id FROM app_live.financial_categories WHERE company_id=$1::uuid AND system_code='PAYMENT_FEES'`,[scope.companyId]);await client.query(`INSERT INTO app_live.financial_events(company_id,event_key,event_type,source_type,source_id,category_id,competence_date,cash_date,description,amount,affects_drg) VALUES($1::uuid,$2,'DESPESA','RECEIVABLE_PAYMENT',$3::uuid,$4::uuid,COALESCE($5::date,CURRENT_DATE),COALESCE($5::date,CURRENT_DATE),$6,$7,true)`,[scope.companyId,`receivable-payment:${paymentId}:fee`,paymentId,category.rows[0]?.id??null,paymentDate,`Taxa de ${method} - ${row.customer_name}`,feeAmount]);}
    } else {
      const payments=await client.query(`UPDATE app_live.receivable_payments SET reversed_at=now() WHERE receivable_id=$1::uuid AND reversed_at IS NULL RETURNING id`,[id]);
      await client.query(`UPDATE app_live.receivables SET payment_date=NULL,open_amount=COALESCE(original_amount,amount),status='PENDENTE' WHERE id=$1::uuid`, [id]);
      await client.query(`DELETE FROM app_live.financial_transactions WHERE legacy_finance_key=$1 AND company_id=$2::uuid`, [`receivable:${id}`,scope.companyId]);
      await client.query(`UPDATE app_live.financial_events SET reversed_at=now() WHERE company_id=$1::uuid AND event_key=$2`,[scope.companyId,`receivable:${id}:receipt`]);
      if(payments.rowCount){const ids=payments.rows.map(item=>item.id);await client.query(`DELETE FROM app_live.financial_transactions WHERE company_id=$1::uuid AND source_type='RECEIVABLE_PAYMENT' AND source_id=ANY($2::uuid[])`,[scope.companyId,ids]);await client.query(`UPDATE app_live.financial_events SET reversed_at=now() WHERE company_id=$1::uuid AND source_type='RECEIVABLE_PAYMENT' AND source_id=ANY($2::uuid[])`,[scope.companyId,ids]);}
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
      METHOD_REQUIRED:{message:"Selecione uma forma de pagamento válida.",status:400},
      ACCOUNT_REQUIRED:{message:"Selecione uma conta financeira válida.",status:400},
    };
    const known=error instanceof Error?messages[error.message]:undefined;
    return NextResponse.json({ error: known?.message ?? "Não foi possível atualizar a cobrança." }, { status: known?.status ?? 500 });
  } finally { client.release(); }
}
