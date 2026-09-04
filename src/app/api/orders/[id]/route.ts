import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { OrderStatus, WorkOrder } from "@/lib/types";

type ItemInput = { productId?: string; name?: string; type?: string; quantity?: number; unitPrice?: number };
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

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (value?: string) => value?.trim() || undefined;
const validUuid = (value?: string) => value && uuidPattern.test(value) ? value : undefined;
const money = (value: unknown) => Math.round(Math.max(0, Number(value) || 0) * 100) / 100;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });

  const { id } = await context.params;
  if (!validUuid(id)) return NextResponse.json({ error: "Orçamento inválido." }, { status: 400 });

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
    const current = await client.query(
      `SELECT order_number, status, total_value, customer_name, payment_method
       FROM app_live.work_orders WHERE id = $1::uuid FOR UPDATE`,
      [id],
    );
    if (!current.rowCount) throw new Error("ORDER_NOT_FOUND");
    if (current.rows[0].status !== "ORCAMENTO") throw new Error("ORDER_LOCKED");

    let customerId = validUuid(body.customerId);
    let customerName = clean(body.customerName);
    let customerPhone = clean(body.customerPhone);
    if (customerId) {
      const customer = await client.query(`SELECT name, phone FROM app_live.customers WHERE id = $1::uuid`, [customerId]);
      if (!customer.rowCount) throw new Error("CUSTOMER_NOT_FOUND");
      customerName = customer.rows[0].name;
      customerPhone = customer.rows[0].phone ?? customerPhone;
    } else {
      if (!customerName) throw new Error("CUSTOMER_REQUIRED");
      const inserted = await client.query(
        `INSERT INTO app_live.customers (name, phone, document) VALUES ($1, $2, $3) RETURNING id::text`,
        [customerName, customerPhone ?? null, clean(body.customerDocument) ?? null],
      );
      customerId = inserted.rows[0].id;
    }

    let plate = clean(body.vehiclePlate)?.toUpperCase();
    let model = clean(body.vehicleModel);
    let mileage = Math.max(0, Math.trunc(Number(body.mileage) || 0)) || undefined;
    const vehicleId = validUuid(body.vehicleId);
    if (vehicleId) {
      const vehicle = await client.query(`SELECT plate, description, mileage FROM app_live.vehicles WHERE id = $1::uuid`, [vehicleId]);
      if (!vehicle.rowCount) throw new Error("VEHICLE_NOT_FOUND");
      plate = vehicle.rows[0].plate;
      model = vehicle.rows[0].description ?? model;
      mileage = mileage ?? vehicle.rows[0].mileage ?? undefined;
    } else if (plate) {
      const normalizedPlate = plate.replace(/[^A-Z0-9]/g, "");
      const existingVehicle = await client.query(
        `SELECT id FROM app_live.vehicles WHERE customer_id = $1::uuid AND normalized_plate = $2 ORDER BY created_at DESC LIMIT 1`,
        [customerId, normalizedPlate],
      );
      if (existingVehicle.rowCount) {
        await client.query(
          `UPDATE app_live.vehicles SET description = COALESCE($2, description), mileage = COALESCE($3, mileage) WHERE id = $1::uuid`,
          [existingVehicle.rows[0].id, model ?? null, mileage ?? null],
        );
      } else {
        await client.query(
          `INSERT INTO app_live.vehicles (customer_id, plate, normalized_plate, description, mileage) VALUES ($1::uuid, $2, $3, $4, $5)`,
          [customerId, plate, normalizedPlate, model ?? null, mileage ?? null],
        );
      }
    }

    let mechanicId = validUuid(body.mechanicId);
    let mechanicName: string | undefined;
    if (mechanicId) {
      const mechanic = await client.query(`SELECT name FROM app_live.mechanics WHERE id = $1::uuid AND active`, [mechanicId]);
      if (!mechanic.rowCount) throw new Error("MECHANIC_NOT_FOUND");
      mechanicName = mechanic.rows[0].name;
    } else {
      mechanicId = undefined;
    }

    const preparedItems: Array<{ productId?: string; name: string; type: string; quantity: number; unitPrice: number }> = [];
    for (const item of body.items) {
      const productId = validUuid(item.productId);
      const quantity = Math.max(0.001, Number(item.quantity) || 1);
      let name = clean(item.name);
      let type = clean(item.type) ?? "Produto/Serviço";
      const unitPrice = money(item.unitPrice);
      if (productId) {
        const product = await client.query(`SELECT name, type FROM app_live.products WHERE id = $1::uuid AND active`, [productId]);
        if (!product.rowCount) throw new Error("PRODUCT_NOT_FOUND");
        name = product.rows[0].name;
        type = product.rows[0].type ?? type;
      }
      if (!name) throw new Error("ITEM_NAME_REQUIRED");
      preparedItems.push({ productId, name, type, quantity, unitPrice });
    }

    const subtotal = preparedItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const discount = Math.min(money(body.discount), money(subtotal));
    const total = money(subtotal - discount);
    const servicesTotal = money(preparedItems.filter((item) => item.type.toLocaleLowerCase("pt-BR").includes("serv")).reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));
    const budgetDate = /^\d{4}-\d{2}-\d{2}$/.test(body.budgetDate ?? "") ? body.budgetDate : null;

    const updated = await client.query(
      `UPDATE app_live.work_orders SET
         customer_id = $2::uuid, customer_name = $3, mechanic_id = $4::uuid, mechanic_name = $5,
         budget_date = COALESCE($6::date, budget_date), discount_value = $7, total_value = $8,
         vehicle_plate = $9, vehicle_model = $10, mileage = $11, notes = $12, services_total = $13
       WHERE id = $1::uuid
       RETURNING order_number, status, budget_date::text, payment_method`,
      [id, customerId, customerName, mechanicId ?? null, mechanicName ?? null, budgetDate, discount, total, plate ?? null, model ?? null, mileage ?? null, clean(body.notes) ?? null, servicesTotal],
    );

    await client.query(`DELETE FROM app_live.work_order_items WHERE work_order_id = $1::uuid`, [id]);
    const createdItems: WorkOrder["items"] = [];
    for (const item of preparedItems) {
      const inserted = await client.query(
        `INSERT INTO app_live.work_order_items (work_order_id, product_id, item_name, item_type, quantity, unit_price)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
         RETURNING id::text, product_id::text, item_name, item_type, quantity, unit_price, total_value`,
        [id, item.productId ?? null, item.name, item.type, item.quantity, item.unitPrice],
      );
      const row = inserted.rows[0];
      createdItems.push({ id: row.id, productId: row.product_id ?? undefined, name: row.item_name, type: row.item_type, quantity: Number(row.quantity), unitPrice: Number(row.unit_price), total: Number(row.total_value) });
    }

    await client.query(
      `INSERT INTO app_live.audit_log (entity_type, entity_id, action, details)
       VALUES ('work_order', $1::uuid, 'updated', $2::jsonb)`,
      [id, JSON.stringify({ orderNumber: current.rows[0].order_number, previousTotal: Number(current.rows[0].total_value), total, previousCustomer: current.rows[0].customer_name, customer: customerName })],
    );
    await client.query("COMMIT");

    const row = updated.rows[0];
    const order: WorkOrder = {
      id,
      number: row.order_number,
      customerId,
      customer: customerName!,
      phone: customerPhone,
      plate,
      model,
      mileage,
      mechanicId,
      mechanic: mechanicName,
      budgetDate: row.budget_date,
      total,
      discount,
      status: row.status as OrderStatus,
      paymentMethod: row.payment_method ?? undefined,
      notes: clean(body.notes),
      items: createdItems,
    };
    return NextResponse.json(order);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Falha ao editar orçamento", error);
    const knownErrors: Record<string, { message: string; status: number }> = {
      ORDER_NOT_FOUND: { message: "Orçamento não encontrado.", status: 404 },
      ORDER_LOCKED: { message: "Somente orçamentos em aberto podem ser editados.", status: 409 },
      CUSTOMER_REQUIRED: { message: "Informe o cliente.", status: 400 },
      CUSTOMER_NOT_FOUND: { message: "Cliente não encontrado.", status: 400 },
      VEHICLE_NOT_FOUND: { message: "Veículo não encontrado.", status: 400 },
      MECHANIC_NOT_FOUND: { message: "Mecânico não encontrado.", status: 400 },
      PRODUCT_NOT_FOUND: { message: "Produto ou serviço não encontrado.", status: 400 },
      ITEM_NAME_REQUIRED: { message: "Preencha a descrição de todos os itens.", status: 400 },
    };
    const known = error instanceof Error ? knownErrors[error.message] : undefined;
    return NextResponse.json({ error: known?.message ?? "Não foi possível editar o orçamento." }, { status: known?.status ?? 500 });
  } finally {
    client.release();
  }
}
