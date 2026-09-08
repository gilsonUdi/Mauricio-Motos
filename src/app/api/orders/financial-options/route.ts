import { NextResponse } from "next/server";
import { getTenantScope } from "@/lib/auth";
import { getPool } from "@/lib/db";
export async function GET() {
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
  try {
    const [accounts, methods, rules] = await Promise.all([
      pool.query(
        `SELECT id::text,name FROM app_live.financial_accounts WHERE company_id=$1::uuid AND active ORDER BY name`,
        [scope.companyId],
      ),
      pool.query(
        `SELECT id::text,name,supports_installments,variable_fee,default_fee_percent,default_account_id::text FROM app_live.payment_methods WHERE company_id=$1::uuid AND active ORDER BY name`,
        [scope.companyId],
      ),
      pool.query(
        `SELECT r.payment_method_id::text,r.minimum_installments,r.maximum_installments,r.fee_percent FROM app_live.payment_fee_rules r JOIN app_live.payment_methods m ON m.id=r.payment_method_id WHERE m.company_id=$1::uuid ORDER BY r.minimum_installments`,
        [scope.companyId],
      ),
    ]);
    return NextResponse.json({
      accounts: accounts.rows,
      methods: methods.rows.map((row) => ({
        id: row.id,
        name: row.name,
        supportsInstallments: row.supports_installments,
        variableFee: row.variable_fee,
        defaultFeePercent: Number(row.default_fee_percent),
        defaultAccountId: row.default_account_id,
        rules: rules.rows
          .filter((rule) => rule.payment_method_id === row.id)
          .map((rule) => ({
            minimumInstallments: rule.minimum_installments,
            maximumInstallments: rule.maximum_installments,
            feePercent: Number(rule.fee_percent),
          })),
      })),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Não foi possível carregar as opções financeiras." },
      { status: 500 },
    );
  }
}
