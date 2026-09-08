import { NextResponse } from "next/server";
import { getTenantScope } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { uuidPattern } from "@/lib/registries";

const validDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
const money = (value: unknown) => Math.round(Math.max(0, Number(value) || 0) * 100) / 100;

export async function GET() {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const scope = await getTenantScope();
  if (!scope) return NextResponse.json({ error: "Selecione uma empresa." }, { status: 403 });
  try {
    const [payables, suppliers, categories, accounts, methods] = await Promise.all([
      pool.query(`SELECT p.id::text,p.purchase_id::text,p.supplier_id::text,p.description,p.document_number,
        p.issue_date::text,p.competence_date::text,p.due_date::text,p.installment_number,p.installment_count,
        p.original_amount,p.open_amount,p.status,p.notes,s.name AS supplier_name,c.name AS category_name,
        CASE WHEN p.status='CANCELADO' THEN 'CANCELADO' WHEN p.open_amount<=0 OR p.status='PAGO' THEN 'PAGO'
             WHEN p.due_date<CURRENT_DATE THEN 'VENCIDO' WHEN p.status='PARCIAL' THEN 'PARCIAL' ELSE 'PENDENTE' END AS display_status,
        last_payment.payment_date::text,last_payment.payment_method
        FROM app_live.accounts_payable p
        LEFT JOIN app_live.suppliers s ON s.id=p.supplier_id
        LEFT JOIN app_live.financial_categories c ON c.id=p.category_id
        LEFT JOIN LATERAL (SELECT pp.payment_date,pm.name AS payment_method FROM app_live.payable_payments pp
          LEFT JOIN app_live.payment_methods pm ON pm.id=pp.payment_method_id
          WHERE pp.payable_id=p.id AND pp.reversed_at IS NULL ORDER BY pp.created_at DESC LIMIT 1) last_payment ON true
        WHERE p.company_id=$1::uuid ORDER BY COALESCE(last_payment.payment_date,p.due_date) DESC,p.created_at DESC LIMIT 1500`, [scope.companyId]),
      pool.query(`SELECT id::text,name FROM app_live.suppliers WHERE company_id=$1::uuid AND active ORDER BY name`, [scope.companyId]),
      pool.query(`SELECT c.id::text,c.name,g.name AS group_name FROM app_live.financial_categories c JOIN app_live.financial_category_groups g ON g.id=c.group_id WHERE c.company_id=$1::uuid AND c.active AND g.active AND c.nature IN ('DESPESA','AMBOS') ORDER BY g.name,c.name`, [scope.companyId]),
      pool.query(`SELECT id::text,name FROM app_live.financial_accounts WHERE company_id=$1::uuid AND active ORDER BY name`, [scope.companyId]),
      pool.query(`SELECT id::text,name,default_account_id::text FROM app_live.payment_methods WHERE company_id=$1::uuid AND active ORDER BY name`, [scope.companyId]),
    ]);
    return NextResponse.json({
      payables: payables.rows.map(row => ({ id: row.id, purchaseId: row.purchase_id, supplierId: row.supplier_id, supplierName: row.supplier_name, description: row.description, documentNumber: row.document_number, issueDate: row.issue_date, competenceDate: row.competence_date, dueDate: row.due_date, paymentDate: row.payment_date, originalAmount: Number(row.original_amount), openAmount: Number(row.open_amount), status: row.display_status, installmentNumber: Number(row.installment_number), installmentCount: Number(row.installment_count), categoryName: row.category_name, paymentMethod: row.payment_method, notes: row.notes })),
      suppliers: suppliers.rows,
      categories: categories.rows.map(row => ({ id: row.id, name: row.name, groupName: row.group_name })),
      accounts: accounts.rows,
      paymentMethods: methods.rows.map(row => ({ id: row.id, name: row.name, defaultAccountId: row.default_account_id })),
    });
  } catch (error) {
    console.error("Falha ao carregar contas a pagar", error);
    return NextResponse.json({ error: "Não foi possível carregar as contas a pagar." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const scope = await getTenantScope();
  if (!scope) return NextResponse.json({ error: "Selecione uma empresa." }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }
  const supplierId = typeof body.supplierId === "string" && uuidPattern.test(body.supplierId) ? body.supplierId : null;
  const categoryId = typeof body.categoryId === "string" && uuidPattern.test(body.categoryId) ? body.categoryId : null;
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const documentNumber = typeof body.documentNumber === "string" ? body.documentNumber.trim() || null : null;
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  const issueDate = validDate(body.issueDate);
  const competenceDate = validDate(body.competenceDate);
  const dueDate = validDate(body.dueDate);
  const amount = money(body.amount);
  if (!description || !categoryId || !issueDate || !competenceDate || !dueDate || amount <= 0) return NextResponse.json({ error: "Preencha descrição, categoria, datas e valor." }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (supplierId && !(await client.query(`SELECT 1 FROM app_live.suppliers WHERE id=$1::uuid AND company_id=$2::uuid AND active`, [supplierId, scope.companyId])).rowCount) throw new Error("SUPPLIER_NOT_FOUND");
    const category = await client.query(`SELECT c.id::text,c.name,c.include_in_drg,g.include_in_drg AS group_include FROM app_live.financial_categories c JOIN app_live.financial_category_groups g ON g.id=c.group_id WHERE c.id=$1::uuid AND c.company_id=$2::uuid AND c.active AND g.active AND c.nature IN ('DESPESA','AMBOS')`, [categoryId, scope.companyId]);
    if (!category.rowCount) throw new Error("CATEGORY_NOT_FOUND");
    const inserted = await client.query(`INSERT INTO app_live.accounts_payable(company_id,supplier_id,category_id,description,document_number,issue_date,competence_date,due_date,original_amount,open_amount,status,notes) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::date,$7::date,$8::date,$9,$9,'PENDENTE',$10) RETURNING id::text`, [scope.companyId, supplierId, categoryId, description, documentNumber, issueDate, competenceDate, dueDate, amount, notes]);
    const id = inserted.rows[0].id;
    await client.query(`INSERT INTO app_live.financial_events(company_id,event_key,event_type,source_type,source_id,category_id,competence_date,description,amount,affects_drg) VALUES($1::uuid,$2,'DESPESA','PAYABLE',$3::uuid,$4::uuid,$5::date,$6,$7,$8)`, [scope.companyId, `payable:${id}:expense`, id, categoryId, competenceDate, description, amount, category.rows[0].include_in_drg && category.rows[0].group_include]);
    await client.query(`INSERT INTO app_live.audit_log(entity_type,entity_id,action,actor_id,details) VALUES('payable',$1::uuid,'created',$2::uuid,$3::jsonb)`, [id, scope.user?.id ?? null, JSON.stringify({ description, amount, dueDate, competenceDate, categoryId, supplierId })]);
    await client.query("COMMIT");
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Falha ao criar conta a pagar", error);
    const message = error instanceof Error && error.message === "SUPPLIER_NOT_FOUND" ? "Fornecedor inválido." : error instanceof Error && error.message === "CATEGORY_NOT_FOUND" ? "Categoria financeira inválida." : "Não foi possível criar a conta a pagar.";
    return NextResponse.json({ error: message }, { status: message.startsWith("Não foi") ? 500 : 400 });
  } finally { client.release(); }
}
