BEGIN;

ALTER TABLE app_live.vehicles ADD COLUMN IF NOT EXISTS manufacture_year integer;
ALTER TABLE app_live.vehicles ADD COLUMN IF NOT EXISTS model_year integer;
ALTER TABLE app_live.vehicles ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE app_live.vehicles ADD COLUMN IF NOT EXISTS fuel text;
ALTER TABLE app_live.vehicles ADD COLUMN IF NOT EXISTS engine_displacement text;
ALTER TABLE app_live.vehicles ADD COLUMN IF NOT EXISTS registration_city text;
ALTER TABLE app_live.vehicles ADD COLUMN IF NOT EXISTS registration_state text;
ALTER TABLE app_live.vehicles ADD COLUMN IF NOT EXISTS plate_lookup_at timestamptz;

COMMIT;
