import { NextResponse } from "next/server";
import { getTenantScope } from "@/lib/auth";
import { getPool } from "@/lib/db";

const validDate = (value: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value : null;

export async function GET(request: Request) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const scope = await getTenantScope();
  if (!scope) return NextResponse.json({ error: "Selecione uma empresa." }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const from = validDate(params.get("from"));
  const to = validDate(params.get("to"));
  if (!from || !to || from > to) return NextResponse.json({ error: "Informe um período válido." }, { status: 400 });

  try {
    const [sales, cogs, classified] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(total_value+COALESCE(discount_value,0)),0) AS gross_revenue,
        COALESCE(SUM(discount_value),0) AS discounts,COUNT(*)::integer AS sales_count
        FROM app_live.work_orders WHERE company_id=$1::uuid AND status='VENDA_REALIZADA'
        AND sale_date BETWEEN $2::date AND $3::date`, [scope.companyId, from, to]),
      pool.query(`SELECT COALESCE(SUM(amount),0) AS amount FROM app_live.financial_events
        WHERE company_id=$1::uuid AND event_type='CMV' AND competence_date BETWEEN $2::date AND $3::date
        AND reversed_at IS NULL AND affects_drg`, [scope.companyId, from, to]),
      pool.query(`SELECT g.id::text AS group_id,g.name AS group_name,g.system_code AS group_code,
        c.id::text AS category_id,c.name AS category_name,c.system_code AS category_code,
        e.event_type,COALESCE(SUM(e.amount),0) AS amount
        FROM app_live.financial_events e
        JOIN app_live.financial_categories c ON c.id=e.category_id
        JOIN app_live.financial_category_groups g ON g.id=c.group_id
        WHERE e.company_id=$1::uuid AND e.competence_date BETWEEN $2::date AND $3::date
          AND e.reversed_at IS NULL AND e.affects_drg AND c.include_in_drg AND g.include_in_drg
          AND c.active AND g.active AND e.event_type IN ('DESPESA','RECEITA')
        GROUP BY g.id,g.name,g.system_code,c.id,c.name,c.system_code,e.event_type
        ORDER BY g.name,c.name`, [scope.companyId, from, to]),
    ]);

    const grossRevenue = Number(sales.rows[0].gross_revenue);
    const discounts = Number(sales.rows[0].discounts);
    const rows = classified.rows.map(row => ({ groupId:row.group_id,groupName:row.group_name,groupCode:row.group_code,categoryId:row.category_id,categoryName:row.category_name,categoryCode:row.category_code,eventType:row.event_type,amount:Number(row.amount) }));
    const taxes = rows.filter(row => row.eventType === "DESPESA" && row.groupCode === "TAXES");
    const operatingRows = rows.filter(row => row.eventType === "DESPESA" && row.groupCode !== "TAXES" && row.groupCode !== "NON_OPERATING");
    const nonOperatingIncomeRows = rows.filter(row => row.eventType === "RECEITA" && row.groupCode === "NON_OPERATING");
    const nonOperatingExpenseRows = rows.filter(row => row.eventType === "DESPESA" && row.groupCode === "NON_OPERATING");
    const unclassifiedIncomeRows = rows.filter(row => row.eventType === "RECEITA" && row.groupCode !== "NON_OPERATING");
    const sum = (items: typeof rows) => items.reduce((total,item) => total + item.amount,0);
    const taxAmount = sum(taxes);
    const netRevenue = grossRevenue - discounts - taxAmount;
    const cogsAmount = Number(cogs.rows[0].amount);
    const grossProfit = netRevenue - cogsAmount;
    const operatingExpenses = sum(operatingRows);
    const otherOperatingIncome = sum(unclassifiedIncomeRows);
    const operatingResult = grossProfit - operatingExpenses + otherOperatingIncome;
    const nonOperatingIncome = sum(nonOperatingIncomeRows);
    const nonOperatingExpenses = sum(nonOperatingExpenseRows);
    const netResult = operatingResult + nonOperatingIncome - nonOperatingExpenses;
    const groupRows = (items: typeof rows) => Object.values(items.reduce<Record<string,{id:string;name:string;amount:number;categories:Array<{id:string;name:string;amount:number}>}>>((result,item) => {
      const group = result[item.groupId] ?? { id:item.groupId,name:item.groupName,amount:0,categories:[] };
      group.amount += item.amount;
      group.categories.push({ id:item.categoryId,name:item.categoryName,amount:item.amount });
      result[item.groupId] = group;
      return result;
    },{}));

    return NextResponse.json({ period:{from,to}, salesCount:Number(sales.rows[0].sales_count), summary:{grossRevenue,discounts,taxes:taxAmount,netRevenue,cogs:cogsAmount,grossProfit,operatingExpenses,otherOperatingIncome,operatingResult,nonOperatingIncome,nonOperatingExpenses,netResult,grossMargin:netRevenue?grossProfit/netRevenue*100:0,netMargin:netRevenue?netResult/netRevenue*100:0}, details:{taxes:groupRows(taxes),operatingExpenses:groupRows(operatingRows),operatingIncome:groupRows(unclassifiedIncomeRows),nonOperatingIncome:groupRows(nonOperatingIncomeRows),nonOperatingExpenses:groupRows(nonOperatingExpenseRows)} });
  } catch (error) {
    console.error("Falha ao gerar DRG", error);
    return NextResponse.json({ error: "Não foi possível gerar o DRG." }, { status: 500 });
  }
}
