-- Esboço da segunda barreira (Fase 2 completa as funções). A aplicação define app.user_id por transação:
--   SELECT set_config('app.user_id', '<uuid>', true);

-- Auditoria append-only
REVOKE UPDATE, DELETE, TRUNCATE ON access_audit_logs FROM PUBLIC;
CREATE OR REPLACE FUNCTION audit_no_change() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'access_audit_logs é append-only'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON access_audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_no_change();

-- Comunidades: leitura somente se o ACE (função SQL espelho do can) permitir
ALTER TABLE communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE communities FORCE ROW LEVEL SECURITY;
-- CREATE POLICY communities_read ON communities FOR SELECT
--   USING (app_can_read(current_setting('app.user_id', true)::uuid, policy));

-- Scrapbook: só o dono do perfil ou amigos aceitos
ALTER TABLE scrapbook_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrapbook_posts FORCE ROW LEVEL SECURITY;
