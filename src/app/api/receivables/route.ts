import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { uuidPattern } from "@/lib/registries";
import { getTenantScope } from "@/lib/auth";

export async function GET() {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const scope=await getTenantScope(); if(!scope)return NextResponse.json({error:"Selecione uma empresa."},{status:403});
  try {
    const [receivables, customers, orders,accounts,methods,rules] = await Promise.all([
      pool.query(`
        SELECT r.id::text, r.work_order_id::text, o.order_number, r.customer_id::text,
               COALESCE(r.customer_name, o.customer_name) AS customer_name,
               r.due_date::text, r.payment_date::text, COALESCE(r.original_amount,r.amount) AS amount,
               COALESCE(r.open_amount,CASE WHEN r.payment_date IS NULL THEN r.amount ELSE 0 END) AS open_amount, r.notes,
               COALESCE(last_payment.payment_method,o.payment_method) AS payment_method,r.installment_number,r.installment_count,
               CASE WHEN upper(COALESCE(r.status, '')) LIKE '%CANC%' THEN 'CANCELADO'
                    WHEN r.payment_date IS NOT NULL OR upper(COALESCE(r.status, '')) IN ('PAGO','RECEBIDO','QUITADO') THEN 'PAGO'
                    WHEN r.due_date < CURRENT_DATE THEN 'VENCIDO'
                    ELSE 'PENDENTE' END AS display_status
        FROM app_live.receivables r
        LEFT JOIN app_live.work_orders o ON o.id=r.work_order_id AND o.company_id=r.company_id
        LEFT JOIN LATERAL (SELECT rp.payment_method FROM app_live.receivable_payments rp WHERE rp.receivable_id=r.id AND rp.reversed_at IS NULL ORDER BY rp.created_at DESC LIMIT 1) last_payment ON true
        WHERE r.company_id=$1::uuid
        ORDER BY COALESCE(r.payment_date, r.due_date) DESC NULLS LAST, r.created_at DESC
        LIMIT 1500`,[scope.companyId]),
      pool.query(`SELECT id::text,name FROM app_live.customers WHERE company_id=$1::uuid ORDER BY name`,[scope.companyId]),
      pool.query(`SELECT id::text,order_number,customer_id::text,customer_name,total_value FROM app_live.work_orders WHERE company_id=$1::uuid AND status IN ('PEDIDO','VENDA_REALIZADA') ORDER BY COALESCE(sale_date,budget_date) DESC NULLS LAST LIMIT 500`,[scope.companyId]),
      pool.query(`SELECT id::text,name,account_type FROM app_live.financial_accounts WHERE company_id=$1::uuid AND active ORDER BY name`,[scope.companyId]),
      pool.query(`SELECT id::text,name,supports_installments,variable_fee,default_fee_percent,default_account_id::text FROM app_live.payment_methods WHERE company_id=$1::uuid AND active ORDER BY name`,[scope.companyId]),
      pool.query(`SELECT r.payment_method_id::text,r.minimum_installments,r.maximum_installments,r.fee_percent FROM app_live.payment_fee_rules r JOIN app_live.payment_methods m ON m.id=r.payment_method_id WHERE m.company_id=$1::uuid ORDER BY r.minimum_installments`,[scope.companyId]),
    ]);
    return NextResponse.json({
      receivables: receivables.rows.map((row) => ({
        id: row.id, workOrderId: row.work_order_id, orderNumber: row.order_number,
        customerId: row.customer_id, customerName: row.customer_name, dueDate: row.due_date,
        paymentDate: row.payment_date, amount: Number(row.amount), openAmount: Number(row.open_amount), status: row.display_status,
        paymentMethod: row.payment_method, installmentNumber:Number(row.installment_number??1),installmentCount:Number(row.installment_count??1), notes: row.notes,
      })),
      customers: customers.rows,
      orders: orders.rows.map((row) => ({ id: row.id, number: row.order_number, customerId: row.customer_id, customerName: row.customer_name, total: Number(row.total_value) })),
      accounts:accounts.rows.map(row=>({id:row.id,name:row.name,type:row.account_type})),
      paymentMethods:methods.rows.map(row=>({id:row.id,name:row.name,supportsInstallments:row.supports_installments,variableFee:row.variable_fee,defaultFeePercent:Number(row.default_fee_percent),defaultAccountId:row.default_account_id,rules:rules.rows.filter(rule=>rule.payment_method_id===row.id).map(rule=>({minimumInstallments:rule.minimum_installments,maximumInstallments:rule.maximum_installments,feePercent:Number(rule.fee_percent)}))})),
    });
  } catch (error) {
    console.error("Falha ao carregar contas a receber", error);
    return NextResponse.json({ error: "Não foi possível carregar as contas a receber." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const scope=await getTenantScope(); if(!scope)return NextResponse.json({error:"Selecione uma empresa."},{status:403});
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }

  const workOrderId = typeof body.workOrderId === "string" && uuidPattern.test(body.workOrderId) ? body.workOrderId : null;
  let customerId = typeof body.customerId === "string" && uuidPattern.test(body.customerId) ? body.customerId : null;
  let customerName = typeof body.customerName === "string" ? body.customerName.trim() : "";
  let amount = Math.round(Math.max(0, Number(body.amount) || 0) * 100) / 100;
  const dueDate = typeof body.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate) ? body.dueDate : null;
  if (!dueDate) return NextResponse.json({ error: "Informe o vencimento." }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (workOrderId) {
      const order = await client.query(`SELECT customer_id::text,customer_name,total_value FROM app_live.work_orders WHERE id=$1::uuid AND company_id=$2::uuid`, [workOrderId,scope.companyId]);
      if (!order.rowCount) throw new Error("ORDER_NOT_FOUND");
      customerId = order.rows[0].customer_id;
      customerName = order.rows[0].customer_name;
      if (!amount) amount = Number(order.rows[0].total_value);
    } else if (customerId) {
      const customer = await client.query(`SELECT name FROM app_live.customers WHERE id=$1::uuid AND company_id=$2::uuid`, [customerId,scope.companyId]);
      if (!customer.rowCount) throw new Error("CUSTOMER_NOT_FOUND");
      customerName = customer.rows[0].name;
    }
    if (!customerName) throw new Error("CUSTOMER_REQUIRED");
    if (amount <= 0) throw new Error("AMOUNT_REQUIRED");

    const inserted = await client.query(
      `INSERT INTO app_live.receivables
       (company_id,work_order_id,customer_id,customer_name,issue_date,competence_date,due_date,amount,original_amount,open_amount,status,notes)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,CURRENT_DATE,CURRENT_DATE,$5::date,$6,$6,$6,'PENDENTE',$7)
       RETURNING id::text`,
      [scope.companyId,workOrderId, customerId, customerName, dueDate, amount, typeof body.notes === "string" ? body.notes.trim() || null : null],
    );
    await client.query(
      `INSERT INTO app_live.audit_log (entity_type, entity_id, action, details) VALUES ('receivable', $1::uuid, 'created', $2::jsonb)`,
      [inserted.rows[0].id, JSON.stringify({ customerName, amount, dueDate, workOrderId })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ id: inserted.rows[0].id }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Falha ao criar conta a receber", error);
    const messages: Record<string, string> = { ORDER_NOT_FOUND: "Ordem não encontrada.", CUSTOMER_NOT_FOUND: "Cliente não encontrado.", CUSTOMER_REQUIRED: "Informe o cliente.", AMOUNT_REQUIRED: "Informe um valor maior que zero." };
    const message = error instanceof Error ? messages[error.message] : undefined;
    return NextResponse.json({ error: message ?? "Não foi possível criar a cobrança." }, { status: message ? 400 : 500 });
  } finally { client.release(); }
}
