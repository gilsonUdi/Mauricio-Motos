BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS app_live;

CREATE OR REPLACE FUNCTION app_live.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

CREATE TABLE IF NOT EXISTS app_live.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_customer_key text UNIQUE,
  name text NOT NULL,
  document text,
  phone text,
  default_plate text,
  default_model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_live.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_vehicle_key text UNIQUE,
  customer_id uuid REFERENCES app_live.customers(id) ON DELETE SET NULL,
  plate text NOT NULL,
  normalized_plate text NOT NULL,
  description text,
  brand text,
  mileage integer,
  photo_1 text,
  photo_2 text,
  photo_3 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_live.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_product_key text UNIQUE,
  name text NOT NULL,
  type text,
  cost_price numeric(14,2),
  sale_price numeric(14,2),
  profit_margin_percent numeric(18,4),
  current_stock numeric(14,3),
  image_path text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_live.mechanics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_mechanic_id text UNIQUE,
  name text NOT NULL,
  commission_percent numeric(18,4),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_live.work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_order_key text UNIQUE,
  legacy_source_row integer,
  order_number text NOT NULL,
  customer_id uuid REFERENCES app_live.customers(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  mechanic_id uuid REFERENCES app_live.mechanics(id) ON DELETE SET NULL,
  mechanic_name text,
  budget_date date,
  sale_date date,
  cancelled_at timestamptz,
  status text NOT NULL DEFAULT 'ORCAMENTO' CHECK (status IN ('ORCAMENTO', 'PEDIDO', 'VENDA_REALIZADA', 'CANCELADO')),
  generate_order boolean NOT NULL DEFAULT false,
  discount_value numeric(14,2) NOT NULL DEFAULT 0,
  total_value numeric(14,2) NOT NULL DEFAULT 0,
  payment_method text,
  card_fee numeric(14,2) NOT NULL DEFAULT 0,
  vehicle_plate text,
  vehicle_model text,
  mileage integer,
  notes text,
  attendant_signature_path text,
  invoice_file_path text,
  commission_value numeric(14,2),
  services_total numeric(14,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_live.work_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_item_key text UNIQUE,
  legacy_unique_id text,
  legacy_invoice_id text,
  work_order_id uuid REFERENCES app_live.work_orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES app_live.products(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  item_type text,
  quantity numeric(14,3) NOT NULL DEFAULT 1,
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  cost_value numeric(14,2),
  total_value numeric(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_live.receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_receivable_key text UNIQUE,
  work_order_id uuid REFERENCES app_live.work_orders(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES app_live.customers(id) ON DELETE SET NULL,
  customer_name text,
  due_date date,
  payment_date date,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  status text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_live.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_movement_key text UNIQUE,
  product_id uuid REFERENCES app_live.products(id) ON DELETE SET NULL,
  movement_date date,
  movement_type text,
  quantity numeric(14,3) NOT NULL DEFAULT 0,
  party_name text,
  balance_after numeric(14,3),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_live.financial_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_finance_key text UNIQUE,
  transaction_date date,
  description text,
  movement text,
  account_type text,
  account_group text,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_live.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  actor_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_live.customers (id, legacy_customer_key, name, document, phone, default_plate, default_model)
SELECT md5('customer:' || customer_key)::uuid, customer_key, name, document, phone, default_plate, default_model
FROM app_core.customers
ON CONFLICT (legacy_customer_key) DO NOTHING;

INSERT INTO app_live.vehicles (id, legacy_vehicle_key, customer_id, plate, normalized_plate, description, brand, mileage, photo_1, photo_2, photo_3)
SELECT md5('vehicle:' || vehicle_key)::uuid, vehicle_key,
       CASE WHEN customer_key IS NULL THEN NULL ELSE md5('customer:' || customer_key)::uuid END,
       plate, normalized_plate, description, brand, mileage, photo_1, photo_2, photo_3
FROM app_core.vehicles
ON CONFLICT (legacy_vehicle_key) DO NOTHING;

INSERT INTO app_live.products (id, legacy_product_key, name, type, cost_price, sale_price, profit_margin_percent, current_stock, image_path)
SELECT md5('product:' || product_key)::uuid, product_key, name, type, cost_price, sale_price, profit_margin_percent, stock, image_path
FROM app_core.products
ON CONFLICT (legacy_product_key) DO NOTHING;

INSERT INTO app_live.mechanics (id, legacy_mechanic_id, name, commission_percent)
SELECT md5('mechanic:' || mechanic_id)::uuid, mechanic_id, name, commission_percent
FROM app_core.mechanics
ON CONFLICT (legacy_mechanic_id) DO NOTHING;

INSERT INTO app_live.work_orders (
  id, legacy_order_key, legacy_source_row, order_number, customer_id, customer_name, mechanic_id, mechanic_name,
  budget_date, sale_date, cancelled_at, status, generate_order, discount_value, total_value, payment_method,
  card_fee, vehicle_plate, vehicle_model, mileage, notes, attendant_signature_path, invoice_file_path,
  commission_value, services_total
)
SELECT md5('order:' || order_key)::uuid, order_key, source_row_number, invoice_id,
       CASE WHEN customer_key IS NULL THEN NULL ELSE md5('customer:' || customer_key)::uuid END,
       coalesce(customer_name, 'Cliente não informado'),
       CASE WHEN mechanic_id IS NULL THEN NULL ELSE md5('mechanic:' || mechanic_id)::uuid END,
       mechanic_name, budget_date, sale_date,
       CASE WHEN rejection_date IS NULL THEN NULL ELSE rejection_date::timestamp AT TIME ZONE 'America/Sao_Paulo' END,
       CASE WHEN rejection_date IS NOT NULL THEN 'CANCELADO'
            WHEN sale_date IS NOT NULL THEN 'VENDA_REALIZADA'
            WHEN generate_invoice_id IS TRUE THEN 'PEDIDO'
            ELSE 'ORCAMENTO' END,
       coalesce(generate_invoice_id, false), coalesce(discount_value, 0), coalesce(total_value, 0), payment_method,
       coalesce(card_fee, 0), coalesce(vehicle_plate, plate_reference), vehicle_model, mileage, notes,
       attendant_signature_path, invoice_file_path, commission_value, services_total
FROM app_core.service_orders
ON CONFLICT (legacy_order_key) DO NOTHING;

INSERT INTO app_live.work_order_items (
  id, legacy_item_key, legacy_unique_id, legacy_invoice_id, work_order_id, product_id,
  item_name, item_type, quantity, unit_price, cost_value, status
)
SELECT md5('item:' || i.item_key)::uuid, i.item_key, i.source_unique_id, i.invoice_id,
       CASE WHEN i.order_key IS NULL THEN NULL ELSE md5('order:' || i.order_key)::uuid END,
       CASE WHEN i.product_key IS NULL THEN NULL ELSE md5('product:' || i.product_key)::uuid END,
       coalesce(i.product_name, 'Item sem descrição'), i.item_type, coalesce(i.quantity, 1), coalesce(i.unit_price, 0), i.cost_value, i.status
FROM app_core.order_items i
ON CONFLICT (legacy_item_key) DO NOTHING;

INSERT INTO app_live.receivables (id, legacy_receivable_key, work_order_id, customer_id, customer_name, due_date, payment_date, amount, status, notes)
SELECT md5('receivable:' || r.receivable_key)::uuid, r.receivable_key,
       (SELECT o.id FROM app_live.work_orders o WHERE o.order_number = r.invoice_id ORDER BY o.legacy_source_row LIMIT 1),
       c.id, r.customer_name, r.due_date, r.payment_date, coalesce(r.amount, 0), r.status, r.notes
FROM app_core.accounts_receivable r
LEFT JOIN app_live.customers c ON app_core.norm_text(c.name) = app_core.norm_text(r.customer_name)
ON CONFLICT (legacy_receivable_key) DO NOTHING;

INSERT INTO app_live.inventory_movements (id, legacy_movement_key, product_id, movement_date, movement_type, quantity, party_name, balance_after)
SELECT md5('inventory:' || m.movement_key)::uuid, m.movement_key,
       CASE WHEN m.product_key IS NULL THEN NULL ELSE md5('product:' || m.product_key)::uuid END,
       m.movement_date, m.movement_type, coalesce(m.quantity, 0), m.party_name, m.balance
FROM app_core.inventory_movements m
ON CONFLICT (legacy_movement_key) DO NOTHING;

INSERT INTO app_live.financial_transactions (id, legacy_finance_key, transaction_date, description, movement, account_type, account_group, amount)
SELECT md5('finance:' || finance_key)::uuid, finance_key, transaction_date, description, movement, account_type, account_group, coalesce(amount, 0)
FROM app_core.finance_transactions
ON CONFLICT (legacy_finance_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_live_orders_status_date ON app_live.work_orders(status, budget_date DESC);
CREATE INDEX IF NOT EXISTS idx_live_orders_customer ON app_live.work_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_live_order_items_order ON app_live.work_order_items(work_order_id);
CREATE INDEX IF NOT EXISTS idx_live_products_name ON app_live.products(name);
CREATE INDEX IF NOT EXISTS idx_live_customers_name ON app_live.customers(name);
CREATE INDEX IF NOT EXISTS idx_live_vehicles_plate ON app_live.vehicles(normalized_plate);
CREATE INDEX IF NOT EXISTS idx_live_receivables_due ON app_live.receivables(due_date, status);

DROP TRIGGER IF EXISTS customers_updated_at ON app_live.customers;
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON app_live.customers FOR EACH ROW EXECUTE FUNCTION app_live.set_updated_at();
DROP TRIGGER IF EXISTS vehicles_updated_at ON app_live.vehicles;
CREATE TRIGGER vehicles_updated_at BEFORE UPDATE ON app_live.vehicles FOR EACH ROW EXECUTE FUNCTION app_live.set_updated_at();
DROP TRIGGER IF EXISTS products_updated_at ON app_live.products;
CREATE TRIGGER products_updated_at BEFORE UPDATE ON app_live.products FOR EACH ROW EXECUTE FUNCTION app_live.set_updated_at();
DROP TRIGGER IF EXISTS mechanics_updated_at ON app_live.mechanics;
CREATE TRIGGER mechanics_updated_at BEFORE UPDATE ON app_live.mechanics FOR EACH ROW EXECUTE FUNCTION app_live.set_updated_at();
DROP TRIGGER IF EXISTS work_orders_updated_at ON app_live.work_orders;
CREATE TRIGGER work_orders_updated_at BEFORE UPDATE ON app_live.work_orders FOR EACH ROW EXECUTE FUNCTION app_live.set_updated_at();
DROP TRIGGER IF EXISTS work_order_items_updated_at ON app_live.work_order_items;
CREATE TRIGGER work_order_items_updated_at BEFORE UPDATE ON app_live.work_order_items FOR EACH ROW EXECUTE FUNCTION app_live.set_updated_at();
DROP TRIGGER IF EXISTS receivables_updated_at ON app_live.receivables;
CREATE TRIGGER receivables_updated_at BEFORE UPDATE ON app_live.receivables FOR EACH ROW EXECUTE FUNCTION app_live.set_updated_at();
DROP TRIGGER IF EXISTS financial_transactions_updated_at ON app_live.financial_transactions;
CREATE TRIGGER financial_transactions_updated_at BEFORE UPDATE ON app_live.financial_transactions FOR EACH ROW EXECUTE FUNCTION app_live.set_updated_at();

COMMIT;
