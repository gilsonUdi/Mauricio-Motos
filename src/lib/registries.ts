export type RegistryEntity = "customers" | "vehicles" | "products" | "mechanics";

export const registryEntities = new Set<RegistryEntity>(["customers", "vehicles", "products", "mechanics"]);

export function isRegistryEntity(value: string): value is RegistryEntity {
  return registryEntities.has(value as RegistryEntity);
}

export const registryListSql: Record<RegistryEntity, string> = {
  customers: `
    SELECT id::text, name, document, phone, default_plate, default_model, updated_at
    FROM app_live.customers WHERE company_id=$1::uuid ORDER BY name`,
  vehicles: `
    SELECT v.id::text, v.customer_id::text, c.name AS customer_name, v.plate,
           v.description, v.brand, v.mileage, v.updated_at
    FROM app_live.vehicles v
    LEFT JOIN app_live.customers c ON c.id = v.customer_id AND c.company_id=v.company_id
    WHERE v.company_id=$1::uuid
    ORDER BY v.plate`,
  products: `
    SELECT id::text, name, type, cost_price, sale_price, profit_margin_percent,
           current_stock, active, updated_at
    FROM app_live.products WHERE company_id=$1::uuid ORDER BY active DESC, name`,
  mechanics: `
    SELECT id::text, name, commission_percent, active, updated_at
    FROM app_live.mechanics WHERE company_id=$1::uuid ORDER BY active DESC, name`,
};

export function mapRegistryRecord(entity: RegistryEntity, row: Record<string, unknown>) {
  if (entity === "customers") return {
    id: String(row.id), name: row.name, document: row.document, phone: row.phone,
    defaultPlate: row.default_plate, defaultModel: row.default_model, updatedAt: row.updated_at,
  };
  if (entity === "vehicles") return {
    id: String(row.id), customerId: row.customer_id, customerName: row.customer_name,
    plate: row.plate, model: row.description, brand: row.brand,
    mileage: row.mileage === null ? null : Number(row.mileage), updatedAt: row.updated_at,
  };
  if (entity === "products") return {
    id: String(row.id), name: row.name, type: row.type,
    costPrice: Number(row.cost_price ?? 0), salePrice: Number(row.sale_price ?? 0),
    profitMargin: Number(row.profit_margin_percent ?? 0), stock: Number(row.current_stock ?? 0),
    active: Boolean(row.active), updatedAt: row.updated_at,
  };
  return {
    id: String(row.id), name: row.name, commissionPercent: Number(row.commission_percent ?? 0),
    active: Boolean(row.active), updatedAt: row.updated_at,
  };
}

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const cleanText = (value: unknown) => typeof value === "string" ? value.trim() || null : null;
export const numberValue = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export const booleanValue = (value: unknown, fallback = true) => typeof value === "boolean" ? value : fallback;
