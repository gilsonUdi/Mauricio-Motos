import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getTenantScope, hasPermission } from "@/lib/auth";

type RawIssue = {
  reference_id: string;
  reference: string;
  description: string;
  expected: number | string | null;
  actual: number | string | null;
};

type Check = {
  code: string;
  module: "VENDAS" | "ESTOQUE" | "COMPRAS" | "FINANCEIRO";
  severity: "CRITICO" | "ALERTA";
  title: string;
  query: string;
};

const checks: Check[] = [
  {
    code: "SALE_RECEIVABLE_TOTAL", module: "VENDAS", severity: "CRITICO", title: "Venda e contas a receber divergentes",
    query: `SELECT o.id::text AS reference_id,concat('Venda ',o.order_number,' · ',o.customer_name) AS reference,
      'O total das parcelas não corresponde ao valor da venda.' AS description,o.total_value AS expected,COALESCE(SUM(r.original_amount) FILTER (WHERE r.status<>'CANCELADO'),0) AS actual
      FROM app_live.work_orders o LEFT JOIN app_live.receivables r ON r.work_order_id=o.id AND r.company_id=o.company_id
      WHERE o.company_id=$1::uuid AND o.status='VENDA_REALIZADA' AND o.financial_generated_at IS NOT NULL
      GROUP BY o.id HAVING ABS(o.total_value-COALESCE(SUM(r.original_amount) FILTER (WHERE r.status<>'CANCELADO'),0))>0.01`,
  },
  {
    code: "SALE_REVENUE_EVENT", module: "FINANCEIRO", severity: "CRITICO", title: "Receita da venda ausente ou divergente",
    query: `SELECT o.id::text AS reference_id,concat('Venda ',o.order_number,' · ',o.customer_name) AS reference,
      'O evento de receita usado no DRG não corresponde à venda.' AS description,o.total_value AS expected,COALESCE(MAX(e.amount),0) AS actual
      FROM app_live.work_orders o LEFT JOIN app_live.financial_events e ON e.company_id=o.company_id AND e.source_type='WORK_ORDER' AND e.source_id=o.id AND e.event_type='RECEITA_VENDA' AND e.reversed_at IS NULL
      WHERE o.company_id=$1::uuid AND o.status='VENDA_REALIZADA' AND o.financial_generated_at IS NOT NULL
      GROUP BY o.id HAVING ABS(o.total_value-COALESCE(MAX(e.amount),0))>0.01`,
  },
  {
    code: "SALE_COGS_EVENT", module: "FINANCEIRO", severity: "CRITICO", title: "CMV da venda ausente ou divergente",
    query: `WITH expected AS (SELECT o.id,o.order_number,o.customer_name,COALESCE(SUM(i.quantity*COALESCE(i.unit_cost_snapshot,i.cost_value,0)) FILTER (WHERE COALESCE(p.item_kind,CASE WHEN lower(concat_ws(' ',i.item_type,p.type)) LIKE '%serv%' THEN 'SERVICO' ELSE 'PRODUTO' END)<>'SERVICO'),0) AS amount
      FROM app_live.work_orders o LEFT JOIN app_live.work_order_items i ON i.work_order_id=o.id LEFT JOIN app_live.products p ON p.id=i.product_id
      WHERE o.company_id=$1::uuid AND o.status='VENDA_REALIZADA' AND o.financial_generated_at IS NOT NULL GROUP BY o.id)
      SELECT x.id::text AS reference_id,concat('Venda ',x.order_number,' · ',x.customer_name) AS reference,'O custo congelado dos produtos não corresponde ao CMV do DRG.' AS description,x.amount AS expected,COALESCE(MAX(e.amount),0) AS actual
      FROM expected x LEFT JOIN app_live.financial_events e ON e.source_type='WORK_ORDER' AND e.source_id=x.id AND e.event_type='CMV' AND e.reversed_at IS NULL
      GROUP BY x.id,x.order_number,x.customer_name,x.amount HAVING ABS(x.amount-COALESCE(MAX(e.amount),0))>0.01`,
  },
  {
    code: "SALE_STOCK_MOVEMENT", module: "ESTOQUE", severity: "CRITICO", title: "Baixa de estoque da venda divergente",
    query: `WITH expected AS (SELECT o.id,o.order_number,o.customer_name,i.product_id,p.name,SUM(i.quantity) AS quantity FROM app_live.work_orders o JOIN app_live.work_order_items i ON i.work_order_id=o.id JOIN app_live.products p ON p.id=i.product_id
      WHERE o.company_id=$1::uuid AND o.status='VENDA_REALIZADA' AND o.financial_generated_at IS NOT NULL AND COALESCE(p.item_kind,CASE WHEN lower(concat_ws(' ',i.item_type,p.type)) LIKE '%serv%' THEN 'SERVICO' ELSE 'PRODUTO' END)<>'SERVICO' GROUP BY o.id,i.product_id,p.name)
      SELECT x.id::text AS reference_id,concat('Venda ',x.order_number,' · ',x.name) AS reference,'A quantidade vendida não corresponde à baixa ativa no estoque.' AS description,x.quantity AS expected,COALESCE(SUM(m.quantity) FILTER (WHERE m.movement_type='VENDA' AND m.reversed_at IS NULL),0) AS actual
      FROM expected x LEFT JOIN app_live.inventory_movements m ON m.company_id=$1::uuid AND m.source_type='WORK_ORDER' AND m.source_id=x.id AND m.product_id=x.product_id
      GROUP BY x.id,x.order_number,x.name,x.quantity HAVING ABS(x.quantity-COALESCE(SUM(m.quantity) FILTER (WHERE m.movement_type='VENDA' AND m.reversed_at IS NULL),0))>0.001`,
  },
  {
    code: "PURCHASE_PAYABLE_TOTAL", module: "COMPRAS", severity: "CRITICO", title: "Compra e conta a pagar divergentes",
    query: `SELECT p.id::text AS reference_id,concat('Compra ',COALESCE(p.document_number,p.id::text),' · ',p.supplier_name) AS reference,'A obrigação financeira não corresponde ao total da compra.' AS description,p.total_amount AS expected,COALESCE(SUM(a.original_amount) FILTER (WHERE a.status<>'CANCELADO'),0) AS actual
      FROM app_live.purchases p LEFT JOIN app_live.accounts_payable a ON a.purchase_id=p.id AND a.company_id=p.company_id
      WHERE p.company_id=$1::uuid AND p.status='CONFIRMADA' GROUP BY p.id HAVING ABS(p.total_amount-COALESCE(SUM(a.original_amount) FILTER (WHERE a.status<>'CANCELADO'),0))>0.01`,
  },
  {
    code: "PURCHASE_STOCK_MOVEMENT", module: "ESTOQUE", severity: "CRITICO", title: "Entrada de estoque da compra divergente",
    query: `WITH expected AS (SELECT p.id,p.company_id,p.document_number,prd.name,i.product_id,SUM(i.quantity) AS quantity FROM app_live.purchases p JOIN app_live.purchase_items i ON i.purchase_id=p.id JOIN app_live.products prd ON prd.id=i.product_id
      WHERE p.company_id=$1::uuid AND p.status='CONFIRMADA' GROUP BY p.id,prd.name,i.product_id)
      SELECT x.id::text AS reference_id,concat('Compra ',COALESCE(x.document_number,x.id::text),' · ',x.name) AS reference,'A quantidade comprada não corresponde à entrada ativa no estoque.' AS description,x.quantity AS expected,COALESCE(SUM(m.quantity) FILTER (WHERE m.movement_type='COMPRA' AND m.reversed_at IS NULL),0) AS actual
      FROM expected x LEFT JOIN app_live.inventory_movements m ON m.company_id=x.company_id AND m.source_type='PURCHASE' AND m.source_id=x.id AND m.product_id=x.product_id
      GROUP BY x.id,x.document_number,x.name,x.quantity HAVING ABS(x.quantity-COALESCE(SUM(m.quantity) FILTER (WHERE m.movement_type='COMPRA' AND m.reversed_at IS NULL),0))>0.001`,
  },
  {
    code: "RECEIVABLE_BALANCE", module: "FINANCEIRO", severity: "ALERTA", title: "Saldo de conta a receber inconsistente",
    query: `SELECT r.id::text AS reference_id,concat('Recebível · ',r.customer_name,' · ',r.due_date::text) AS reference,'O saldo ou status não acompanha os recebimentos registrados.' AS description,GREATEST(COALESCE(r.original_amount,r.amount)-COALESCE(SUM(rp.amount) FILTER (WHERE rp.reversed_at IS NULL),0),0) AS expected,r.open_amount AS actual
      FROM app_live.receivables r LEFT JOIN app_live.receivable_payments rp ON rp.receivable_id=r.id
      WHERE r.company_id=$1::uuid AND r.legacy_receivable_key IS NULL AND r.status<>'CANCELADO' GROUP BY r.id
      HAVING ABS(r.open_amount-GREATEST(COALESCE(r.original_amount,r.amount)-COALESCE(SUM(rp.amount) FILTER (WHERE rp.reversed_at IS NULL),0),0))>0.01 OR (r.open_amount<=0 AND r.status<>'PAGO') OR (r.open_amount>0 AND r.status='PAGO')`,
  },
  {
    code: "PAYABLE_BALANCE", module: "FINANCEIRO", severity: "ALERTA", title: "Saldo de conta a pagar inconsistente",
    query: `SELECT a.id::text AS reference_id,concat('Obrigação · ',a.description,' · ',a.due_date::text) AS reference,'O saldo ou status não acompanha os pagamentos registrados.' AS description,GREATEST(a.original_amount-COALESCE(SUM(pp.amount) FILTER (WHERE pp.reversed_at IS NULL),0),0) AS expected,a.open_amount AS actual
      FROM app_live.accounts_payable a LEFT JOIN app_live.payable_payments pp ON pp.payable_id=a.id
      WHERE a.company_id=$1::uuid AND a.status<>'CANCELADO' GROUP BY a.id
      HAVING ABS(a.open_amount-GREATEST(a.original_amount-COALESCE(SUM(pp.amount) FILTER (WHERE pp.reversed_at IS NULL),0),0))>0.01 OR (a.open_amount<=0 AND a.status<>'PAGO') OR (a.open_amount>0 AND a.status='PAGO')`,
  },
  {
    code: "RECEIPT_CASH_EVENT", module: "FINANCEIRO", severity: "CRITICO", title: "Recebimento sem movimento financeiro",
    query: `SELECT rp.id::text AS reference_id,concat('Recebimento · ',r.customer_name,' · ',rp.receipt_date::text) AS reference,'O recebimento não possui entrada de caixa correspondente.' AS description,COALESCE(rp.net_amount,rp.amount-rp.fee_amount) AS expected,COALESCE(MAX(ft.amount),0) AS actual
      FROM app_live.receivable_payments rp JOIN app_live.receivables r ON r.id=rp.receivable_id LEFT JOIN app_live.financial_transactions ft ON ft.company_id=rp.company_id AND ft.source_type='RECEIVABLE_PAYMENT' AND ft.source_id=rp.id
      WHERE rp.company_id=$1::uuid AND rp.reversed_at IS NULL GROUP BY rp.id,r.customer_name HAVING ABS(COALESCE(rp.net_amount,rp.amount-rp.fee_amount)-COALESCE(MAX(ft.amount),0))>0.01`,
  },
  {
    code: "PAYMENT_CASH_EVENT", module: "FINANCEIRO", severity: "CRITICO", title: "Pagamento sem movimento financeiro",
    query: `SELECT pp.id::text AS reference_id,concat('Pagamento · ',a.description,' · ',pp.payment_date::text) AS reference,'O pagamento não possui saída de caixa correspondente.' AS description,(pp.amount+pp.interest_amount+pp.fine_amount-pp.discount_amount) AS expected,COALESCE(MAX(ft.amount),0) AS actual
      FROM app_live.payable_payments pp JOIN app_live.accounts_payable a ON a.id=pp.payable_id LEFT JOIN app_live.financial_transactions ft ON ft.company_id=pp.company_id AND ft.source_type='PAYABLE_PAYMENT' AND ft.source_id=pp.id
      WHERE pp.company_id=$1::uuid AND pp.reversed_at IS NULL GROUP BY pp.id,a.description HAVING ABS((pp.amount+pp.interest_amount+pp.fine_amount-pp.discount_amount)-COALESCE(MAX(ft.amount),0))>0.01`,
  },
  {
    code: "NEGATIVE_STOCK", module: "ESTOQUE", severity: "CRITICO", title: "Produto com estoque negativo",
    query: `SELECT p.id::text AS reference_id,p.name AS reference,'O saldo atual está abaixo de zero.' AS description,0 AS expected,p.current_stock AS actual FROM app_live.products p WHERE p.company_id=$1::uuid AND p.current_stock<0 ORDER BY p.current_stock`,
  },
];

export async function GET() {
  const scope=await getTenantScope();
  if(!scope)return NextResponse.json({error:"Selecione uma empresa."},{status:403});
  if(scope.user&&!hasPermission(scope.user,"conferencia"))return NextResponse.json({error:"Acesso restrito."},{status:403});
  try{
    const pool=getPool()!;
    const results=await Promise.all(checks.map(check=>pool.query<RawIssue>(check.query,[scope.companyId])));
    const issues=checks.flatMap((check,index)=>results[index].rows.map(row=>({
      id:`${check.code}:${row.reference_id}`,code:check.code,module:check.module,severity:check.severity,title:check.title,
      reference:row.reference,description:row.description,expected:Number(row.expected),actual:Number(row.actual),
    })));
    const checkResults=checks.map((check,index)=>({code:check.code,module:check.module,title:check.title,issueCount:results[index].rowCount??0,status:results[index].rowCount?"DIVERGENTE":"OK"}));
    return NextResponse.json({
      checkedAt:new Date().toISOString(),issues,checks:checkResults,
      summary:{checks:checks.length,passed:checkResults.filter(item=>item.status==="OK").length,total:issues.length,critical:issues.filter(item=>item.severity==="CRITICO").length,warnings:issues.filter(item=>item.severity==="ALERTA").length},
    });
  }catch(error){console.error("Falha na conferência de integridade",error);return NextResponse.json({error:"Não foi possível executar a conferência operacional."},{status:500});}
}
