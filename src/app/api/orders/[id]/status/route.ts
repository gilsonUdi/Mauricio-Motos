import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { OrderStatus } from "@/lib/types";
import { getTenantScope } from "@/lib/auth";

const validStatuses = new Set<OrderStatus>([
  "ORCAMENTO",
  "PEDIDO",
  "VENDA_REALIZADA",
  "CANCELADO",
]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cents = (value: number) => Math.round(value * 100);
const isoMonth = (date: string, offset: number) => {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCMonth(parsed.getUTCMonth() + offset);
  return parsed.toISOString().slice(0, 10);
};

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
  const body = (await request.json()) as {
    status?: OrderStatus;
    entryAmount?: number;
    installmentCount?: number;
    firstDueDate?: string;
    paymentMethodId?: string;
    financialAccountId?: string;
    approvedByCustomer?: string;
    approvalMethod?: string;
    approvalNotes?: string;
  };
  if (!body.status || !validStatuses.has(body.status)) {
    return NextResponse.json({ error: "Status inválido." }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT status,customer_id,customer_name,total_value,COALESCE(sale_date,CURRENT_DATE)::text AS sale_date,
              approved_by_customer,approval_method,approval_notes
       FROM app_live.work_orders WHERE id=$1::uuid AND company_id=$2::uuid FOR UPDATE`,
      [id, scope.companyId],
    );
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Ordem não encontrada." },
        { status: 404 },
      );
    }

    const previousStatus = current.rows[0].status as OrderStatus;
    const enteringApproval = previousStatus === "ORCAMENTO" && (body.status === "PEDIDO" || body.status === "VENDA_REALIZADA");
    const approvedByCustomer = typeof body.approvedByCustomer === "string" ? body.approvedByCustomer.trim().slice(0, 160) : "";
    const allowedApprovalMethods = new Set(["WhatsApp", "Telefone", "Presencial", "E-mail", "Outro", "Conclusão direta"]);
    const approvalMethod = typeof body.approvalMethod === "string" && allowedApprovalMethods.has(body.approvalMethod) ? body.approvalMethod : "";
    const approvalNotes = typeof body.approvalNotes === "string" ? body.approvalNotes.trim().slice(0, 1000) : "";
    const enteringSale =
      previousStatus !== "VENDA_REALIZADA" && body.status === "VENDA_REALIZADA";
    const leavingSale =
      previousStatus === "VENDA_REALIZADA" && body.status !== "VENDA_REALIZADA";
    if (leavingSale) {
      const received = await client.query(
        `SELECT 1 FROM app_live.receivable_payments rp
         JOIN app_live.receivables r ON r.id=rp.receivable_id
         WHERE r.work_order_id=$1::uuid AND rp.reversed_at IS NULL
         UNION ALL
         SELECT 1 FROM app_live.receivables WHERE work_order_id=$1::uuid AND payment_date IS NOT NULL LIMIT 1`,
        [id],
      );
      if (received.rowCount) throw new Error("SALE_HAS_RECEIPTS");
    }
    let saleCost = 0;
    let saleFinance: {
      entryAmount: number;
      installmentCount: number;
      firstDueDate: string;
      paymentMethodId: string;
      financialAccountId: string;
      methodName: string;
      feePercent: number;
    } | null = null;
    if (enteringSale) {
      const entryAmount = Math.max(0, Number(body.entryAmount) || 0);
      const installmentCount = Math.max(
        1,
        Math.min(120, Math.trunc(Number(body.installmentCount) || 1)),
      );
      const firstDueDate =
        typeof body.firstDueDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(body.firstDueDate)
          ? body.firstDueDate
          : "";
      const paymentMethodId =
        typeof body.paymentMethodId === "string" &&
        uuidPattern.test(body.paymentMethodId)
          ? body.paymentMethodId
          : "";
      let financialAccountId =
        typeof body.financialAccountId === "string" &&
        uuidPattern.test(body.financialAccountId)
          ? body.financialAccountId
          : "";
      if (entryAmount > Number(current.rows[0].total_value))
        throw new Error("INVALID_ENTRY");
      if (!firstDueDate || !paymentMethodId)
        throw new Error("FINANCE_REQUIRED");
      const method = await client.query(
        `SELECT name,supports_installments,variable_fee,default_fee_percent,default_account_id::text FROM app_live.payment_methods WHERE id=$1::uuid AND company_id=$2::uuid AND active`,
        [paymentMethodId, scope.companyId],
      );
      if (!method.rowCount) throw new Error("FINANCE_REQUIRED");
      if (installmentCount > 1 && !method.rows[0].supports_installments)
        throw new Error("INSTALLMENTS_NOT_ALLOWED");
      financialAccountId =
        financialAccountId || method.rows[0].default_account_id || "";
      if (
        !financialAccountId ||
        !(
          await client.query(
            `SELECT 1 FROM app_live.financial_accounts WHERE id=$1::uuid AND company_id=$2::uuid AND active`,
            [financialAccountId, scope.companyId],
          )
        ).rowCount
      )
        throw new Error("FINANCE_REQUIRED");
      let feePercent = Number(method.rows[0].default_fee_percent ?? 0);
      if (method.rows[0].variable_fee) {
        const rule = await client.query(
          `SELECT fee_percent FROM app_live.payment_fee_rules WHERE payment_method_id=$1::uuid AND minimum_installments<=$2 AND (maximum_installments IS NULL OR maximum_installments>=$2) ORDER BY minimum_installments DESC LIMIT 1`,
          [paymentMethodId, installmentCount],
        );
        feePercent = Number(rule.rows[0]?.fee_percent ?? feePercent);
      }
      saleFinance = {
        entryAmount: Math.round(entryAmount * 100) / 100,
        installmentCount,
        firstDueDate,
        paymentMethodId,
        financialAccountId,
        methodName: method.rows[0].name,
        feePercent,
      };
    }
    if (enteringSale || leavingSale) {
      const items = await client.query(
        `SELECT i.product_id::text, p.name, SUM(i.quantity) AS quantity
         FROM app_live.work_order_items i
         JOIN app_live.products p ON p.id = i.product_id
         WHERE i.work_order_id = $1::uuid
           AND COALESCE(p.item_kind,CASE WHEN lower(concat_ws(' ',i.item_type,p.type)) LIKE '%serv%' THEN 'SERVICO' ELSE 'PRODUTO' END)<>'SERVICO'
         GROUP BY i.product_id, p.name
         ORDER BY i.product_id`,
        [id],
      );
      for (const item of items.rows) {
        const product = await client.query(
          `SELECT COALESCE(current_stock,0) AS stock,COALESCE(cost_price,0) AS unit_cost
           FROM app_live.products WHERE id=$1::uuid AND company_id=$2::uuid FOR UPDATE`,
          [item.product_id, scope.companyId],
        );
        const oldStock = Number(product.rows[0].stock);
        const quantity = Number(item.quantity);
        const unitCost = Number(product.rows[0].unit_cost);
        saleCost += quantity * unitCost;
        const newStock = enteringSale
          ? oldStock - quantity
          : oldStock + quantity;
        if (newStock < 0) throw new Error(`INSUFFICIENT_STOCK:${item.name}`);
        await client.query(
          `UPDATE app_live.products SET current_stock = $2 WHERE id = $1::uuid`,
          [item.product_id, newStock],
        );
        await client.query(
          `INSERT INTO app_live.inventory_movements
           (company_id,product_id,movement_date,movement_type,quantity,party_name,balance_after,unit_cost,total_cost,movement_reason,affects_sales_metrics,source_type,source_id)
           VALUES ($1::uuid,$2::uuid,CURRENT_DATE,$3,$4,$5,$6,$7,$8,$9,$10,'WORK_ORDER',$11::uuid)`,
          [
            scope.companyId,
            item.product_id,
            enteringSale ? "VENDA" : "ESTORNO_VENDA",
            quantity,
            current.rows[0].customer_name,
            newStock,
            unitCost,
            Math.round(quantity * unitCost * 100) / 100,
            enteringSale ? "VENDA_CONCLUIDA" : "ESTORNO_VENDA",
            enteringSale,
            id,
          ],
        );
        if (enteringSale) {
          await client.query(
            `UPDATE app_live.work_order_items SET unit_cost_snapshot=$2, cost_value=$2
             WHERE work_order_id=$1::uuid AND product_id=$3::uuid`,
            [id, unitCost, item.product_id],
          );
        }
      }
    }

    if (enteringSale) {
      await client.query(
        `DELETE FROM app_live.receivables WHERE work_order_id=$1::uuid AND payment_date IS NULL AND notes LIKE 'Gerado automaticamente na conclusão da venda%'`,
        [id],
      );
      const totalCents = cents(Number(current.rows[0].total_value));
      const entryCents = cents(saleFinance!.entryAmount);
      const remainingCents = totalCents - entryCents;
      const obligations = [
        ...(entryCents > 0
          ? [
              {
                amount: entryCents,
                date: new Date().toISOString().slice(0, 10),
                label: "Entrada",
                number: 0,
              },
            ]
          : []),
        ...Array.from(
          { length: saleFinance!.installmentCount },
          (_, index) => ({
            amount:
              remainingCents > 0
                ? Math.floor(remainingCents / saleFinance!.installmentCount) +
                  (index === saleFinance!.installmentCount - 1
                    ? remainingCents % saleFinance!.installmentCount
                    : 0)
                : 0,
            date: isoMonth(saleFinance!.firstDueDate, index),
            label: `${index + 1}ª parcela`,
            number: index + 1,
          }),
        ),
      ].filter((item) => item.amount > 0);
      for (const item of obligations) {
        const amount = item.amount / 100;
        const fee = Math.round(amount * saleFinance!.feePercent) / 100;
        await client.query(
          `INSERT INTO app_live.receivables(company_id,work_order_id,customer_id,customer_name,issue_date,competence_date,due_date,amount,original_amount,open_amount,status,installment_number,installment_count,payment_method_id,financial_account_id,fee_percent,fee_amount,net_amount,notes) VALUES($1::uuid,$2::uuid,$3::uuid,$4,CURRENT_DATE,CURRENT_DATE,$5::date,$6,$6,$6,'PENDENTE',$7,$8,$9::uuid,$10::uuid,$11,$12,$13,$14)`,
          [
            scope.companyId,
            id,
            current.rows[0].customer_id,
            current.rows[0].customer_name,
            item.date,
            amount,
            item.number,
            saleFinance!.installmentCount,
            saleFinance!.paymentMethodId,
            saleFinance!.financialAccountId,
            saleFinance!.feePercent,
            fee,
            Math.round((amount - fee) * 100) / 100,
            `Gerado automaticamente na conclusão da venda — ${item.label}`,
          ],
        );
      }
      const categories = await client.query(
        `SELECT system_code,id FROM app_live.financial_categories
         WHERE company_id=$1::uuid AND system_code IN ('SALES','COGS')`,
        [scope.companyId],
      );
      const categoryIds = Object.fromEntries(
        categories.rows.map((row) => [row.system_code, row.id]),
      );
      const eventDate = current.rows[0].sale_date;
      await client.query(
        `INSERT INTO app_live.financial_events
         (company_id,event_key,event_type,source_type,source_id,category_id,competence_date,description,amount,affects_drg)
         VALUES ($1::uuid,$2,'RECEITA_VENDA','WORK_ORDER',$3::uuid,$4::uuid,$5::date,$6,$7,true)
         ON CONFLICT (company_id,event_key) DO UPDATE SET category_id=EXCLUDED.category_id,competence_date=EXCLUDED.competence_date,description=EXCLUDED.description,amount=EXCLUDED.amount,reversed_at=NULL`,
        [
          scope.companyId,
          `sale:${id}:revenue`,
          id,
          categoryIds.SALES ?? null,
          eventDate,
          `Venda ${current.rows[0].customer_name}`,
          current.rows[0].total_value,
        ],
      );
      await client.query(
        `INSERT INTO app_live.financial_events
         (company_id,event_key,event_type,source_type,source_id,category_id,competence_date,description,amount,affects_drg)
         VALUES ($1::uuid,$2,'CMV','WORK_ORDER',$3::uuid,$4::uuid,$5::date,$6,$7,true)
         ON CONFLICT (company_id,event_key) DO UPDATE SET category_id=EXCLUDED.category_id,competence_date=EXCLUDED.competence_date,description=EXCLUDED.description,amount=EXCLUDED.amount,reversed_at=NULL`,
        [
          scope.companyId,
          `sale:${id}:cogs`,
          id,
          categoryIds.COGS ?? null,
          eventDate,
          `CMV da venda ${current.rows[0].customer_name}`,
          Math.round(saleCost * 100) / 100,
        ],
      );
    } else if (leavingSale) {
      await client.query(
        `UPDATE app_live.receivables SET status='CANCELADO',cancelled_at=now(),open_amount=0
         WHERE work_order_id=$1::uuid AND payment_date IS NULL`,
        [id],
      );
      await client.query(
        `UPDATE app_live.financial_events SET reversed_at=now()
         WHERE company_id=$1::uuid AND source_type='WORK_ORDER' AND source_id=$2::uuid AND reversed_at IS NULL`,
        [scope.companyId, id],
      );
      await client.query(
        `UPDATE app_live.inventory_movements SET reversed_at=now()
         WHERE company_id=$1::uuid AND source_type='WORK_ORDER' AND source_id=$2::uuid AND movement_type='VENDA' AND reversed_at IS NULL`,
        [scope.companyId, id],
      );
    }

    const updated = await client.query(
      `UPDATE app_live.work_orders
       SET status = $2,
           generate_order = ($2 IN ('PEDIDO', 'VENDA_REALIZADA')),
           sale_date = CASE WHEN $2 = 'VENDA_REALIZADA' THEN CURRENT_DATE ELSE NULL END,
           approved_at = CASE WHEN $2 IN ('PEDIDO','VENDA_REALIZADA') THEN COALESCE(approved_at,now()) ELSE NULL END,
           approved_by_customer = CASE WHEN $2 IN ('PEDIDO','VENDA_REALIZADA') THEN COALESCE(NULLIF($4,''),approved_by_customer,customer_name) ELSE NULL END,
           approval_method = CASE WHEN $2 IN ('PEDIDO','VENDA_REALIZADA') THEN COALESCE(NULLIF($5,''),approval_method,'Conclusão direta') ELSE NULL END,
           approval_notes = CASE WHEN $2 IN ('PEDIDO','VENDA_REALIZADA') THEN COALESCE(NULLIF($6,''),approval_notes) ELSE NULL END,
           completed_at = CASE WHEN $2 = 'VENDA_REALIZADA' THEN now() ELSE NULL END,
           financial_generated_at = CASE WHEN $2 = 'VENDA_REALIZADA' THEN now() ELSE NULL END,
           cancelled_at = CASE WHEN $2 = 'CANCELADO' THEN now() ELSE NULL END,
           updated_at = now()
       WHERE id=$1::uuid AND company_id=$3::uuid
       RETURNING id::text,status,approved_at AS "approvedAt",approved_by_customer AS "approvedByCustomer",
                 approval_method AS "approvalMethod",approval_notes AS "approvalNotes"`,
      [id,body.status,scope.companyId,enteringApproval ? approvedByCustomer : "",enteringApproval ? approvalMethod : "",enteringApproval ? approvalNotes : ""],
    );
    if (enteringSale)
      await client.query(
        `UPDATE app_live.work_orders SET entry_amount=$2,installment_count=$3,first_due_date=$4::date,payment_method_id=$5::uuid,financial_account_id=$6::uuid,payment_method=$7,payment_fee_percent=$8,payment_fee_amount=ROUND(total_value*$8/100,2) WHERE id=$1::uuid`,
        [
          id,
          saleFinance!.entryAmount,
          saleFinance!.installmentCount,
          saleFinance!.firstDueDate,
          saleFinance!.paymentMethodId,
          saleFinance!.financialAccountId,
          saleFinance!.methodName,
          saleFinance!.feePercent,
        ],
      );

    if (!updated.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Ordem não encontrada." },
        { status: 404 },
      );
    }

    await client.query(
      `INSERT INTO app_live.audit_log (entity_type,entity_id,action,actor_id,details)
       VALUES ('work_order',$1::uuid,'status_changed',$2::uuid,jsonb_build_object(
         'status',$3::text,'company_id',$4::text,'approved_by',$5::text,'approval_method',$6::text,'approval_notes',$7::text
       ))`,
      [id,scope.user?.id ?? null,body.status,scope.companyId,enteringApproval ? approvedByCustomer : null,enteringApproval ? approvalMethod : null,enteringApproval ? approvalNotes : null],
    );
    await client.query("COMMIT");
    return NextResponse.json(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    if (
      error instanceof Error &&
      error.message.startsWith("INSUFFICIENT_STOCK:")
    ) {
      return NextResponse.json(
        {
          error: `Estoque insuficiente para ${error.message.slice("INSUFFICIENT_STOCK:".length)}.`,
        },
        { status: 409 },
      );
    }
    if (error instanceof Error && error.message === "SALE_HAS_RECEIPTS") {
      return NextResponse.json(
        {
          error:
            "A venda possui recebimentos e não pode ser reaberta ou cancelada antes do estorno financeiro.",
        },
        { status: 409 },
      );
    }
    if (error instanceof Error && error.message === "INVALID_ENTRY")
      return NextResponse.json(
        { error: "A entrada não pode ser maior que o valor da venda." },
        { status: 400 },
      );
    if (error instanceof Error && error.message === "FINANCE_REQUIRED")
      return NextResponse.json(
        { error: "Preencha forma de pagamento, conta e primeiro vencimento." },
        { status: 400 },
      );
    if (error instanceof Error && error.message === "INSTALLMENTS_NOT_ALLOWED")
      return NextResponse.json(
        { error: "A forma de pagamento selecionada não permite parcelamento." },
        { status: 400 },
      );
    return NextResponse.json(
      { error: "Não foi possível atualizar a ordem." },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
