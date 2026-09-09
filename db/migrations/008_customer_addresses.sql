BEGIN;

ALTER TABLE app_live.customers ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE app_live.customers ADD COLUMN IF NOT EXISTS zip_code text;
ALTER TABLE app_live.customers ADD COLUMN IF NOT EXISTS street text;
ALTER TABLE app_live.customers ADD COLUMN IF NOT EXISTS address_number text;
ALTER TABLE app_live.customers ADD COLUMN IF NOT EXISTS complement text;
ALTER TABLE app_live.customers ADD COLUMN IF NOT EXISTS district text;
ALTER TABLE app_live.customers ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE app_live.customers ADD COLUMN IF NOT EXISTS state text;

COMMIT;
