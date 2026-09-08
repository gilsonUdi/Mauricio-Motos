import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { WorkOrder } from "@/lib/types";
import { getTenantScope } from "@/lib/auth";

type ItemInput = {
  productId?: string;
  name?: string;
  type?: string;
  quantity?: number;
  unitPrice?: number;
};

type OrderInput = {
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  customerDocument?: string;
  vehicleId?: string;
  vehiclePlate?: string;
  vehicleModel?: string;
  mileage?: number;
  mechanicId?: string;
  budgetDate?: string;
  discount?: number;
  notes?: string;
  items?: ItemInput[];
};

// Os registros importados usam hashes MD5 convertidos para UUID, portanto não
// possuem obrigatoriamente os bits de versão de um UUID RFC 4122.
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (value?: string) => value?.trim() || undefined;
const validUuid = (value?: string) => value && uuidPattern.test(value) ? value : undefined;
const money = (value: unknown) => Math.round(Math.max(0, Number(value) || 0) * 100) / 100;

export async function POST(request: Request) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const scope = await getTenantScope(); if (!scope) return NextResponse.json({ error: "Selecione uma empresa." }, { status: 403 });

  let body: OrderInput;
  try {
    body = await request.json() as OrderInput;
  } catch {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }

  if (!Array.isArray(body.items) || !body.items.length) {
    return NextResponse.json({ error: "Inclua ao menos um produto ou serviço." }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let customerId = validUuid(body.customerId);
    let customerName = clean(body.customerName);
    let customerPhone = clean(body.customerPhone);

    if (customerId) {
      const found = await client.query(`SELECT name,phone FROM app_live.customers WHERE id=$1::uuid AND company_id=$2::uuid`, [customerId,scope.companyId]);
      if (!found.rowCount) throw new Error("CUSTOMER_NOT_FOUND");
      customerName = found.rows[0].name;
      customerPhone = found.rows[0].phone ?? customerPhone;
    } else {
      if (!customerName) throw new Error("CUSTOMER_REQUIRED");
      const inserted = await client.query(
        `INSERT INTO app_live.customers (company_id,name,phone,document) VALUES ($1::uuid,$2,$3,$4) RETURNING id::text`,
        [scope.companyId,customerName, customerPhone ?? null, clean(body.customerDocument) ?? null],
      );
      customerId = inserted.rows[0].id;
    }

    let plate = clean(body.vehiclePlate)?.toUpperCase();
    let model = clean(body.vehicleModel);
    let mileage = Math.max(0, Math.trunc(Number(body.mileage) || 0)) || undefined;
    const vehicleId = validUuid(body.vehicleId);

    if (vehicleId) {
      const found = await client.query(
        `SELECT plate,description,mileage FROM app_live.vehicles WHERE id=$1::uuid AND company_id=$2::uuid`,
        [vehicleId,scope.companyId],
      );
      if (!found.rowCount) throw new Error("VEHICLE_NOT_FOUND");
      plate = found.rows[0].plate;
      model = found.rows[0].description ?? model;
      mileage = mileage ?? found.rows[0].mileage ?? undefined;
    } else if (plate) {
      await client.query(
        `INSERT INTO app_live.vehicles (company_id,customer_id,plate,normalized_plate,description,mileage)
         VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6)`,
        [scope.companyId,customerId, plate, plate.replace(/[^A-Z0-9]/g, ""), model ?? null, mileage ?? null],
      );
    }

    let mechanicId = validUuid(body.mechanicId);
    let mechanicName: string | undefined;
    if (mechanicId) {
      const found = await client.query(`SELECT name FROM app_live.mechanics WHERE id=$1::uuid AND active AND company_id=$2::uuid`, [mechanicId,scope.companyId]);
      if (!found.rowCount) throw new Error("MECHANIC_NOT_FOUND");
      mechanicName = found.rows[0].name;
    } else {
      mechanicId = undefined;
    }

    const preparedItems: Array<{ productId?: string; name: string; type: string; quantity: number; unitPrice: number }> = [];
    for (const item of body.items) {
      const productId = validUuid(item.productId);
      const quantity = Math.max(0.001, Number(item.quantity) || 1);
      let name = clean(item.name);
      let type = clean(item.type) ?? "Produto/Serviço";
      let unitPrice = money(item.unitPrice);

      if (productId) {
        const product = await client.query(
          `SELECT name,type,COALESCE(sale_price,0) AS sale_price FROM app_live.products WHERE id=$1::uuid AND active AND company_id=$2::uuid`,
          [productId,scope.companyId],
        );
        if (!product.rowCount) throw new Error("PRODUCT_NOT_FOUND");
        name = product.rows[0].name;
        type = product.rows[0].type ?? type;
        if (item.unitPrice === undefined) unitPrice = money(product.rows[0].sale_price);
      }
      if (!name) throw new Error("ITEM_NAME_REQUIRED");
      preparedItems.push({ productId, name, type, quantity, unitPrice });
    }

    const subtotal = preparedItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const discount = Math.min(money(body.discount), money(subtotal));
    const total = money(subtotal - discount);
    const servicesTotal = money(preparedItems
      .filter((item) => item.type.toLocaleLowerCase("pt-BR").includes("serv"))
      .reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));
    const budgetDate = /^\d{4}-\d{2}-\d{2}$/.test(body.budgetDate ?? "") ? body.budgetDate : null;

    await client.query(`SELECT pg_advisory_xact_lock(hashtext('app_live.work_order_number:' || $1::text || ':' || to_char(CURRENT_DATE, 'YYYYMM')))`,[scope.companyId]);
    const sequence = await client.query(`
      SELECT to_char(CURRENT_DATE, 'YYYYMM') AS prefix, COALESCE(MAX(
        CASE WHEN substring(order_number FROM 7) ~ '^[0-9]+$' THEN substring(order_number FROM 7)::integer ELSE 0 END
      ), 0) + 1 AS next_number
      FROM app_live.work_orders
      WHERE company_id=$1::uuid AND order_number LIKE to_char(CURRENT_DATE, 'YYYYMM') || '%'
    `,[scope.companyId]);
    const orderNumber = `${sequence.rows[0].prefix}${String(sequence.rows[0].next_number).padStart(3, "0")}`;

    const insertedOrder = await client.query(
      `INSERT INTO app_live.work_orders (
        company_id,order_number, customer_id, customer_name, mechanic_id, mechanic_name, budget_date,
        status, discount_value, total_value, vehicle_plate, vehicle_model, mileage, notes, services_total
      ) VALUES ($1::uuid,$2,$3::uuid,$4,$5::uuid,$6,COALESCE($7::date,CURRENT_DATE),'ORCAMENTO',$8,$9,$10,$11,$12,$13,$14)
      RETURNING id::text, budget_date::text`,
      [scope.companyId,orderNumber, customerId, customerName, mechanicId ?? null, mechanicName ?? null, budgetDate, discount, total, plate ?? null, model ?? null, mileage ?? null, clean(body.notes) ?? null, servicesTotal],
    );
    const orderId = insertedOrder.rows[0].id;

    const createdItems = [];
    for (const item of preparedItems) {
      const inserted = await client.query(
        `INSERT INTO app_live.work_order_items (work_order_id, product_id, item_name, item_type, quantity, unit_price)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
         RETURNING id::text, product_id::text, item_name, item_type, quantity, unit_price, total_value`,
        [orderId, item.productId ?? null, item.name, item.type, item.quantity, item.unitPrice],
      );
      const row = inserted.rows[0];
      createdItems.push({ id: row.id, productId: row.product_id ?? undefined, name: row.item_name, type: row.item_type, quantity: Number(row.quantity), unitPrice: Number(row.unit_price), total: Number(row.total_value) });
    }

    await client.query(
      `INSERT INTO app_live.audit_log (entity_type,entity_id,action,actor_id,details)
       VALUES ('work_order',$1::uuid,'created',$2::uuid,jsonb_build_object('order_number',$3::text,'total',$4::numeric,'company_id',$5::text))`,
      [orderId,scope.user?.id??null,orderNumber,total,scope.companyId],
    );
    await client.query("COMMIT");

    const order: WorkOrder = {
      id: orderId,
      number: orderNumber,
      customerId,
      customer: customerName!,
      phone: customerPhone,
      plate,
      model,
      mileage,
      mechanic: mechanicName,
      mechanicId,
      budgetDate: insertedOrder.rows[0].budget_date,
      total,
      discount,
      status: "ORCAMENTO",
      notes: clean(body.notes),
      items: createdItems,
    };
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Falha ao criar orçamento", error);
    const knownErrors: Record<string, string> = {
      CUSTOMER_REQUIRED: "Informe o cliente.",
      CUSTOMER_NOT_FOUND: "Cliente não encontrado.",
      VEHICLE_NOT_FOUND: "Veículo não encontrado.",
      MECHANIC_NOT_FOUND: "Mecânico não encontrado.",
      PRODUCT_NOT_FOUND: "Produto ou serviço não encontrado.",
      ITEM_NAME_REQUIRED: "Preencha a descrição de todos os itens.",
    };
    const message = error instanceof Error ? knownErrors[error.message] : undefined;
    return NextResponse.json({ error: message ?? "Não foi possível criar o orçamento." }, { status: message ? 400 : 500 });
  } finally {
    client.release();
  }
}
