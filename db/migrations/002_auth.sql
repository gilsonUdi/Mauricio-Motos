BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_live.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'OPERADOR' CHECK (role IN ('ADMIN', 'OPERADOR', 'FINANCEIRO', 'ESTOQUE')),
  permissions text[] NOT NULL DEFAULT ARRAY['atendimento']::text[],
  active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email ON app_live.app_users(lower(email));
DROP TRIGGER IF EXISTS app_users_updated_at ON app_live.app_users;
CREATE TRIGGER app_users_updated_at BEFORE UPDATE ON app_live.app_users FOR EACH ROW EXECUTE FUNCTION app_live.set_updated_at();

COMMIT;
