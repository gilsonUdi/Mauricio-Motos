import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import {
  booleanValue,
  cleanText,
  isRegistryEntity,
  mapRegistryRecord,
  numberValue,
  registryListSql,
  uuidPattern,
} from "@/lib/registries";
import { getTenantScope } from "@/lib/auth";

type Context = { params: Promise<{ entity: string }> };

export async function GET(_request: Request, context: Context) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const { entity } = await context.params;
  if (!isRegistryEntity(entity)) return NextResponse.json({ error: "Cadastro inválido." }, { status: 404 });
  const scope = await getTenantScope(); if (!scope) return NextResponse.json({ error: "Selecione uma empresa." }, { status: 403 });

  try {
    const [records, customers] = await Promise.all([
      pool.query(registryListSql[entity], [scope.companyId]),
      entity === "vehicles"
        ? pool.query(`SELECT id::text, name FROM app_live.customers WHERE company_id=$1::uuid ORDER BY name`, [scope.companyId])
        : Promise.resolve({ rows: [] }),
    ]);
    return NextResponse.json({
      records: records.rows.map((row) => mapRegistryRecord(entity, row)),
      customers: customers.rows,
    });
  } catch (error) {
    console.error(`Falha ao carregar cadastro ${entity}`, error);
    return NextResponse.json({ error: "Não foi possível carregar o cadastro." }, { status: 500 });
  }
}

export async function POST(request: Request, context: Context) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const { entity } = await context.params;
  if (!isRegistryEntity(entity)) return NextResponse.json({ error: "Cadastro inválido." }, { status: 404 });
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
    let inserted;
    if (entity === "customers") {
      inserted = await client.query(
        `INSERT INTO app_live.customers (company_id,name, document, phone, default_plate, default_model)
         VALUES ($1::uuid,$2,$3,$4,$5,$6) RETURNING *`,
        [scope.companyId,name, cleanText(body.document), cleanText(body.phone), cleanText(body.defaultPlate)?.toUpperCase() ?? null, cleanText(body.defaultModel)],
      );
    } else if (entity === "vehicles") {
      inserted = await client.query(
        `INSERT INTO app_live.vehicles (company_id,customer_id, plate, normalized_plate, description, brand, mileage)
         VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7) RETURNING *`,
        [scope.companyId,customerId, plate, plate!.replace(/[^A-Z0-9]/g, ""), cleanText(body.model), cleanText(body.brand), Math.max(0, Math.trunc(numberValue(body.mileage)))],
      );
      inserted.rows[0].customer_name = customerId
        ? (await client.query(`SELECT name FROM app_live.customers WHERE id=$1::uuid AND company_id=$2::uuid`, [customerId,scope.companyId])).rows[0]?.name ?? null
        : null;
    } else if (entity === "products") {
      const cost = Math.max(0, numberValue(body.costPrice));
      const sale = Math.max(0, numberValue(body.salePrice));
      const margin = body.profitMargin === "" || body.profitMargin === null || body.profitMargin === undefined
        ? (cost > 0 ? ((sale - cost) / cost) * 100 : 0)
        : numberValue(body.profitMargin);
      inserted = await client.query(
        `INSERT INTO app_live.products (company_id,name,type,cost_price,sale_price,profit_margin_percent,current_stock,active)
         VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [scope.companyId,name, cleanText(body.type), cost, sale, margin, numberValue(body.stock), booleanValue(body.active)],
      );
    } else {
      inserted = await client.query(
        `INSERT INTO app_live.mechanics (company_id,name,commission_percent,active) VALUES ($1::uuid,$2,$3,$4) RETURNING *`,
        [scope.companyId,name, Math.max(0, numberValue(body.commissionPercent)), booleanValue(body.active)],
      );
    }

    const record = mapRegistryRecord(entity, inserted.rows[0]);
    await client.query(
      `INSERT INTO app_live.audit_log (entity_type, entity_id, action, details) VALUES ($1, $2::uuid, 'created', $3::jsonb)`,
      [entity, inserted.rows[0].id, JSON.stringify(record)],
    );
    await client.query("COMMIT");
    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(`Falha ao criar cadastro ${entity}`, error);
    return NextResponse.json({ error: "Não foi possível salvar o cadastro." }, { status: 500 });
  } finally {
    client.release();
  }
}
