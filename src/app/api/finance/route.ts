import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getTenantScope } from "@/lib/auth";

function period(searchParams: URLSearchParams) {
  const now = new Date();
  const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const defaultTo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get("from") ?? "") ? searchParams.get("from")! : defaultFrom;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get("to") ?? "") ? searchParams.get("to")! : defaultTo;
  return { from, to };
}

export async function GET(request: Request) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const scope=await getTenantScope(); if(!scope)return NextResponse.json({error:"Selecione uma empresa."},{status:403});
  const { from, to } = period(new URL(request.url).searchParams);
  try {
    const [transactions, totals, categories, receivables] = await Promise.all([
      pool.query(`
        SELECT id::text, transaction_date::text AS date, description, movement, account_type, account_group, amount
        FROM app_live.financial_transactions
        WHERE company_id=$3::uuid AND transaction_date BETWEEN $1::date AND $2::date
        ORDER BY transaction_date DESC, created_at DESC LIMIT 1500`, [from, to,scope.companyId]),
      pool.query(`
        SELECT COALESCE(SUM(CASE WHEN movement='ENTRADA' THEN amount ELSE 0 END),0) AS income,
               COALESCE(SUM(CASE WHEN movement='SAIDA' THEN amount ELSE 0 END),0) AS expense
        FROM app_live.financial_transactions WHERE company_id=$3::uuid AND transaction_date BETWEEN $1::date AND $2::date`, [from, to,scope.companyId]),
      pool.query(`
        SELECT movement, COALESCE(account_group,'Não classificado') AS category, SUM(amount) AS total
        FROM app_live.financial_transactions WHERE company_id=$3::uuid AND transaction_date BETWEEN $1::date AND $2::date
        GROUP BY movement, COALESCE(account_group,'Não classificado') ORDER BY SUM(amount) DESC`, [from,to,scope.companyId]),
      pool.query(`
        SELECT COALESCE(SUM(CASE WHEN payment_date IS NULL AND upper(COALESCE(status,'')) NOT LIKE '%CANC%' THEN amount ELSE 0 END),0) AS open_amount,
               COALESCE(SUM(CASE WHEN payment_date IS NULL AND due_date < CURRENT_DATE AND upper(COALESCE(status,'')) NOT LIKE '%CANC%' THEN amount ELSE 0 END),0) AS overdue_amount,
               COUNT(*) FILTER (WHERE payment_date IS NULL AND due_date < CURRENT_DATE AND upper(COALESCE(status,'')) NOT LIKE '%CANC%')::integer AS overdue_count
        FROM app_live.receivables WHERE company_id=$1::uuid`,[scope.companyId]),
    ]);
    const income = Number(totals.rows[0].income);
    const expense = Number(totals.rows[0].expense);
    return NextResponse.json({
      period: { from, to }, summary: { income, expense, result: income - expense, openAmount: Number(receivables.rows[0].open_amount), overdueAmount: Number(receivables.rows[0].overdue_amount), overdueCount: Number(receivables.rows[0].overdue_count) },
      transactions: transactions.rows.map((row) => ({ id: row.id, date: row.date, description: row.description, movement: row.movement, type: row.account_type, category: row.account_group, amount: Number(row.amount) })),
      categories: categories.rows.map((row) => ({ movement: row.movement, category: row.category, total: Number(row.total) })),
    });
  } catch (error) {
    console.error("Falha ao carregar financeiro", error);
    return NextResponse.json({ error: "Não foi possível carregar o financeiro." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const scope=await getTenantScope(); if(!scope)return NextResponse.json({error:"Selecione uma empresa."},{status:403});
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const movement = body.movement === "ENTRADA" || body.movement === "SAIDA" ? body.movement : null;
  const amount = Math.round(Math.max(0, Number(body.amount) || 0) * 100) / 100;
  const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
  const category = typeof body.category === "string" ? body.category.trim() || "Não classificado" : "Não classificado";
  if (!description || !movement || !date || amount <= 0) return NextResponse.json({ error: "Preencha data, descrição, movimento e valor." }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO app_live.financial_transactions
       (company_id,legacy_finance_key,transaction_date,description,movement,account_type,account_group,amount)
       VALUES ($1::uuid,$2,$3::date,$4,$5,'LANCAMENTO_MANUAL',$6,$7)
       RETURNING id::text`,
      [scope.companyId,`manual:${randomUUID()}`, date, description, movement, category, amount],
    );
    await client.query(
      `INSERT INTO app_live.audit_log (entity_type, entity_id, action, details) VALUES ('financial_transaction', $1::uuid, 'created', $2::jsonb)`,
      [inserted.rows[0].id, JSON.stringify({ date, description, movement, category, amount })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ id: inserted.rows[0].id }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Falha ao criar lançamento financeiro", error);
    return NextResponse.json({ error: "Não foi possível criar o lançamento." }, { status: 500 });
  } finally { client.release(); }
}
