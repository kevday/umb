CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  email_verified_at timestamptz,
  is_admin boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
-- @@
CREATE TABLE profiles (user_id uuid PRIMARY KEY REFERENCES users(id), full_name text NOT NULL, display_name text, bio text);
-- @@
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  mfa_verified boolean NOT NULL DEFAULT false,
  user_agent text, ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
-- @@
CREATE INDEX sessions_user_idx ON sessions (user_id);
-- @@
CREATE TABLE user_totp (user_id uuid PRIMARY KEY REFERENCES users(id), secret_enc text NOT NULL, confirmed_at timestamptz, last_step integer);
-- @@
CREATE TABLE recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  code_hash text NOT NULL, used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- @@
CREATE INDEX recovery_codes_user_idx ON recovery_codes (user_id);
-- @@
CREATE TABLE email_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('verify', 'reset', 'email_change', 'mfa_reset')),
  token_hash text NOT NULL UNIQUE, new_email text,
  expires_at timestamptz NOT NULL, used_at timestamptz
);
-- @@
CREATE TABLE invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL, token_hash text NOT NULL UNIQUE,
  created_by uuid REFERENCES users(id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL, used_at timestamptz,
  used_by uuid REFERENCES users(id), revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- @@
CREATE INDEX invites_email_idx ON invites (email);
-- @@
CREATE TABLE rate_limits (key text PRIMARY KEY, count integer NOT NULL, window_start timestamptz NOT NULL);
-- @@
CREATE TABLE modules (id text PRIMARY KEY, enabled boolean NOT NULL DEFAULT false, version text, updated_at timestamptz NOT NULL DEFAULT now());
-- @@
CREATE TABLE settings (
  module text NOT NULL, key text NOT NULL, scope_id text NOT NULL DEFAULT '',
  value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  PRIMARY KEY (module, key, scope_id)
);
-- @@
CREATE TABLE audit_log (
  seq serial PRIMARY KEY, at timestamptz NOT NULL, actor_id uuid, action text NOT NULL,
  subject text, payload jsonb, prev_hash text NOT NULL, hash text NOT NULL
);
-- @@
CREATE OR REPLACE FUNCTION kernel_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% é somente de inserção', TG_TABLE_NAME; END $$;
-- @@
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION kernel_immutable();
-- @@
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION kernel_immutable();
