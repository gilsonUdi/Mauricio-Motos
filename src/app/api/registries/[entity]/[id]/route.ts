import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import {
  booleanValue,
  cleanText,
  isRegistryEntity,
  mapRegistryRecord,
  numberValue,
  uuidPattern,
} from "@/lib/registries";
import { getTenantScope } from "@/lib/auth";

type Context = { params: Promise<{ entity: string; id: string }> };

export async function PATCH(request: Request, context: Context) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const { entity, id } = await context.params;
  if (!isRegistryEntity(entity) || !uuidPattern.test(id)) return NextResponse.json({ error: "Cadastro inválido." }, { status: 404 });
  const scope = await getTenantScope(); if (!scope) return NextResponse.json({ error: "Selecione uma empresa." }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }

  const name = cleanText(body.name);
  if ((entity === "customers" || entity === "products" || entity === "mechanics") && !name) {
    return NextResponse.json({ error: "Informe o nome." }, { status: 400 });
  }
  const plate = cleanText(body.plate)?.toUpperCase();
  if (entity === "vehicles" && !plate) return NextResponse.json({ error: "Informe a placa." }, { status: 400 });
  const customerId = cleanText(body.customerId);
  if (customerId && !uuidPattern.test(customerId)) return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let updated;
    if (entity === "customers") {
      updated = await client.query(
        `UPDATE app_live.customers SET name=$2, document=$3, phone=$4, default_plate=$5, default_model=$6
         WHERE id=$1::uuid AND company_id=$7::uuid RETURNING *`,
        [id, name, cleanText(body.document), cleanText(body.phone), cleanText(body.defaultPlate)?.toUpperCase() ?? null, cleanText(body.defaultModel),scope.companyId],
      );
    } else if (entity === "vehicles") {
      updated = await client.query(
        `UPDATE app_live.vehicles SET customer_id=$2::uuid, plate=$3, normalized_plate=$4, description=$5, brand=$6, mileage=$7
         WHERE id=$1::uuid AND company_id=$8::uuid RETURNING *`,
        [id, customerId, plate, plate!.replace(/[^A-Z0-9]/g, ""), cleanText(body.model), cleanText(body.brand), Math.max(0, Math.trunc(numberValue(body.mileage))),scope.companyId],
      );
      if (updated.rowCount) updated.rows[0].customer_name = customerId
        ? (await client.query(`SELECT name FROM app_live.customers WHERE id=$1::uuid AND company_id=$2::uuid`, [customerId,scope.companyId])).rows[0]?.name ?? null
        : null;
    } else if (entity === "products") {
      const cost = Math.max(0, numberValue(body.costPrice));
      const sale = Math.max(0, numberValue(body.salePrice));
      const margin = body.profitMargin === "" || body.profitMargin === null || body.profitMargin === undefined
        ? (cost > 0 ? ((sale - cost) / cost) * 100 : 0)
        : numberValue(body.profitMargin);
      updated = await client.query(
        `UPDATE app_live.products SET name=$2, type=$3, cost_price=$4, sale_price=$5, profit_margin_percent=$6, current_stock=$7, active=$8
         WHERE id=$1::uuid AND company_id=$9::uuid RETURNING *`,
        [id, name, cleanText(body.type), cost, sale, margin, numberValue(body.stock), booleanValue(body.active),scope.companyId],
      );
    } else {
      updated = await client.query(
        `UPDATE app_live.mechanics SET name=$2, commission_percent=$3, active=$4 WHERE id=$1::uuid AND company_id=$5::uuid RETURNING *`,
        [id, name, Math.max(0, numberValue(body.commissionPercent)), booleanValue(body.active),scope.companyId],
      );
    }

    if (!updated.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Registro não encontrado." }, { status: 404 });
    }
    const record = mapRegistryRecord(entity, updated.rows[0]);
    await client.query(
      `INSERT INTO app_live.audit_log (entity_type, entity_id, action, details) VALUES ($1, $2::uuid, 'updated', $3::jsonb)`,
      [entity, id, JSON.stringify(record)],
    );
    await client.query("COMMIT");
    return NextResponse.json(record);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(`Falha ao editar cadastro ${entity}`, error);
    return NextResponse.json({ error: "Não foi possível atualizar o cadastro." }, { status: 500 });
  } finally {
    client.release();
  }
}
