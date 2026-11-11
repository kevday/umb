-- Paridade com loadSubject (TypeScript): exatamente um vínculo vigente (já iniciado, não encerrado) e só cargos da Loja/jurisdição atual.
CREATE OR REPLACE FUNCTION app_can(u uuid, r jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE m record; n int;
BEGIN
  IF u IS NULL OR r IS NULL OR jsonb_typeof(r) <> 'object' THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = u AND NOT is_technical_admin AND deleted_at IS NULL) THEN RETURN false; END IF;
  SELECT count(*) INTO n FROM institutional_memberships im
    WHERE im.user_id = u AND im.starts_at <= now() AND (im.ends_at IS NULL OR im.ends_at > now());
  IF n <> 1 THEN RETURN false; END IF;
  SELECT im.lodge_id, im.status, l.jurisdiction_id INTO m FROM institutional_memberships im JOIN lodges l ON l.id = im.lodge_id
    WHERE im.user_id = u AND im.starts_at <= now() AND (im.ends_at IS NULL OR im.ends_at > now()) LIMIT 1;
  IF m.status IN ('licenciado','suspenso','eliminado','falecido') THEN RETURN false; END IF;
  RETURN app_eval(u, r, m.lodge_id, m.jurisdiction_id, m.status::text);
END $$;
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
      AND (o.lodge_id = lodge OR o.jurisdiction_id = jur)
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
