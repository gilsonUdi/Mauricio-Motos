export type RegistryEntity = "customers" | "vehicles" | "products" | "mechanics" | "suppliers";

export const registryEntities = new Set<RegistryEntity>(["customers", "vehicles", "products", "mechanics", "suppliers"]);

export function isRegistryEntity(value: string): value is RegistryEntity {
  return registryEntities.has(value as RegistryEntity);
}

export const registryListSql: Record<RegistryEntity, string> = {
  customers: `
    SELECT id::text,name,document,phone,email,zip_code,street,address_number,complement,district,city,state,
           default_plate,default_model,updated_at
    FROM app_live.customers WHERE company_id=$1::uuid ORDER BY name`,
  vehicles: `
    SELECT v.id::text, v.customer_id::text, c.name AS customer_name, v.plate,
           v.description, v.brand, v.mileage, v.updated_at
    FROM app_live.vehicles v
    LEFT JOIN app_live.customers c ON c.id = v.customer_id AND c.company_id=v.company_id
    WHERE v.company_id=$1::uuid
    ORDER BY v.plate`,
  products: `
    SELECT p.id::text,p.name,p.type,p.cost_price,p.sale_price,p.profit_margin_percent,
           p.current_stock,p.active,p.updated_at,p.sku,p.barcode,p.item_kind,p.ncm,p.cest,
           p.fiscal_origin,p.commercial_unit,p.default_cfop,p.tax_code,p.tax_rate,p.brand,
           p.supplier_id::text,s.name AS supplier_name,p.minimum_stock,p.lead_time_days,p.stock_location
    FROM app_live.products p LEFT JOIN app_live.suppliers s ON s.id=p.supplier_id AND s.company_id=p.company_id
    WHERE p.company_id=$1::uuid ORDER BY p.active DESC,p.name`,
  mechanics: `
    SELECT id::text, name, commission_percent, active, updated_at
    FROM app_live.mechanics WHERE company_id=$1::uuid ORDER BY active DESC, name`,
  suppliers: `
    SELECT id::text,name,legal_name,document,state_registration,phone,email,zip_code,street,
           address_number,complement,district,city,state,payment_terms_days,notes,active,updated_at
    FROM app_live.suppliers WHERE company_id=$1::uuid ORDER BY active DESC,name`,
};

export function mapRegistryRecord(entity: RegistryEntity, row: Record<string, unknown>) {
  if (entity === "customers") return {
    id: String(row.id), name: row.name, document: row.document, phone: row.phone,
    email: row.email, zipCode: row.zip_code, street: row.street, addressNumber: row.address_number,
    complement: row.complement, district: row.district, city: row.city, state: row.state,
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
    sku: row.sku, barcode: row.barcode, itemKind: row.item_kind, ncm: row.ncm, cest: row.cest,
    fiscalOrigin: row.fiscal_origin, commercialUnit: row.commercial_unit, defaultCfop: row.default_cfop,
    taxCode: row.tax_code, taxRate: Number(row.tax_rate ?? 0), brand: row.brand,
    supplierId: row.supplier_id, supplierName: row.supplier_name,
    minimumStock: Number(row.minimum_stock ?? 0), leadTimeDays: Number(row.lead_time_days ?? 0), stockLocation: row.stock_location,
  };
  if (entity === "suppliers") return {
    id: String(row.id), name: row.name, legalName: row.legal_name, document: row.document,
    stateRegistration: row.state_registration, phone: row.phone, email: row.email, zipCode: row.zip_code,
    street: row.street, addressNumber: row.address_number, complement: row.complement,
    district: row.district, city: row.city, state: row.state,
    paymentTermsDays: Number(row.payment_terms_days ?? 0), notes: row.notes,
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

export function normalizeDocument(value: unknown) {
  return cleanText(value)?.replace(/\D/g, "") ?? null;
}

function hasRepeatedDigits(value: string) {
  return /^(\d)\1+$/.test(value);
}

export function isValidCpf(value: string) {
  if (!/^\d{11}$/.test(value) || hasRepeatedDigits(value)) return false;
  const digit = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(value[index]) * (length + 1 - index);
    const result = (sum * 10) % 11;
    return result === 10 ? 0 : result;
  };
  return digit(9) === Number(value[9]) && digit(10) === Number(value[10]);
}

export function isValidCnpj(value: string) {
  if (!/^\d{14}$/.test(value) || hasRepeatedDigits(value)) return false;
  const calculate = (length: number) => {
    const weights = length === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
    const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return calculate(12) === Number(value[12]) && calculate(13) === Number(value[13]);
}

export function isValidBrazilianDocument(value: string) {
  return value.length === 11 ? isValidCpf(value) : value.length === 14 ? isValidCnpj(value) : false;
}
