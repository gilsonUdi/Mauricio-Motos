import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import {
  booleanValue,
  cleanText,
  isRegistryEntity,
  mapRegistryRecord,
  normalizeDocument,
  numberValue,
  uuidPattern,
  isValidBrazilianDocument,
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
  if ((entity === "customers" || entity === "products" || entity === "mechanics" || entity === "suppliers") && !name) {
    return NextResponse.json({ error: "Informe o nome." }, { status: 400 });
  }
  const plate = cleanText(body.plate)?.toUpperCase();
  if (entity === "vehicles" && !plate) return NextResponse.json({ error: "Informe a placa." }, { status: 400 });
  const customerId = cleanText(body.customerId);
  if (customerId && !uuidPattern.test(customerId)) return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  const document = normalizeDocument(body.document);
  if ((entity === "customers" || entity === "suppliers") && document && !isValidBrazilianDocument(document)) {
    return NextResponse.json({ error: document.length <= 11 ? "CPF inválido." : "CNPJ inválido." }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let updated;
    if (entity === "customers") {
      updated = await client.query(
        `UPDATE app_live.customers SET name=$2,document=$3,phone=$4,email=$5,zip_code=$6,street=$7,address_number=$8,
         complement=$9,district=$10,city=$11,state=$12,default_plate=$13,default_model=$14
         WHERE id=$1::uuid AND company_id=$15::uuid RETURNING *`,
        [id,name,document,cleanText(body.phone),cleanText(body.email)?.toLowerCase(),cleanText(body.zipCode)?.replace(/\D/g,""),cleanText(body.street),cleanText(body.addressNumber),cleanText(body.complement),cleanText(body.district),cleanText(body.city),cleanText(body.state)?.toUpperCase(),cleanText(body.defaultPlate)?.toUpperCase()??null,cleanText(body.defaultModel),scope.companyId],
      );
    } else if (entity === "vehicles") {
      updated = await client.query(
        `UPDATE app_live.vehicles SET customer_id=$2::uuid,plate=$3,normalized_plate=$4,description=$5,brand=$6,mileage=$7,
         manufacture_year=$8::integer,model_year=$9::integer,color=$10,fuel=$11,engine_displacement=$12,registration_city=$13,
         registration_state=$14,plate_lookup_at=COALESCE($15::timestamptz,plate_lookup_at)
         WHERE id=$1::uuid AND company_id=$16::uuid RETURNING *`,
        [id,customerId,plate,plate!.replace(/[^A-Z0-9]/g, ""),cleanText(body.model),cleanText(body.brand),
          Math.max(0,Math.trunc(numberValue(body.mileage))),cleanText(body.manufactureYear),cleanText(body.modelYear),cleanText(body.color),
          cleanText(body.fuel),cleanText(body.engineDisplacement),cleanText(body.registrationCity),cleanText(body.registrationState)?.toUpperCase(),
          cleanText(body.plateLookupAt),scope.companyId],
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
      const supplierId=cleanText(body.supplierId);
      if(supplierId&&(!uuidPattern.test(supplierId)||!(await client.query(`SELECT 1 FROM app_live.suppliers WHERE id=$1::uuid AND company_id=$2::uuid`,[supplierId,scope.companyId])).rowCount)) throw new Error("SUPPLIER_NOT_FOUND");
      updated = await client.query(
        `UPDATE app_live.products SET name=$2,type=$3,cost_price=$4,sale_price=$5,profit_margin_percent=$6,current_stock=$7,active=$8,
         sku=$9,barcode=$10,item_kind=$11,ncm=$12,cest=$13,fiscal_origin=$14,commercial_unit=COALESCE($15,'UN'),default_cfop=$16,
         tax_code=$17,tax_rate=$18,brand=$19,supplier_id=$20::uuid,minimum_stock=$21,lead_time_days=$22,stock_location=$23
         WHERE id=$1::uuid AND company_id=$24::uuid RETURNING *`,
        [id,name,cleanText(body.type),cost,sale,margin,numberValue(body.stock),booleanValue(body.active),cleanText(body.sku),cleanText(body.barcode),body.itemKind==="SERVICO"?"SERVICO":"PRODUTO",cleanText(body.ncm),cleanText(body.cest),cleanText(body.fiscalOrigin),cleanText(body.commercialUnit),cleanText(body.defaultCfop),cleanText(body.taxCode),Math.max(0,numberValue(body.taxRate)),cleanText(body.brand),supplierId,Math.max(0,numberValue(body.minimumStock)),Math.max(0,Math.trunc(numberValue(body.leadTimeDays))),cleanText(body.stockLocation),scope.companyId],
      );
      updated.rows[0].supplier_name=supplierId?(await client.query(`SELECT name FROM app_live.suppliers WHERE id=$1::uuid`,[supplierId])).rows[0]?.name:null;
    } else if (entity === "suppliers") {
      updated=await client.query(
        `UPDATE app_live.suppliers SET name=$2,legal_name=$3,document=$4,state_registration=$5,phone=$6,email=$7,zip_code=$8,street=$9,
         address_number=$10,complement=$11,district=$12,city=$13,state=$14,payment_terms_days=$15,notes=$16,active=$17
         WHERE id=$1::uuid AND company_id=$18::uuid RETURNING *`,
        [id,name,cleanText(body.legalName),document,cleanText(body.stateRegistration),cleanText(body.phone),cleanText(body.email)?.toLowerCase(),cleanText(body.zipCode)?.replace(/\D/g,""),cleanText(body.street),cleanText(body.addressNumber),cleanText(body.complement),cleanText(body.district),cleanText(body.city),cleanText(body.state)?.toUpperCase(),Math.max(0,Math.trunc(numberValue(body.paymentTermsDays))),cleanText(body.notes),booleanValue(body.active),scope.companyId],
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
    const message=error instanceof Error&&error.message==="SUPPLIER_NOT_FOUND"?"Fornecedor inválido.":error instanceof Error&&"code" in error&&error.code==="23505"?"Já existe um cadastro com este documento ou código.":"Não foi possível atualizar o cadastro.";
    return NextResponse.json({ error: message }, { status: message==="Não foi possível atualizar o cadastro."?500:409 });
  } finally {
    client.release();
  }
}
