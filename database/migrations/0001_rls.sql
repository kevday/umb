DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_reader') THEN CREATE ROLE app_reader NOLOGIN; END IF; END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_eval(u uuid, r jsonb, lodge uuid, jur uuid, st text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE k text := r->>'kind'; x jsonb;
BEGIN
  IF k = 'minDegree' THEN RETURN coalesce((SELECT max(degree) FROM degree_assignments WHERE user_id = u), 0) >= (r->>'value')::int;
  ELSIF k = 'lodge' THEN RETURN lodge::text = r->>'id';
  ELSIF k = 'jurisdiction' THEN RETURN jur::text = r->>'id';
  ELSIF k = 'body' THEN RETURN false;
  ELSIF k = 'status' THEN RETURN EXISTS (SELECT 1 FROM jsonb_array_elements_text(r->'allowed') a WHERE a = st);
  ELSIF k = 'office' THEN
    RETURN EXISTS (SELECT 1 FROM office_assignments o WHERE o.user_id = u AND o.starts_at <= now() AND (o.ends_at IS NULL OR o.ends_at > now())
      AND o.name IN (SELECT jsonb_array_elements_text(r->'names'))
      AND (r->>'lodgeId' IS NULL OR o.lodge_id::text = r->>'lodgeId')
      AND (r->>'jurisdictionId' IS NULL OR o.jurisdiction_id::text = r->>'jurisdictionId'));
  ELSIF k = 'all' THEN
    FOR x IN SELECT * FROM jsonb_array_elements(r->'rules') LOOP IF NOT app_eval(u, x, lodge, jur, st) THEN RETURN false; END IF; END LOOP;
    RETURN true;
  ELSIF k = 'any' THEN
    FOR x IN SELECT * FROM jsonb_array_elements(r->'rules') LOOP IF app_eval(u, x, lodge, jur, st) THEN RETURN true; END IF; END LOOP;
    RETURN false;
  END IF;
  RETURN false;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_can(u uuid, r jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE m record;
BEGIN
  IF u IS NULL OR r IS NULL OR jsonb_typeof(r) <> 'object' THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = u AND NOT is_technical_admin AND deleted_at IS NULL) THEN RETURN false; END IF;
  SELECT im.lodge_id, im.status, l.jurisdiction_id INTO m FROM institutional_memberships im JOIN lodges l ON l.id = im.lodge_id
    WHERE im.user_id = u AND (im.ends_at IS NULL OR im.ends_at > now()) LIMIT 1;
  IF NOT FOUND OR m.status IN ('licenciado','suspenso','eliminado','falecido') THEN RETURN false; END IF;
  RETURN app_eval(u, r, m.lodge_id, m.jurisdiction_id, m.status::text);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_are_friends(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM friendships WHERE status = 'aceita' AND ((requester_id = a AND addressee_id = b) OR (requester_id = b AND addressee_id = a)))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% é append-only', TG_TABLE_NAME; END $$;
--> statement-breakpoint
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON access_audit_logs FOR EACH ROW EXECUTE FUNCTION app_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON access_audit_logs FOR EACH STATEMENT EXECUTE FUNCTION app_immutable();
--> statement-breakpoint
CREATE TRIGGER degrees_immutable BEFORE UPDATE OR DELETE ON degree_assignments FOR EACH ROW EXECUTE FUNCTION app_immutable();
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_reader;
--> statement-breakpoint
GRANT SELECT ON communities, community_topics, community_replies, scrapbook_posts, friendships, profiles TO app_reader;
--> statement-breakpoint
GRANT INSERT ON communities, community_topics, community_replies, scrapbook_posts, friendships, reports TO app_reader;
--> statement-breakpoint
GRANT UPDATE (status) ON friendships TO app_reader;
--> statement-breakpoint
GRANT UPDATE (display_name, bio, visibility) ON profiles TO app_reader;
--> statement-breakpoint
GRANT DELETE ON friendships, scrapbook_posts TO app_reader;
--> statement-breakpoint
ALTER TABLE communities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE communities FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY communities_select ON communities FOR SELECT TO app_reader USING (app_can(app_uid(), policy));
--> statement-breakpoint
CREATE POLICY communities_insert ON communities FOR INSERT TO app_reader WITH CHECK (created_by = app_uid() AND app_can(app_uid(), policy));
--> statement-breakpoint
ALTER TABLE community_topics ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE community_topics FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY topics_select ON community_topics FOR SELECT TO app_reader USING (EXISTS (SELECT 1 FROM communities c WHERE c.id = community_id));
--> statement-breakpoint
CREATE POLICY topics_insert ON community_topics FOR INSERT TO app_reader WITH CHECK (author_id = app_uid() AND EXISTS (SELECT 1 FROM communities c WHERE c.id = community_id));
--> statement-breakpoint
ALTER TABLE community_replies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE community_replies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY replies_select ON community_replies FOR SELECT TO app_reader USING (EXISTS (SELECT 1 FROM community_topics t WHERE t.id = topic_id));
--> statement-breakpoint
CREATE POLICY replies_insert ON community_replies FOR INSERT TO app_reader WITH CHECK (author_id = app_uid() AND EXISTS (SELECT 1 FROM community_topics t WHERE t.id = topic_id));
--> statement-breakpoint
ALTER TABLE scrapbook_posts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE scrapbook_posts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY scrap_select ON scrapbook_posts FOR SELECT TO app_reader USING (profile_id = app_uid() OR author_id = app_uid() OR app_are_friends(app_uid(), profile_id));
--> statement-breakpoint
CREATE POLICY scrap_insert ON scrapbook_posts FOR INSERT TO app_reader WITH CHECK (author_id = app_uid() AND (profile_id = app_uid() OR app_are_friends(app_uid(), profile_id)));
--> statement-breakpoint
CREATE POLICY scrap_delete ON scrapbook_posts FOR DELETE TO app_reader USING (author_id = app_uid() OR profile_id = app_uid());
--> statement-breakpoint
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE friendships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY fr_select ON friendships FOR SELECT TO app_reader USING (requester_id = app_uid() OR addressee_id = app_uid());
--> statement-breakpoint
CREATE POLICY fr_insert ON friendships FOR INSERT TO app_reader WITH CHECK (requester_id = app_uid() AND status IN ('pendente','bloqueada'));
--> statement-breakpoint
CREATE POLICY fr_update ON friendships FOR UPDATE TO app_reader USING (addressee_id = app_uid()) WITH CHECK (addressee_id = app_uid());
--> statement-breakpoint
CREATE POLICY fr_delete ON friendships FOR DELETE TO app_reader USING (requester_id = app_uid() OR addressee_id = app_uid());
--> statement-breakpoint
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE profiles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY profiles_select ON profiles FOR SELECT TO app_reader USING (app_uid() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY profiles_update ON profiles FOR UPDATE TO app_reader USING (user_id = app_uid()) WITH CHECK (user_id = app_uid());
--> statement-breakpoint
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE reports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY reports_insert ON reports FOR INSERT TO app_reader WITH CHECK (reporter_id = app_uid());
